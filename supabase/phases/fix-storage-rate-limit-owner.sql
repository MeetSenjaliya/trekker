-- ============================================================================
-- FIX — storage rate limit: identify the user from new.owner, not auth.uid()
-- (2026-08-05)
-- ============================================================================
-- ⚠️ Confirm the SQL Editor tab is on project dtjmyqogeozrzzbdjokr first:
--    select current_database(), to_regclass('public.rate_events');
--
-- This replaces the function created by rate-limiting-storage.sql and cleans up
-- the diagnostic from diagnose-storage-rate-limit.sql. Run the whole file.
--
-- WHAT WAS WRONG
-- The guard was inert: a real avatar upload committed to storage.objects and
-- rate_events stayed empty. Instrumenting the trigger showed why —
--   tg_op=INSERT, bucket=avatars, uid=NULL, session_replication_role=origin
-- The trigger fires correctly; auth.uid() simply returns NULL inside it, so
-- every upload hit the "service-role write" null guard and returned early.
--
-- WHY auth.uid() IS NULL HERE BUT WORKS IN THE RLS POLICY ON THE SAME WRITE
-- auth.uid() reads the request.jwt.claims GUC. RLS policies on storage.objects
-- clearly resolve it — the earlier "new row violates row-level security policy"
-- error proved the policy evaluated the caller's uid correctly. The claims are
-- evidently not visible in the trigger's execution context on the storage-api
-- path. Rather than depend on that GUC propagating, take the identity from the
-- row being written.
--
-- WHY new.owner IS THE RIGHT SOURCE
-- storage-api populates storage.objects.owner from the JWT `sub` on every
-- upload — verified on live rows (each user-uploaded object carries its
-- uploader's uuid; only the one legacy seeded object has owner = null). The
-- client cannot set it: the Storage API derives it server-side, and the storage
-- schema is not exposed through PostgREST, so there is no path for a client to
-- forge it. It is strictly more reliable here than a session GUC.
--
-- auth.uid() is kept as a fallback via coalesce so the guard still works on any
-- path where the GUC *is* present and owner is not set.
--
-- The null guard stays: owner is null for service-role and seeded writes, and
-- those must never be blocked.
-- ============================================================================

create or replace function public.enforce_storage_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- new.owner first: auth.uid() is NULL in this trigger on the storage-api
  -- path (verified 2026-08-05), while owner is always populated from the JWT.
  v_uid    uuid := coalesce(new.owner, auth.uid());
  v_action text;
  v_limit  int;
  v_count  int;
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

  if new.bucket_id = 'trek-reviews' then
    v_action := 'upload:review';
    v_limit  := 20;
  elsif new.bucket_id in ('avatars','company-logos','trek-images') then
    v_action := 'upload';
    v_limit  := 6;
  else
    return null;  -- trek-profile and any future bucket: not covered here.
  end if;

  select count(*) into v_count
  from public.rate_events
  where actor = v_uid and action = v_action and at > now() - interval '1 hour';

  if v_count >= v_limit then
    raise exception 'You have uploaded too many images in the last hour. Please try again later.'
      using errcode = 'P0001';
  end if;

  insert into public.rate_events (actor, action) values (v_uid, v_action);
  return null;
end;
$$;

-- Diagnostic no longer needed.
drop table if exists public.rate_debug;


-- ============================================================================
-- VERIFY — this one needs a real upload; structural checks cannot tell a
-- working guard from an inert one (that is what let the first version ship).
-- ============================================================================
-- 1. Upload ONE avatar through the app, then:
--      select action, actor, at from public.rate_events order by at desc;
--    EXPECT a row with action = 'upload'. If it is still empty, the fix failed
--    and new.owner is not populated on this path either — say so, do not
--    assume it worked.
--
-- 2. Optional, to prove the cap actually rejects: upload 7 images within an
--    hour. The 7th must fail with "You have uploaded too many images in the
--    last hour." (6 is the limit for avatars/company-logos/trek-images.)
--    Clear the counter afterwards:
--      delete from public.rate_events where action = 'upload';
--
-- 3. Rollback if uploads misbehave — this removes the guard entirely and
--    leaves the 3 MiB / image-only bucket caps in place:
--      drop trigger if exists storage_objects_rate_limit on storage.objects;
-- ============================================================================
