-- ============================================================================
-- FIX — surface the storage rate limit to the user (2026-08-08)
-- ============================================================================
-- ⚠️ Confirm the SQL Editor tab is on project dtjmyqogeozrzzbdjokr first:
--    select current_database(), to_regclass('public.rate_events');
--
-- Run the whole file. It is idempotent.
--
-- WHAT WAS WRONG
-- The cap itself works. Seven avatar uploads in one hour produced exactly six
-- rate_events rows and a rejected seventh — the Postgres log carries the raise
-- verbatim ("You have uploaded too many images in the last hour...") and the
-- storage log shows POST /object/avatars/... -> 500.
--
-- But storage-api does not forward a database error message to the client. It
-- answers 500 with a body of `{}`, so supabase-js builds its StorageApiError
-- message from JSON.stringify(body) — literally "{}". uploadErrorMessage()
-- matches on /too many images/i, that never matches, and the user is told "The
-- image failed to upload. Please try again." — the one piece of advice that is
-- wrong here, because retrying cannot succeed for another hour.
--
-- Raising a different errcode does not help: storage-api maps 42501 to its own
-- hardcoded RLS text and 23505/23503 to bucket/key errors, and everything else
-- to an opaque 500. There is no errcode that carries our sentence through.
--
-- THE FIX
-- Let the client ASK whether it is rate limited, instead of trying to read it
-- out of an error body that will never contain it. upload_rate_limited() is a
-- read-only SECURITY DEFINER probe over the same counter the trigger enforces;
-- src/lib/uploadErrors.ts calls it only when an upload has already failed with
-- an unrecognised error, so the happy path costs nothing.
--
-- rate_events stays unreadable from the client (RLS on, zero policies, grants
-- revoked). This function returns one boolean about the caller's own counter
-- and nothing else — no counts, no timestamps, no other actor.
--
-- WHY storage_rate_rule() EXISTS
-- The bucket -> (action, limit) mapping now has two readers: the trigger that
-- enforces it and the probe that reports it. Two copies of "6" would drift on
-- the first tuning pass and the app would then confidently report the wrong
-- limit. One function, both callers.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The mapping — single source of truth for both callers below.
--    v_action is null for a bucket that is not rate limited (trek-profile and
--    anything added later); both callers treat that as "not covered".
-- ---------------------------------------------------------------------------
create or replace function public.storage_rate_rule(
  p_bucket text,
  out v_action text,
  out v_limit  int
)
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
           when p_bucket = 'trek-reviews' then 'upload:review'
           when p_bucket in ('avatars','company-logos','trek-images') then 'upload'
         end,
         case
           when p_bucket = 'trek-reviews' then 20
           when p_bucket in ('avatars','company-logos','trek-images') then 6
         end;
$$;

-- Internal helper. Both callers are SECURITY DEFINER and owned by postgres, so
-- they reach it regardless; no client ever needs to call it directly.
revoke all on function public.storage_rate_rule(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. The enforcer — unchanged behaviour, limits now read from the mapping.
--
-- new.owner stays the identity source: auth.uid() is NULL inside this trigger
-- on the storage-api path (verified 2026-08-05, see
-- fix-storage-rate-limit-owner.sql), while owner is always populated from the
-- JWT `sub` by storage-api and cannot be forged from the client.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_storage_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := coalesce(new.owner, auth.uid());
  v_rule  record;
  v_count int;
begin
  -- Service-role / seeded writes carry no owner and no session; never block.
  if v_uid is null then
    return null;
  end if;

  -- Only a new object version is an upload. Renames, moves and metadata
  -- touches reuse the version and must not consume the budget.
  if tg_op = 'UPDATE' and new.version is not distinct from old.version then
    return null;
  end if;

  select * into v_rule from public.storage_rate_rule(new.bucket_id);
  if v_rule.v_action is null then
    return null;
  end if;

  select count(*) into v_count
  from public.rate_events
  where actor = v_uid and action = v_rule.v_action and at > now() - interval '1 hour';

  if v_count >= v_rule.v_limit then
    -- The client never sees this text (storage-api answers 500 with `{}`); it
    -- is for the Postgres log. The user-facing copy comes from the probe below.
    raise exception 'You have uploaded too many images in the last hour. Please try again later.'
      using errcode = 'P0001';
  end if;

  insert into public.rate_events (actor, action) values (v_uid, v_rule.v_action);
  return null;
end;
$$;

drop trigger if exists storage_objects_rate_limit on storage.objects;
create trigger storage_objects_rate_limit
  after insert or update on storage.objects
  for each row
  execute function public.enforce_storage_rate_limit();


-- ---------------------------------------------------------------------------
-- 3. The probe — "am I, right now, out of upload budget for this bucket?"
--
-- Read-only and consumes nothing, so calling it after a failed upload cannot
-- push the user further into the limit. auth.uid() IS reliable here: this is a
-- normal PostgREST call, not the storage-api trigger context.
-- ---------------------------------------------------------------------------
create or replace function public.upload_rate_limited(p_bucket text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_rule  record;
  v_count int;
begin
  if v_uid is null then
    return false;
  end if;

  select * into v_rule from public.storage_rate_rule(p_bucket);
  if v_rule.v_action is null then
    return false;
  end if;

  select count(*) into v_count
  from public.rate_events
  where actor = v_uid and action = v_rule.v_action and at > now() - interval '1 hour';

  return v_count >= v_rule.v_limit;
end;
$$;

revoke all on function public.upload_rate_limited(text) from public, anon;
grant execute on function public.upload_rate_limited(text) to authenticated;


-- ============================================================================
-- VERIFY — run after applying
-- ============================================================================
-- 1. Mapping agrees with the documented limits (expect upload/6, upload/6,
--    upload/6, upload:review/20, then NULL/NULL for an uncovered bucket):
--      select b, (public.storage_rate_rule(b)).*
--        from unnest(array['avatars','company-logos','trek-images',
--                          'trek-reviews','trek-profile']) as b;
--
-- 2. Probe is callable by authenticated and nobody else (expect f, t):
--      select has_function_privilege('anon','public.upload_rate_limited(text)','execute'),
--             has_function_privilege('authenticated','public.upload_rate_limited(text)','execute');
--
-- 3. rate_events is still unreachable directly (expect f, f, 0):
--      select has_table_privilege('authenticated','public.rate_events','select'),
--             has_table_privilege('anon','public.rate_events','select'),
--             (select count(*) from pg_policies where tablename = 'rate_events');
--
-- 4. END-TO-END, the test that actually matters. The counter is already at 6
--    for the test account, so ONE more upload through the UI is enough:
--    the toast must read "You have uploaded too many images in the last hour.
--    Please try again later." — not "The image failed to upload."
--
--    Then reset and confirm uploads work again:
--      delete from public.rate_events where action = 'upload';
--
-- 5. Rollback — removes the guard and the probe, leaves the 3 MiB / image-only
--    bucket caps in place:
--      drop trigger if exists storage_objects_rate_limit on storage.objects;
--      drop function if exists public.upload_rate_limited(text);
-- ============================================================================
