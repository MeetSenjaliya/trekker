-- ============================================================================
-- DIAGNOSTIC — why storage_objects_rate_limit records nothing (2026-08-05)
-- ============================================================================
-- ✅ SPENT 2026-08-05 — DO NOT RE-RUN. This did its job: one upload returned
--    tg_op=INSERT bucket=avatars uid=NULL session_replication_role=origin
-- confirming hypothesis A (the trigger fires; auth.uid() is NULL inside it).
-- The fix is supabase/phases/fix-storage-rate-limit-owner.sql, which is already
-- applied and which ALSO dropped public.rate_debug and restored the clean
-- function — so section 4 below is superseded and must not be run either.
-- Re-running this file would re-create the debug table and re-add the debug
-- write to a function that is now correct. Kept only as the record of how the
-- inert guard was found. Verified 2026-08-05: to_regclass('public.rate_debug')
-- is null and no function references it.
-- ============================================================================
-- ⚠️ Confirm the SQL Editor tab is on project dtjmyqogeozrzzbdjokr first:
--    select current_database(), to_regclass('public.rate_events');
--
-- TEMPORARY. This adds an unconditional debug write to the trigger function so
-- we can see what it actually observes. Section 4 below removes it again.
--
-- OBSERVED: an avatar upload succeeded (storage.objects row committed, owner
-- set correctly from the JWT) but public.rate_events gained no 'upload' row.
-- The trigger exists, tgenabled = 'O', tgtype = 21 (AFTER INSERT OR UPDATE,
-- FOR EACH ROW), and the function is SECURITY DEFINER owned by postgres.
--
-- TWO HYPOTHESES, which need different fixes:
--   A. The trigger FIRES but auth.uid() is null inside it, so the null guard
--      returns early. (Odd, because the RLS policy on the same statement does
--      resolve auth.uid() correctly — that is exactly what the earlier
--      "new row violates row-level security policy" error proved.)
--   B. The trigger NEVER FIRES — e.g. storage-api's connection runs with
--      session_replication_role = 'replica', which suppresses ORIGIN triggers
--      while leaving RLS fully in force.
--
-- HOW TO READ THE RESULT after one upload:
--   * a rate_debug row with uid <> 'NULL'  -> neither A nor B; the limit logic
--                                             itself is at fault
--   * a rate_debug row with uid  = 'NULL'  -> hypothesis A
--   * NO rate_debug row at all             -> hypothesis B
-- ============================================================================


-- ---- 1. Debug sink. Same lockdown as rate_events: unreachable from clients. --
create table if not exists public.rate_debug (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  tg_op  text,
  bucket text,
  uid    text,
  srr    text,
  role   text
);
alter table public.rate_debug enable row level security;
revoke all on public.rate_debug from anon, authenticated;


-- ---- 2. Same function, plus one unconditional debug write at the top --------
-- Note the debug insert happens BEFORE the null guard, so it records the call
-- even when auth.uid() is null. That is the whole point.
create or replace function public.enforce_storage_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_action text;
  v_limit  int;
  v_count  int;
begin
  -- Wrapped so a failure here can never break an upload: an unhandled error in
  -- an AFTER trigger aborts the whole statement, and this insert exists purely
  -- to observe. Losing a debug row is acceptable; losing uploads is not.
  begin
    insert into public.rate_debug (tg_op, bucket, uid, srr, role)
    values (
      tg_op,
      new.bucket_id,
      coalesce(v_uid::text, 'NULL'),
      coalesce(current_setting('session_replication_role', true), 'unset'),
      current_user
    );
  exception when others then
    null;
  end;

  if v_uid is null then
    return null;
  end if;

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
    return null;
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


-- ============================================================================
-- 3. NOW UPLOAD ONE AVATAR through the app, then run:
-- ============================================================================
--   select * from public.rate_debug order by at desc;
--   select * from public.rate_events order by at desc;
--
-- If rate_debug is EMPTY (hypothesis B), also try:
--   alter table storage.objects enable always trigger storage_objects_rate_limit;
-- This may fail with "must be owner of table objects" — `postgres` holds the
-- TRIGGER privilege but does not own the table. If it fails, a trigger on
-- storage.objects cannot be made to fire on this path and Layer B has to be
-- rebuilt somewhere else. Report either outcome.
-- ============================================================================


-- ============================================================================
-- 4. CLEANUP — run this once the cause is known. Restores the exact function
--    from rate-limiting-storage.sql and drops the debug table.
-- ============================================================================
-- create or replace function public.enforce_storage_rate_limit()
-- returns trigger language plpgsql security definer
-- set search_path = public, pg_temp as $$
-- declare
--   v_uid uuid := auth.uid(); v_action text; v_limit int; v_count int;
-- begin
--   if v_uid is null then return null; end if;
--   if tg_op = 'UPDATE' and new.version is not distinct from old.version then
--     return null;
--   end if;
--   if new.bucket_id = 'trek-reviews' then
--     v_action := 'upload:review'; v_limit := 20;
--   elsif new.bucket_id in ('avatars','company-logos','trek-images') then
--     v_action := 'upload'; v_limit := 6;
--   else return null; end if;
--   select count(*) into v_count from public.rate_events
--    where actor = v_uid and action = v_action and at > now() - interval '1 hour';
--   if v_count >= v_limit then
--     raise exception 'You have uploaded too many images in the last hour. Please try again later.'
--       using errcode = 'P0001';
--   end if;
--   insert into public.rate_events (actor, action) values (v_uid, v_action);
--   return null;
-- end; $$;
--
-- drop table if exists public.rate_debug;
-- ============================================================================
