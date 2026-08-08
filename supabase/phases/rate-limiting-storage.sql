-- ============================================================================
-- RATE LIMITING — PHASE 2: STORAGE UPLOADS (2026-08-05)
-- ============================================================================
-- Run this whole file in the Supabase SQL Editor. It is idempotent.
--
-- ⚠️ BEFORE RUNNING: confirm the editor tab is on project dtjmyqogeozrzzbdjokr.
--    select current_database(), to_regclass('public.rate_events');
--    Phase 1 lost a cycle to a 42P01 that was a wrong-project tab, not a bug.
--
-- Phase 1 (rate-limiting.sql) capped the core write paths. Uploads were left
-- uncapped: every bucket had file_size_limit = null and allowed_mime_types =
-- null, so the only ceiling was Supabase's global 50MB and any content type was
-- accepted. compressImage() runs in the browser and is skipped entirely by
-- calling the Storage API directly with the publishable key.
--
-- TWO LAYERS, because they stop different things:
--   A. Bucket config  -> caps the size of ONE upload, at the Storage API edge,
--                        before the bytes are stored.
--   B. Row trigger    -> caps HOW MANY uploads one user can make per hour.
-- Layer A alone still allows 10,000 x 3MB. Layer B alone still allows 6 x 50MB.
--
-- WHY A TRIGGER IS POSSIBLE HERE AT ALL: storage.objects is owned by
-- supabase_storage_admin, but `postgres` holds the TRIGGER privilege on it, so
-- the SQL Editor can create one. It does NOT hold CREATE on the storage schema,
-- which is why the function below lives in public.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- A. PER-UPLOAD CEILING — bucket config
--
-- 3 MB: compressImage() targets 1MB, but on failure it returns the ORIGINAL
-- file (src/utils/imageCompression.ts) — a 2MB cap would reject real uploads
-- every time that fallback fires. 3MB leaves room for it without being a
-- meaningful cost ceiling on its own.
--
-- MIME allowlist is enforced by storage-api against the declared content-type.
-- It is a guardrail, not a scanner — it stops "upload my 40MB video/mp4 to the
-- avatars bucket", not a renamed file. That is the intended scope.
--
-- trek-profile is deliberately untouched: 14 legacy objects, no policies, no
-- client write path. Nothing can upload to it, so a cap would be decoration.
-- ---------------------------------------------------------------------------
update storage.buckets
set file_size_limit    = 3145728,  -- 3 MiB
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id in ('avatars','company-logos','trek-images','trek-reviews');


-- ---------------------------------------------------------------------------
-- B. PER-USER UPLOAD RATE — one trigger over all buckets
--
-- Reuses public.rate_events from Phase 1 (RLS on, zero policies, grants
-- revoked, pruned hourly by the prune-rate-events cron). No new table.
--
-- WHY rate_events AND NOT A COUNT OF storage.objects — the object table is not
-- a truthful counter in exactly the two places that matter:
--   * avatars uses the fixed path {uid}.{ext} with upsert:true, so it is ONE
--     row forever no matter how many times it is overwritten.
--   * review photos are user-deletable, so a flood can erase its own evidence.
--
-- WHY `INSERT OR UPDATE` AND NOT `INSERT` — same avatar fact. After the first
-- upload every avatar write is an UPDATE, so an INSERT-only trigger would leave
-- the single worst path (no compression, fixed path, unbounded repeat)
-- completely unguarded. The version check below keeps this honest: storage-api
-- issues a new `version` for every real upload, so a metadata-only touch or a
-- rename is not miscounted as one.
--
-- WHY A TRIGGER AND NOT FOUR RLS `WITH CHECK` PREDICATES — a WITH CHECK cannot
-- record an attempt (a side-effecting function in a policy is evaluated an
-- unspecified number of times), the four INSERT policies do not cover the
-- UPDATE path avatars actually uses, and a trigger raises a real message where
-- a failed check gives the client an opaque 42501.
--
-- LIMITS — 6/hour for the single-image flows, as requested. trek-reviews is
-- carved out at 20/hour on purpose: the review form is `multiple` with no file
-- count cap and uploads every photo in one Promise.all, so a single legitimate
-- 8-photo submission would blow a 6/hour budget in one click.
--
-- The limit counts SUCCESSFUL uploads only. A rejected one cannot be recorded —
-- the raise rolls back its own rate_events row (the lesson from Phase 1's
-- invite_company_member). That is the right semantics here anyway: this cap
-- exists to bound stored bytes and spend, and a rejected upload costs neither.
-- ---------------------------------------------------------------------------
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
  -- Service-role / storage-admin / edge-function writes have no session.
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

drop trigger if exists storage_objects_rate_limit on storage.objects;
create trigger storage_objects_rate_limit
  after insert or update on storage.objects
  for each row
  execute function public.enforce_storage_rate_limit();


-- ============================================================================
-- VERIFY — run after applying
-- ============================================================================
-- Buckets capped (expect 4 rows, 3145728, 3 mime types; trek-profile null):
--   select id, file_size_limit, allowed_mime_types from storage.buckets order by id;
--
-- Trigger present, AFTER INSERT OR UPDATE, FOR EACH ROW (expect tgtype = 21):
--   select tgname, tgtype, tgenabled from pg_trigger
--    where tgrelid = 'storage.objects'::regclass and tgname = 'storage_objects_rate_limit';
--
-- Function present and SECURITY DEFINER (expect prosecdef = t):
--   select proname, prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and proname = 'enforce_storage_rate_limit';
--
-- rate_events still unreachable from the client (expect f, f, 0):
--   select has_table_privilege('authenticated','public.rate_events','select'),
--          has_table_privilege('anon','public.rate_events','select'),
--          (select count(*) from pg_policies where tablename = 'rate_events');
--
-- Live counters (after a real upload through the UI):
--   select action, count(*) from public.rate_events
--    where at > now() - interval '1 hour' group by action;
--
-- MANUAL TEST that cannot be done in SQL — auth.uid() must be visible inside a
-- trigger fired by storage-api (RLS policies rely on it, so it should be, but
-- this trigger is the first thing in this project to depend on it OUTSIDE a
-- policy). Upload one avatar through /edits and confirm a row appears above
-- with action='upload'. If nothing appears, the session is not reaching the
-- trigger and the cap is silently inert.
-- ============================================================================
