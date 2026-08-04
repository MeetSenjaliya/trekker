-- ============================================================================
-- TREKKER — MULTI-TENANT MIGRATION (single-company -> multi-company platform)
-- ============================================================================
-- Adds: companies (tenants), company_members (staff/roles), platform_admins
-- (super-admin, manual-only), company_id ownership on treks, company-scoped
-- RLS everywhere, company-scoped storage buckets, and the SECURITY DEFINER
-- RPCs that mediate every cross-table write (apply/approve/reject/suspend a
-- company, view a batch roster).
--
-- Apply this AFTER supabase/schema.sql (it assumes the existing schema is
-- live). Run top-to-bottom in the Supabase SQL Editor. Idempotent where
-- practical (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS), but the
-- backfill in section 9 is a one-time data migration — read it before running.
--
-- MANUAL STEPS YOU MUST DO (see bottom of file and MULTI_TENANT_PLAN.md):
--   1. Before running section 9, decide who owns the "Trekker Originals"
--      default company (it defaults to your earliest-signed-up user).
--   2. After running this whole file, insert yourself into platform_admins —
--      there is NO client path to do this (by design). Template at the very
--      bottom.
-- ============================================================================


-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================
do $$ begin
  create type public.company_status as enum ('pending', 'approved', 'rejected', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.company_role as enum ('owner', 'admin', 'staff');
exception when duplicate_object then null; end $$;


-- ============================================================================
-- 2. TABLES
-- ============================================================================

-- companies — a tenant/operator on the platform. Public storefront data lives
-- here; approval workflow fields (status/approved_by/approved_at) are
-- protected from self-edit by the trigger in section 5.
create table if not exists public.companies (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(trim(name)) > 0),
  slug              text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  description       text,
  logo_url          text,
  cover_image_url   text,
  website           text,
  contact_email     text,
  contact_phone     text,
  status            public.company_status not null default 'pending',
  rejection_reason  text,
  created_by        uuid not null references auth.users(id),
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  constraint companies_slug_key unique (slug)
);

create index if not exists companies_status_idx on public.companies (status);

-- Spam guard: a user can only have ONE pending application at a time. Combined
-- with the RPC forcing status='pending' on create, this stops a single account
-- from flooding the moderation queue. (Approved/rejected/suspended companies
-- aren't limited — a user could reapply after rejection.)
create unique index if not exists companies_one_pending_per_creator
  on public.companies (created_by) where (status = 'pending');

-- company_members — links auth users to a company with a role. A user CAN
-- belong to more than one company (e.g. a freelance guide); the app UI
-- typically only surfaces one at a time. role='owner' is set exactly once, by
-- apply_for_company() — there is no client write path that can create or
-- reassign an owner row (see RLS in section 6).
create table if not exists public.company_members (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        public.company_role not null default 'staff',
  created_at  timestamptz not null default now(),
  constraint company_members_company_user_key unique (company_id, user_id)
);

create index if not exists company_members_user_idx    on public.company_members (user_id);
create index if not exists company_members_company_idx on public.company_members (company_id);

-- platform_admins — super-admin allowlist. Deliberately has NO client-facing
-- policies at all (see section 6): RLS is enabled with zero policies, which
-- default-denies every role including `authenticated`. The ONLY way to add a
-- row is the Supabase SQL Editor (i.e. you, manually) — this is the whole
-- point: a client-reachable "make me admin" path would be a privilege-
-- escalation vulnerability, so there isn't one. Checked via is_platform_admin().
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);

-- treks — add tenant ownership + a soft-delete flag. Nullable for now; backfilled
-- and locked to NOT NULL in section 9 (after existing rows get an owner).
alter table public.treks add column if not exists company_id uuid references public.companies(id);
alter table public.treks add column if not exists is_active boolean not null default true;

create index if not exists treks_company_id_idx on public.treks (company_id);


-- ============================================================================
-- 3. HELPER FUNCTIONS (SECURITY DEFINER — mirror the is_chat_participant
--    pattern already used for chat RLS: bypasses RLS on the membership tables
--    so policies that call these functions don't recurse, pinned search_path
--    so they can't be tricked by a session-local search_path).
-- ============================================================================

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.company_members cm
    where cm.company_id = p_company_id and cm.user_id = auth.uid()
  );
$$;
grant execute on function public.is_company_member(uuid) to authenticated;

create or replace function public.is_company_admin(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.company_members cm
    where cm.company_id = p_company_id and cm.user_id = auth.uid()
      and cm.role in ('owner', 'admin')
  );
$$;
grant execute on function public.is_company_admin(uuid) to authenticated;

-- is_trek_visible — single source of truth for "can the current caller see
-- this trek": public catalogue rule (active + company approved) OR the caller
-- is staff at the owning company OR a platform admin OR the caller already
-- holds a booking on one of the trek's batches. Used by treks AND trek_batches
-- SELECT policies so a batch can't leak dates for a hidden trek.
--
-- The fourth (participant) arm is what keeps a plain user's OWN booking history
-- readable after a trek is archived (is_active=false) or its company suspended:
-- without it the trek_batches!inner->treks joins in profile history and
-- favorites silently drop the row and the user's booking vanishes from the UI,
-- even though their trek_participants row and chat thread survive by design.
-- It does NOT re-list the trek publicly — search_treks() filters on
-- `t.is_active and c.status = 'approved'` directly, so the catalogue/storefront
-- stay clean; only people already booked regain read access. No recursion risk:
-- SECURITY DEFINER bypasses RLS on the inner tables (same as the other arms).
create or replace function public.is_trek_visible(p_trek_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.treks t
    join public.companies c on c.id = t.company_id
    where t.id = p_trek_id
      and (
        (t.is_active and c.status = 'approved')
        or public.is_company_member(t.company_id)
        or public.is_platform_admin()
        or exists (
          select 1
          from public.trek_participants tp
          join public.trek_batches tb on tb.id = tp.batch_id
          where tb.trek_id = t.id and tp.user_id = auth.uid()
        )
      )
  );
$$;
grant execute on function public.is_trek_visible(uuid) to anon, authenticated;

-- batch_has_participants — does ANY user hold a booking in this batch? Runs as
-- SECURITY DEFINER so it sees every participant row, not just the caller's own:
-- trek_participants SELECT is own-row-only, so an inline `not exists (... tp)`
-- subquery in the delete policy would only test whether the CALLER joined,
-- letting an owner/admin who never booked delete a batch full of other users'
-- bookings. Used by the "company deletes empty batches" policy below.
create or replace function public.batch_has_participants(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.trek_participants tp
    where tp.batch_id = p_batch_id
  );
$$;
grant execute on function public.batch_has_participants(uuid) to authenticated;

-- batch_has_conversation — does this batch own a chat conversation? SECURITY
-- DEFINER for the same reason as batch_has_participants: conversations SELECT is
-- is_chat_participant-only, so an inline subquery would be blind to a chat the
-- deleting owner never joined. join_trek_and_chat creates one conversation per
-- batch on first join and nothing deletes it, so a vacated batch keeps its
-- conversation and the FK (conversations.batch_id, NO ACTION) would otherwise
-- reject the delete (23503). Used by the "company deletes empty batches" policy.
create or replace function public.batch_has_conversation(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversations c
    where c.batch_id = p_batch_id
  );
$$;
grant execute on function public.batch_has_conversation(uuid) to authenticated;


-- ============================================================================
-- 4. RPCs — the mediated write paths (mirrors join_trek_and_chat's pattern:
--    SECURITY DEFINER, derive the caller from auth.uid(), never trust a
--    client-supplied identity or privileged field).
-- ============================================================================

-- apply_for_company — the ONLY way a company row is created. Forces
-- status='pending' as a literal (never client-supplied) and atomically makes
-- the applicant the 'owner' member. There is intentionally no INSERT policy
-- on public.companies — this RPC is the sole entry point.
create or replace function public.apply_for_company(
  p_name          text,
  p_slug          text,
  p_description   text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_website       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_company_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Company name is required';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Slug must be lowercase letters, numbers and hyphens only';
  end if;

  insert into public.companies
    (name, slug, description, contact_email, contact_phone, website, created_by, status)
  values
    (trim(p_name), p_slug, p_description, p_contact_email, p_contact_phone, p_website, v_uid, 'pending')
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, role)
  values (v_company_id, v_uid, 'owner');

  return jsonb_build_object('company_id', v_company_id, 'status', 'pending');
exception
  when unique_violation then
    raise exception 'You already have a pending application, or that URL slug is taken';
end;
$$;
grant execute on function public.apply_for_company(text, text, text, text, text, text) to authenticated;

-- approve_company / reject_company / suspend_company — platform-admin-only.
-- Authorization is checked INSIDE the function (not just via grants) so it
-- fails safely even though EXECUTE is granted broadly to `authenticated`
-- (same defense-in-depth pattern as join_trek_and_chat's auth.uid() check).
create or replace function public.approve_company(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can approve companies';
  end if;
  update public.companies
  set status = 'approved', approved_by = auth.uid(), approved_at = now(), rejection_reason = null
  where id = p_company_id;
end;
$$;
grant execute on function public.approve_company(uuid) to authenticated;

create or replace function public.reject_company(p_company_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can reject companies';
  end if;
  update public.companies
  set status = 'rejected', rejection_reason = p_reason, approved_by = null, approved_at = null
  where id = p_company_id;
end;
$$;
grant execute on function public.reject_company(uuid, text) to authenticated;

create or replace function public.suspend_company(p_company_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can suspend companies';
  end if;
  update public.companies
  set status = 'suspended', rejection_reason = p_reason
  where id = p_company_id;
end;
$$;
grant execute on function public.suspend_company(uuid, text) to authenticated;

-- get_company_batch_participants — the ONLY way company staff see participant
-- PII (name/phone/emergency contact). Re-checks membership against the
-- specific batch's owning company on every call; never exposes the raw
-- `profiles` table to company members. Returns nothing (empty set, not an
-- error) if the batch doesn't belong to the caller's company — avoids leaking
-- "this batch id exists" via an exception message.
create or replace function public.get_company_batch_participants(p_batch_id uuid)
returns table (
  participant_id     uuid,
  user_id             uuid,
  full_name           text,
  avatar_url          text,
  phone_no            varchar,
  emergency_contact   text,
  emergency_no        varchar,
  status              text,
  joined_at           timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
begin
  select t.company_id into v_company_id
  from public.trek_batches tb
  join public.treks t on t.id = tb.trek_id
  where tb.id = p_batch_id;

  if v_company_id is null or not public.is_company_member(v_company_id) then
    return;
  end if;

  return query
  select tp.id, p.id, p.full_name, p.avatar_url, p.phone_no, p.emergency_contact, p.emergency_no,
         tp.status, tp.joined_at
  from public.trek_participants tp
  join public.profiles p on p.id = tp.user_id
  where tp.batch_id = p_batch_id
  order by tp.joined_at asc;
end;
$$;
grant execute on function public.get_company_batch_participants(uuid) to authenticated;


-- ============================================================================
-- 5. TRIGGERS
-- ============================================================================

-- protect_company_admin_fields — silently pins status/approved_by/approved_at/
-- rejection_reason/created_by back to their OLD values on any UPDATE from a
-- non-platform-admin, regardless of what the client sends. This is the actual
-- security boundary for "company admins can edit their profile but not
-- approve themselves" — RLS's WITH CHECK cannot compare NEW vs OLD directly,
-- so a BEFORE UPDATE trigger is the standard way to protect specific columns.
-- Runs before the UPDATE policy's WITH CHECK is evaluated.
create or replace function public.protect_company_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    new.status            := old.status;
    new.approved_by       := old.approved_by;
    new.approved_at       := old.approved_at;
    new.rejection_reason  := old.rejection_reason;
    new.created_by        := old.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_company_admin_fields on public.companies;
create trigger trg_protect_company_admin_fields
  before update on public.companies
  for each row execute function public.protect_company_admin_fields();

revoke execute on function public.protect_company_admin_fields() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- REQUIRED FIX (not optional): trg_initial_trek_message currently fires AFTER
-- INSERT on treks and errors on every single call — it inserts into
-- `trek_messages`, a table that has never existed (see DATABASE.md Known
-- Issues / schema.sql BUG comment). Until now nothing created treks through
-- the app (SQL-seeded only), so this never surfaced. The new company admin UI
-- creates treks via direct INSERT, so this bug must be fixed now or trek
-- creation will fail 100% of the time. Its original intent (seed a welcome
-- chat message) is superseded by join_trek_and_chat(), which creates the
-- batch conversation when the first participant actually books a date — so
-- dropping the trigger has no functional loss. The function itself is left in
-- place (now unused) rather than dropped, matching this repo's convention of
-- not deleting pre-existing code outside the scope of the current change.
-- ----------------------------------------------------------------------------
drop trigger if exists trg_initial_trek_message on public.treks;


-- ============================================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================================
alter table public.companies       enable row level security;
alter table public.company_members enable row level security;
alter table public.platform_admins enable row level security;
-- platform_admins gets ZERO policies below — enabling RLS with no policies
-- default-denies SELECT/INSERT/UPDATE/DELETE to every role. That is
-- intentional: see the table comment in section 2.

-- ---- companies ---------------------------------------------------------------
-- Public sees only approved companies; members see their own regardless of
-- status (so they can watch their own pending/rejected application); platform
-- admins see everything (moderation queue).
drop policy if exists "view companies" on public.companies;
create policy "view companies" on public.companies for select to public using (
  status = 'approved' or public.is_company_member(id) or public.is_platform_admin()
);
-- No INSERT policy: creation is exclusively via apply_for_company().
-- No DELETE policy: companies are suspended, never hard-deleted (preserves
-- historical treks/bookings/reviews/chat for existing participants).
drop policy if exists "company admins update own company" on public.companies;
create policy "company admins update own company" on public.companies for update to authenticated
using (public.is_company_admin(id) or public.is_platform_admin())
with check (public.is_company_admin(id) or public.is_platform_admin());

-- ---- company_members ----------------------------------------------------------
-- Members (any role) can see their own company's roster; platform admins see all.
drop policy if exists "view company members" on public.company_members;
create policy "view company members" on public.company_members for select to authenticated using (
  public.is_company_member(company_id) or public.is_platform_admin()
);
-- Owners/admins can invite STAFF only (never admin/owner) via direct INSERT —
-- closes the "staff invites themselves as owner" privilege-escalation path.
-- The only way a row gets role='owner' is apply_for_company()'s own INSERT,
-- which runs SECURITY DEFINER and bypasses this policy entirely.
drop policy if exists "company admins invite staff" on public.company_members;
create policy "company admins invite staff" on public.company_members for insert to authenticated
with check (public.is_company_admin(company_id) and role = 'staff');
-- Owners/admins can promote/demote between admin and staff, but the USING
-- clause excludes 'owner' rows (can't touch an owner row) and the WITH CHECK
-- excludes setting role='owner' (can't create a second owner this way).
drop policy if exists "company admins manage member roles" on public.company_members;
create policy "company admins manage member roles" on public.company_members for update to authenticated
using (public.is_company_admin(company_id) and role <> 'owner')
with check (public.is_company_admin(company_id) and role in ('admin', 'staff'));
-- Same exclusion on delete: an owner row can never be removed by another
-- member (only by direct SQL-editor access) — guarantees a company can never
-- end up with zero owners via the client.
drop policy if exists "company admins remove members" on public.company_members;
create policy "company admins remove members" on public.company_members for delete to authenticated
using (public.is_company_admin(company_id) and role <> 'owner');

-- ---- treks (rebuild SELECT to be tenant-aware; add write policies) -----------
drop policy if exists "view all treks" on public.treks;
create policy "view treks" on public.treks for select to public using (public.is_trek_visible(id));

drop policy if exists "company members create treks" on public.treks;
create policy "company members create treks" on public.treks for insert to authenticated
with check (public.is_company_member(company_id));

-- Any company member (owner/admin/staff) can edit their own company's treks,
-- including flipping is_active to archive one — this is the ONLY delete path
-- (no hard DELETE policy exists, protecting trek_batches/participants/reviews
-- FK history). Platform admin can also update any trek (emergency moderation).
drop policy if exists "company members manage own treks" on public.treks;
create policy "company members manage own treks" on public.treks for update to authenticated
using (public.is_company_member(company_id) or public.is_platform_admin())
with check (public.is_company_member(company_id) or public.is_platform_admin());
-- No DELETE policy on treks (soft-delete via is_active only).

-- ---- trek_batches (tenant-aware SELECT; company-managed writes) --------------
drop policy if exists "Anyone can view trek batches" on public.trek_batches;
create policy "view visible trek batches" on public.trek_batches for select to public
using (public.is_trek_visible(trek_id));

drop policy if exists "company manages own batches insert" on public.trek_batches;
create policy "company manages own batches insert" on public.trek_batches for insert to authenticated
with check (
  exists (select 1 from public.treks t where t.id = trek_batches.trek_id and public.is_company_member(t.company_id))
);
drop policy if exists "company manages own batches update" on public.trek_batches;
create policy "company manages own batches update" on public.trek_batches for update to authenticated
using (
  exists (select 1 from public.treks t where t.id = trek_batches.trek_id and public.is_company_member(t.company_id))
)
with check (
  exists (select 1 from public.treks t where t.id = trek_batches.trek_id and public.is_company_member(t.company_id))
);
-- Deletion only allowed while the batch has zero participants AND no chat
-- conversation — never orphan an existing booking/chat by deleting the batch
-- out from under it. (Once someone has joined, archive the parent trek instead.)
drop policy if exists "company deletes empty batches" on public.trek_batches;
create policy "company deletes empty batches" on public.trek_batches for delete to authenticated
using (
  exists (select 1 from public.treks t where t.id = trek_batches.trek_id and public.is_company_member(t.company_id))
  and not public.batch_has_participants(trek_batches.id)
  and not public.batch_has_conversation(trek_batches.id)
);


-- ============================================================================
-- 7. search_treks — extend with an optional company filter (used by the
--    public /company/[slug] storefront page to list just that company's
--    treks, reusing the existing search/sort/pagination machinery instead of
--    a second bespoke query). Backward compatible: existing callers that omit
--    p_company_id are unaffected. Also switches from `public.treks t` to only
--    surfacing tenant-visible rows via is_trek_visible(), so an unapproved or
--    archived company's treks stop appearing in the public Explore/search
--    results the moment this migration is applied.
-- ============================================================================
create or replace function public.search_treks(
  p_search       text    default null,
  p_location     text    default null,
  p_difficulty   text    default null,
  p_min_distance numeric default null,
  p_max_distance numeric default null,
  p_min_price    numeric default null,
  p_max_price    numeric default null,
  p_date_from    date    default null,
  p_sort         text    default 'date',
  p_limit        int     default 6,
  p_offset       int     default 0,
  p_company_id   uuid    default null
)
returns table (
  id                  uuid,
  title               text,
  description         text,
  location            text,
  cover_image_url     text,
  difficulty          public.difficulty,
  distance_km         numeric,
  duration_hours      numeric,
  max_participants    integer,
  estimated_cost      numeric,
  rating              numeric,
  participants_joined smallint,
  next_batch_date     date,
  company_id          uuid,
  company_name        text,
  company_slug        text,
  total_count         bigint
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_str        text;
  v_tsquery    tsquery := null;
  v_has_search boolean := false;
begin
  if p_search is not null and length(trim(p_search)) > 0 then
    v_has_search := true;
    v_str := (
      select string_agg(tok || ':*', ' & ')
      from unnest(
        string_to_array(
          regexp_replace(lower(trim(p_search)), '[^a-z0-9 ]', ' ', 'g'),
          ' ')
      ) as tok
      where tok <> ''
    );
    if v_str is not null and length(v_str) > 0 then
      v_tsquery := to_tsquery('english', v_str);
    end if;
  end if;

  return query
  with filtered as (
    select
      t.id, t.title, t.description, t.location, t.cover_image_url, t.difficulty,
      t.distance_km, t.duration_hours, t.max_participants, t.estimated_cost,
      rr.avg_rating as rating, t.participants_joined,
      nb.next_batch_date,
      c.id as company_id, c.name as company_name, c.slug as company_slug,
      case when v_tsquery is not null then ts_rank(t.fts, v_tsquery) else 0 end as rank
    from public.treks t
    join public.companies c on c.id = t.company_id
    left join lateral (
      select min(b.batch_date) as next_batch_date
      from public.trek_batches b
      where b.trek_id = t.id
        and b.batch_date >= coalesce(p_date_from, current_date)
    ) nb on true
    left join lateral (
      select round(avg(r.rating), 1) as avg_rating
      from public.trek_reviews r
      where r.trek_id = t.id
    ) rr on true
    where
      t.is_active and c.status = 'approved'
      and (not v_has_search or (v_tsquery is not null and t.fts @@ v_tsquery))
      and (p_location     is null or t.location ilike '%' || p_location || '%')
      and (p_difficulty   is null or t.difficulty::text = p_difficulty)
      and (p_min_distance is null or t.distance_km    >= p_min_distance)
      and (p_max_distance is null or t.distance_km    <= p_max_distance)
      and (p_min_price    is null or t.estimated_cost >= p_min_price)
      and (p_max_price    is null or t.estimated_cost <= p_max_price)
      and (p_date_from    is null or nb.next_batch_date is not null)
      and (p_company_id   is null or t.company_id = p_company_id)
  )
  select
    f.id, f.title, f.description, f.location, f.cover_image_url, f.difficulty,
    f.distance_km, f.duration_hours, f.max_participants, f.estimated_cost,
    f.rating, f.participants_joined, f.next_batch_date,
    f.company_id, f.company_name, f.company_slug,
    count(*) over () as total_count
  from filtered f
  order by
    case when p_sort = 'relevance'     then f.rank           end desc nulls last,
    case when p_sort = 'price_asc'     then f.estimated_cost end asc  nulls last,
    case when p_sort = 'price_desc'    then f.estimated_cost end desc nulls last,
    case when p_sort = 'distance_asc'  then f.distance_km    end asc  nulls last,
    case when p_sort = 'distance_desc' then f.distance_km    end desc nulls last,
    case when p_sort = 'rating'        then f.rating         end desc nulls last,
    case when p_sort = 'date'          then f.next_batch_date end asc nulls last,
    f.title asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

grant execute on function public.search_treks(
  text, text, text, numeric, numeric, numeric, numeric, date, text, int, int, uuid
) to anon, authenticated;

-- Drop the old 11-arg overload so PostgREST doesn't have two ambiguous
-- search_treks signatures to choose between.
drop function if exists public.search_treks(
  text, text, text, numeric, numeric, numeric, numeric, date, text, int, int
);


-- ============================================================================
-- 8. STORAGE — company-scoped buckets (mirrors the {uid}/file convention used
--    by avatars/trek-reviews, but keyed by company_id since a logo/trek image
--    is owned by the company, not a single user). Read is authenticated-only
--    (blocks anon listing, same as avatars/trek-reviews); write is scoped to
--    company membership.
-- ============================================================================
insert into storage.buckets (id, name, public) values ('company-logos', 'company-logos', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('trek-images',   'trek-images',   true) on conflict (id) do nothing;

drop policy if exists "Authenticated users can view company logos" on storage.objects;
create policy "Authenticated users can view company logos" on storage.objects
  for select to authenticated using (bucket_id = 'company-logos');

drop policy if exists "Company members upload own logo" on storage.objects;
create policy "Company members upload own logo" on storage.objects for insert to authenticated
with check (bucket_id = 'company-logos' and public.is_company_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "Company members update own logo" on storage.objects;
create policy "Company members update own logo" on storage.objects for update to authenticated
using (bucket_id = 'company-logos' and public.is_company_member(((storage.foldername(name))[1])::uuid))
with check (bucket_id = 'company-logos' and public.is_company_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "Company members delete own logo" on storage.objects;
create policy "Company members delete own logo" on storage.objects for delete to authenticated
using (bucket_id = 'company-logos' and public.is_company_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "Authenticated users can view trek images" on storage.objects;
create policy "Authenticated users can view trek images" on storage.objects
  for select to authenticated using (bucket_id = 'trek-images');

drop policy if exists "Company members upload trek images" on storage.objects;
create policy "Company members upload trek images" on storage.objects for insert to authenticated
with check (bucket_id = 'trek-images' and public.is_company_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "Company members update trek images" on storage.objects;
create policy "Company members update trek images" on storage.objects for update to authenticated
using (bucket_id = 'trek-images' and public.is_company_member(((storage.foldername(name))[1])::uuid))
with check (bucket_id = 'trek-images' and public.is_company_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "Company members delete trek images" on storage.objects;
create policy "Company members delete trek images" on storage.objects for delete to authenticated
using (bucket_id = 'trek-images' and public.is_company_member(((storage.foldername(name))[1])::uuid));


-- ============================================================================
-- 9. BACKFILL — one-time data migration. Read before running.
-- ============================================================================
-- Creates a default "Trekker Originals" company and attaches every existing
-- (SQL-seeded, ownerless) trek to it, then locks treks.company_id to NOT
-- NULL. `created_by`/owner defaults to your earliest-signed-up user WITH A
-- PROFILE ROW as a placeholder owner — deliberately sourced from
-- public.profiles, not auth.users: company_members.user_id references
-- profiles(id), and on the live DB auth.users has more rows than profiles
-- (some signups never completed profile creation), so picking straight from
-- auth.users could pick a user with no profile row and fail this INSERT on a
-- foreign-key violation. If you want a specific account to own/manage this
-- company from the new dashboard, replace the subquery below with:
--   (select id from public.profiles where email = 'you@example.com')
-- before running this section.
do $$
declare
  v_company_id uuid;
  v_owner_id uuid;
begin
  select id into v_owner_id from public.profiles order by created_at asc limit 1;
  if v_owner_id is null then
    raise exception 'No profiles exist yet — create at least one account before running this backfill, or hardcode v_owner_id manually';
  end if;

  select id into v_company_id from public.companies where slug = 'trekker-originals';
  if v_company_id is null then
    insert into public.companies (name, slug, description, status, created_by, approved_at)
    values (
      'Trekker Originals',
      'trekker-originals',
      'Original Trekker-curated treks.',
      'approved',
      v_owner_id, -- see comment above
      now()
    )
    returning id into v_company_id;

    insert into public.company_members (company_id, user_id, role)
    values (v_company_id, v_owner_id, 'owner')
    on conflict (company_id, user_id) do nothing;
  end if;

  update public.treks set company_id = v_company_id where company_id is null;
end $$;

alter table public.treks alter column company_id set not null;


-- ============================================================================
-- 10. MANUAL STEP — make yourself a platform admin
-- ============================================================================
-- There is no client-reachable way to do this (by design — see section 2).
-- Uncomment and run this once, with your own account's email:
--
-- insert into public.platform_admins (user_id)
-- select id from auth.users where email = 'YOUR_EMAIL_HERE'
-- on conflict (user_id) do nothing;
-- ============================================================================
