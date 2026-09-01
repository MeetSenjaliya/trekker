-- ============================================================================
-- TREKKER — DATABASE SCHEMA (GENERATED FILE — DO NOT EDIT)
-- ============================================================================
-- Built by scripts/build-schema.mjs from supabase/migrations/*.sql, in order.
-- To change the schema: add the next migration, apply it in the Supabase SQL
-- Editor, then run `npm run db:schema`. Hand edits here are overwritten and
-- `npm test` fails while this file and the migrations disagree.
--
-- Running this whole file top-to-bottom builds an empty project up to the
-- current state. Against a database that already has some of these
-- migrations, run the individual missing ones instead.
--
-- ⚠️ A later migration can supersede an earlier one, so an object may appear
-- here more than once and only the LAST occurrence is live. When looking up
-- the current definition of a policy or function, read the last match, not
-- the first.
--
-- Migrations folded in:
--   0001_baseline.sql
--   0002_trek-returning-and-chat-policy-roles.sql
--   0003_lock-platform-admins-grants.sql
--   0004_realtime-private-channel-authorization.sql
--   0005_cap-trek-profile-bucket-mime.sql
--   0006_scope-storage-select-to-own-prefix.sql
--   0007_drop-dead-trek-email-notification-triggers.sql
--   0008_drop-embedded-publishable-key-from-notification-trigger.sql
-- ============================================================================

-- ##########################################################################
-- # 0001_baseline.sql
-- ##########################################################################

-- ============================================================================
-- 0001 — BASELINE
-- ============================================================================
-- The live Supabase database (project dtjmyqogeozrzzbdjokr) as it stood on
-- 2026-08-13, captured as migration #1. Everything before this date — the
-- original schema, the multi-tenant migration, phases A–I, the security fixes,
-- the storage and rate-limit work — is folded in here as one end state rather
-- than replayed step by step. `supabase/phases/*.sql` and
-- `supabase/security-fixes.sql` remain as the historical record of how it was
-- reached and why; nothing new goes in them.
--
-- ALREADY APPLIED TO PRODUCTION. Do not re-run this file against the live
-- database — see supabase/migrations/README.md for the one-time bootstrap that
-- records it as applied. Run it top-to-bottom only on a fresh/dev project.
--
-- Ordering is dependency-safe. Statements are idempotent where practical
-- (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS). Known bugs in the live
-- DB are reproduced here and flagged with "BUG:" comments rather than silently
-- fixed — see DATABASE.md.
-- ============================================================================


-- ============================================================================
-- 0. MIGRATION LEDGER
-- ============================================================================
-- What is actually deployed, recorded by the database itself. §1.3 of
-- CODE_REVIEW.md is what happens without this: a status comment in a SQL file
-- outlived its truth and produced a false critical finding. A comment is not
-- evidence; this table is. Read it over the read-only MCP server with
--   select version, name, applied_at from supabase_migrations.schema_migrations
--   order by version;
--
-- The schema name and column shape match what the Supabase CLI creates, so
-- adopting `supabase db push` later finds a ledger it understands. It lives
-- outside `public` deliberately: PostgREST exposes `public`, so a table there
-- would be readable by anon.
create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  name       text,
  statements text[],
  applied_at timestamptz not null default now()
);

revoke all on schema supabase_migrations from public, anon, authenticated;
revoke all on all tables in schema supabase_migrations from public, anon, authenticated;

-- Third lock, and the cheapest one. The schema is not in PostgREST's exposed
-- list and the grants above are already stripped, so this changes nothing
-- today — it is what holds if someone later exposes the schema. Deny-all is
-- safe here because every role that must read the ledger bypasses RLS:
-- `postgres` and `supabase_read_only_user` (the MCP reader) both have
-- rolbypassrls, and the owner is exempt absent FORCE ROW LEVEL SECURITY.
alter table supabase_migrations.schema_migrations enable row level security;


-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_net";          -- used by notify_trek_* functions
create extension if not exists "pg_cron";         -- prunes rate_events (§13.5)
-- Also present on the project (managed by Supabase): pg_stat_statements, supabase_vault.


-- ============================================================================
-- 2. ENUM TYPES
-- ============================================================================
do $$ begin
  create type public.difficulty as enum ('Easy', 'Moderate', 'Hard', 'Expert');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.experience_level as enum ('Beginner', 'Intermediate', 'Expert');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.gender as enum ('Male', 'Female');
exception when duplicate_object then null; end $$;

-- The `mood` enum ('Biginer','intermediate','expert') was dropped 2026-08-12:
-- unused by any column, and a typo'd near-duplicate of `experience_level`.


-- ============================================================================
-- 3. TABLES
-- ============================================================================

-- profiles — 1:1 with auth.users. Holds PII (email/phone/emergency/age/Gender).
-- Public reads go through the public_profiles view, NOT this table (see RLS).
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  full_name          text,
  avatar_url         text,
  bio                text,
  emergency_contact  text,
  created_at         timestamptz default now(),
  email              text not null unique,
  age                integer,
  "Gender"           public.gender,
  experience_level   public.experience_level,
  phone_no           varchar,
  emergency_no       varchar
);

-- treks — the catalogue. Since 2026-07-02 every trek is owned by a company:
-- §12 adds company_id (NOT NULL) + is_active (soft-delete), and public reads
-- go through is_trek_visible() instead of an unconditional policy.
create table if not exists public.treks (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  description         text,
  location            text,
  cover_image_url     text,
  difficulty          public.difficulty not null,
  distance_km         numeric,
  duration_hours      numeric,
  meeting_point       text,
  max_participants    integer,
  estimated_cost      numeric,
  gear_checklist      text[],
  rating              smallint,
  plan                text,
  meeting_point2      text,
  participants_joined smallint,
  -- Full-text search over title+description+location; backs the Explore search
  -- box via the search_treks() RPC. GIN-indexed below.
  fts                 tsvector generated always as (
                        to_tsvector('english',
                          coalesce(title, '') || ' ' ||
                          coalesce(description, '') || ' ' ||
                          coalesce(location, ''))
                      ) stored
);

create index if not exists treks_fts_idx           on public.treks using gin (fts);
create index if not exists treks_estimated_cost_idx on public.treks (estimated_cost);
create index if not exists treks_distance_km_idx    on public.treks (distance_km);

-- trek_batches — a dated departure of a trek. One chat per batch.
create table if not exists public.trek_batches (
  id               uuid primary key default gen_random_uuid(),
  trek_id          uuid not null references public.treks(id) on delete cascade,
  batch_date       date not null,
  max_participants integer,
  created_at       timestamptz default now(),
  constraint trek_batches_trekid_batchdate_key unique (trek_id, batch_date)
);

-- trek_participants — who booked which batch. One row per (user, batch).
-- status: 'confirmed' holds a seat (and a chat seat); 'waitlisted' joined a full
-- batch and is promoted FIFO by promote_waitlist_on_leave() when a slot frees up.
create table if not exists public.trek_participants (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid references public.profiles(id),
  batch_id  uuid references public.trek_batches(id) on delete cascade,
  joined_at timestamptz default now(),
  status    text not null default 'confirmed'
            check (status in ('confirmed', 'waitlisted')),
  constraint trek_participants_user_batch_key unique (user_id, batch_id)
);

create index if not exists trek_participants_batch_status_idx
  on public.trek_participants (batch_id, status, joined_at);

-- trek_reviews — one review per (trek, user). photo_urls/trek_date added later.
create table if not exists public.trek_reviews (
  id         uuid primary key default gen_random_uuid(),
  trek_id    uuid references public.treks(id) on delete cascade,
  user_id    uuid references public.profiles(id),
  rating     integer check (rating >= 1 and rating <= 5),
  comment    text,
  created_at timestamptz default now(),
  photo_urls text[] default '{}'::text[],
  trek_date  date,
  constraint trek_reviews_trek_id_user_id_key unique (trek_id, user_id)
);

-- The unique above leads with trek_id, so per-trek reads are covered but the
-- user_id FK was not — profile cascades scanned the table (§18).
create index if not exists trek_reviews_user_idx on public.trek_reviews (user_id);

-- favorites — user ⇔ trek wishlist. No surrogate PK; uniqueness on (user,trek).
create table if not exists public.favorites (
  user_id    uuid not null references public.profiles(id),
  trek_id    uuid references public.treks(id) on delete cascade,
  created_at timestamptz default now(),
  constraint favorites_user_id_trek_id_key unique (user_id, trek_id)
);

-- Same shape as trek_reviews: the unique serves "my favourites", not the
-- trek_id FK that a trek delete cascades through (§18).
create index if not exists favorites_trek_idx on public.favorites (trek_id);

-- conversations — one per trek batch (batch_id is UNIQUE).
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid unique references public.trek_batches(id),
  name       text,
  created_at timestamptz default now()
);

-- conversation_participants — chat membership. Uniqueness on (conversation,user).
-- last_read_at is the unread-count watermark: get_unread_counts() counts messages
-- newer than it, mark_conversation_read() advances it (both §5).
create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  joined_at       timestamptz default now(),
  last_read_at    timestamptz not null default now(),
  constraint conversation_participants_conv_user_key unique (conversation_id, user_id)
);

-- The unique above leads with conversation_id, which answers "who is in this
-- chat?" but not "which chats am I in?" — the driving side of
-- get_unread_counts() and of the sidebar read. Covering for both (they select
-- only conversation_id) and it indexes the user_id FK (§18).
create index if not exists conversation_participants_user_conv_idx
  on public.conversation_participants (user_id, conversation_id);

-- conversation_messages — chat messages. Composite PK (created_at, id).
-- Supports soft-delete, reply threading, and emoji reactions (jsonb).
-- is_announcement (§17) marks an operator notice; only post_batch_announcement()
-- may set it — both write policies pin it to false for PostgREST clients.
create table if not exists public.conversation_messages (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  message         text not null,
  created_at      timestamptz not null default now(),
  id              uuid not null default gen_random_uuid(),
  updated_at      timestamptz,
  is_deleted      boolean default false,
  reply_to        uuid,
  reactions       jsonb default '{}'::jsonb,
  is_announcement boolean not null default false,
  primary key (created_at, id)
);

-- The chat read path: equality on conversation_id then a descending range +
-- LIMIT on created_at. Column order is the point — this serves the filter AND
-- the sort from one index range scan, so no Sort node and it stops after 30
-- rows. Neither the pkey (created_at first) nor the rate-limit index (user_id
-- first) can do that (§18).
create index if not exists conversation_messages_conv_created_idx
  on public.conversation_messages (conversation_id, created_at desc);

-- user_stats — aggregate per user. System-managed; rebuilt from source by
-- recompute_user_stats() (triggers + daily pg_cron). treks_organised has no
-- data source yet (no organiser column) and stays 0. avg_rating was dropped.
create table if not exists public.user_stats (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  treks_completed  integer default 0 check (treks_completed >= 0),
  treks_organised  integer default 0 check (treks_organised >= 0),
  total_distance_km numeric default 0 check (total_distance_km >= 0),
  last_updated     timestamptz default now()
);

-- user_monthly_activity — per-user per-month counters. `month` must be day 1.
create table if not exists public.user_monthly_activity (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  month           date not null check (extract(day from month) = 1),
  treks_joined    integer default 0 check (treks_joined >= 0),
  photos_shared   integer default 0 check (photos_shared >= 0),
  reviews_written integer default 0 check (reviews_written >= 0),
  distance_km     numeric default 0 check (distance_km >= 0),
  primary key (user_id, month)
);

-- user_achievements — earned badges per user. Append-only, system-managed:
-- clients have SELECT on own rows only; all writes go through the SECURITY
-- DEFINER award_user_achievements() (chained off recompute_user_stats). The
-- badge catalog (key -> name/icon) lives in src/lib/achievements.ts; criteria
-- thresholds live in award_user_achievements(). See migration
-- 20260619030000_user_achievements.sql.
create table if not exists public.user_achievements (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  achievement_key text not null,
  earned_at       timestamptz not null default now(),
  primary key (user_id, achievement_key)
);


-- ============================================================================
-- 4. VIEWS
-- ============================================================================

-- public_profiles — non-PII projection of profiles, readable by anon +
-- authenticated. Runs with owner privileges (security_invoker = false) so it
-- can return all rows while the base table stays own-row-only.
-- NOTE: Supabase's linter flags this as `security_definer_view` (ERROR). It is
-- an intentional trade-off so cross-user names/avatars (chat, review authors)
-- are visible without exposing PII. See SECURITY_AUDIT_ISSUE.md.
create or replace view public.public_profiles as
  select id, full_name, avatar_url
  from public.profiles;

grant select on public.public_profiles to anon, authenticated;

-- user_completed_treks — treks whose batch date is in the past, per user.
create or replace view public.user_completed_treks as
  select tp.user_id,
         t.id           as trek_id,
         t.title,
         t.cover_image_url,
         tb.batch_date,
         tb.id          as batch_id
  from public.trek_participants tp
  join public.trek_batches tb on tp.batch_id = tb.id
  join public.treks t        on tb.trek_id  = t.id
  where tb.batch_date < current_date
  order by tb.batch_date desc;


-- ============================================================================
-- 5. FUNCTIONS
-- ============================================================================

-- is_chat_participant — membership check used by EVERY chat RLS policy.
-- SECURITY DEFINER + pinned search_path (avoids RLS recursion + shadowing).
create or replace function public.is_chat_participant(conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = is_chat_participant.conversation_id
      and cp.user_id = auth.uid()
  );
end;
$$;

-- mark_conversation_read — advance the caller's unread watermark (§3
-- conversation_participants.last_read_at). Called by markConversationRead()
-- in src/lib/chat.ts. SECURITY DEFINER because conversation_participants has
-- no UPDATE policy; the auth.uid() predicate is what scopes the write.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversation_participants
     set last_read_at = now()
   where conversation_id = p_conversation_id and user_id = auth.uid();
$$;

-- get_unread_counts — per-conversation unread badge counts for the caller.
-- Counts only OTHER users' non-deleted messages newer than last_read_at.
-- Called by getUnreadCounts() in src/lib/chat.ts.
-- ADVISOR: anon holds EXECUTE (default PUBLIC grant). Harmless — auth.uid() is
--   null for anon so the join matches nothing — but see §10.
create or replace function public.get_unread_counts()
returns table (conversation_id uuid, unread bigint)
language sql
security definer
set search_path = public
as $$
  select m.conversation_id, count(*)
    from public.conversation_messages m
    join public.conversation_participants cp
      on cp.conversation_id = m.conversation_id and cp.user_id = auth.uid()
   where m.created_at > cp.last_read_at
     and m.user_id <> auth.uid()
     and coalesce(m.is_deleted, false) = false
   group by m.conversation_id;
$$;

-- handle_new_user — creates the profiles row when an auth user is created.
-- SECURITY DEFINER so it bypasses RLS at signup (no session yet).
-- ADVISOR: callable via /rest/v1/rpc by anon/authenticated — consider
--   `revoke execute on function public.handle_new_user() from anon, authenticated;`
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data->>'full_name'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- join_trek_and_chat — the ONE write path for joining a trek. SECURITY DEFINER
-- (bypasses RLS) but derives the caller from auth.uid() and refuses to act on
-- behalf of another user. Creates batch + conversation if missing, inserts the
-- trek participant and (when confirmed) the chat participant, returns their ids.
-- HARDENED (DoS fix): requires p_user_id = auth.uid() (no NULL bypass) and
-- validates p_batch_date (not past, within a 1-year window) so a user cannot
-- mass-create trek_batches/conversations over unbounded future dates.
-- CAPACITY + WAITLIST: capacity is per batch (seeded from treks.max_participants
-- when the batch is created). Locks the batch row (FOR UPDATE) so the confirmed-
-- count check can't race; if the batch is full the joiner is 'waitlisted' and
-- NOT added to chat. NULL max = unlimited. Returns status + waitlist_position.
create or replace function public.join_trek_and_chat(
  p_user_id uuid,
  p_trek_id uuid,
  p_batch_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch_id uuid;
  v_convo_id uuid;
  v_participant_id uuid;
  v_trek_title text;
  v_trek_max integer;
  v_batch_max integer;
  v_confirmed integer;
  v_status text;
  v_position integer := null;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  -- Require the caller to act as themselves (closes the NULL p_user_id bypass).
  if p_user_id is null or p_user_id <> v_uid then
    raise exception 'p_user_id must equal the authenticated user';
  end if;

  -- Bound batch/conversation creation (DoS guard).
  if p_batch_date is null then
    raise exception 'Batch date is required';
  end if;
  if p_batch_date < current_date - interval '1 day' then
    raise exception 'Cannot join a trek batch in the past';
  end if;
  if p_batch_date > current_date + interval '1 year' then
    raise exception 'Batch date is too far in the future';
  end if;

  select title, max_participants into v_trek_title, v_trek_max
  from public.treks where id = p_trek_id;
  if v_trek_title is null then
    raise exception 'Trek not found';
  end if;

  insert into public.trek_batches (trek_id, batch_date, max_participants)
  values (p_trek_id, p_batch_date, v_trek_max)
  on conflict (trek_id, batch_date) do nothing
  returning id into v_batch_id;
  if v_batch_id is null then
    select id into v_batch_id from public.trek_batches
    where trek_id = p_trek_id and batch_date = p_batch_date limit 1;
  end if;

  -- Lock the batch row so concurrent joins serialize on the capacity check.
  select max_participants into v_batch_max
  from public.trek_batches where id = v_batch_id for update;

  insert into public.conversations (batch_id, name)
  values (v_batch_id, (v_trek_title || ' — ' || p_batch_date::text))
  on conflict (batch_id) do nothing
  returning id into v_convo_id;
  if v_convo_id is null then
    select id into v_convo_id from public.conversations
    where batch_id = v_batch_id limit 1;
  end if;

  -- Already a participant? Return the existing membership unchanged.
  select id, status into v_participant_id, v_status
  from public.trek_participants
  where user_id = v_uid and batch_id = v_batch_id;

  if v_participant_id is null then
    select count(*) into v_confirmed
    from public.trek_participants
    where batch_id = v_batch_id and status = 'confirmed';

    if v_batch_max is not null and v_confirmed >= v_batch_max then
      v_status := 'waitlisted';
    else
      v_status := 'confirmed';
    end if;

    insert into public.trek_participants (user_id, batch_id, status)
    values (v_uid, v_batch_id, v_status)
    returning id into v_participant_id;

    -- Only confirmed participants get a seat in the batch chat.
    if v_status = 'confirmed' then
      insert into public.conversation_participants (conversation_id, user_id)
      values (v_convo_id, v_uid)
      on conflict (conversation_id, user_id) do nothing;
    end if;
  end if;

  if v_status = 'waitlisted' then
    select count(*) into v_position
    from public.trek_participants
    where batch_id = v_batch_id
      and status = 'waitlisted'
      and (joined_at, id) <= (
        select joined_at, id from public.trek_participants where id = v_participant_id
      );
  end if;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'participant_id', v_participant_id,
    'conversation_id', v_convo_id,
    'status', v_status,
    'waitlist_position', v_position
  );
end;
$$;

-- get_trek_participant_count — count of participants across a trek's batches.
-- Plain SQL, SECURITY INVOKER, pinned search_path. Used by the app to show
-- participant counts (bypasses the own-row RLS on trek_participants? No —
-- INVOKER respects RLS; counts work because it is called for the caller).
-- Counts only CONFIRMED participants: the group-size display compares this
-- against capacity, so waitlisted joiners must be excluded.
create or replace function public.get_trek_participant_count(trek_uuid uuid)
returns integer
language sql
set search_path = public, pg_temp
as $$
  select count(tp.id)
  from public.trek_participants tp
  join public.trek_batches tb on tb.id = tp.batch_id
  where tb.trek_id = trek_uuid
    and tp.status = 'confirmed';
$$;

-- get_trek_avg_rating — live average of a trek's reviews, rounded to 1 decimal.
-- Returns null when the trek has no reviews (callers treat that as "unrated").
-- Real-ratings rollup source for card views that read a single trek at a time
-- (e.g. the home page); the Explore list computes the same value inline in
-- search_treks. trek_reviews is publicly readable, so granted to anon too.
create or replace function public.get_trek_avg_rating(trek_uuid uuid)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select round(avg(r.rating), 1)
  from public.trek_reviews r
  where r.trek_id = trek_uuid;
$$;

grant execute on function public.get_trek_avg_rating(uuid) to anon, authenticated;

-- search_treks — the single read path for the Explore page. Does full-text
-- search (prefix matching, e.g. "hima" → "himalayas"), all filters (location /
-- difficulty / distance range / price range / date), sorting, and pagination
-- server-side. next_batch_date = earliest batch on/after p_date_from (or today).
-- count(*) over () returns the total match count on every row so the client
-- gets rows + total in ONE request (no N+1). SECURITY INVOKER — treks is
-- publicly readable, so this is granted to anon + authenticated.
-- REWRITTEN 2026-07-02 (multi-tenant, §12): joins companies, only surfaces
-- treks where is_active AND the owning company is approved, returns
-- company_id/name/slug, and takes an optional p_company_id filter (used by the
-- /company/[slug] storefront). The old 11-arg overload was dropped so
-- PostgREST has exactly one signature to resolve.
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

drop function if exists public.search_treks(
  text, text, text, numeric, numeric, numeric, numeric, date, text, int, int
);

-- recompute_user_stats — rebuild all stats for one user from source truth.
-- Idempotent (sets, never blindly adds): safe to re-run, handles leaves/deletes.
-- "Completed" = a joined batch whose batch_date has passed. SECURITY DEFINER so
-- it can write the system-managed stats tables (clients have SELECT only).
-- Called by triggers (immediate) + daily pg_cron (time-based completion catch-up).
-- Execute is revoked from clients; it is not a public RPC.
create or replace function public.recompute_user_stats(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_stats as us (user_id, treks_completed, total_distance_km)
  select
    p_user_id,
    coalesce(count(*) filter (where tb.batch_date < current_date), 0),
    coalesce(sum(t.distance_km) filter (where tb.batch_date < current_date), 0)
  from public.trek_participants tp
  join public.trek_batches tb on tb.id = tp.batch_id
  join public.treks t        on t.id  = tb.trek_id
  where tp.user_id = p_user_id
    and tp.status = 'confirmed'
  on conflict (user_id) do update set
    treks_completed   = excluded.treks_completed,
    total_distance_km = excluded.total_distance_km;

  delete from public.user_monthly_activity where user_id = p_user_id;

  insert into public.user_monthly_activity
    (user_id, month, treks_joined, photos_shared, reviews_written, distance_km)
  select p_user_id, m.month,
         sum(m.treks_joined), sum(m.photos_shared),
         sum(m.reviews_written), sum(m.distance_km)
  from (
    select date_trunc('month', tp.joined_at)::date as month,
           1 treks_joined, 0 photos_shared, 0 reviews_written, 0::numeric distance_km
    from public.trek_participants tp
    where tp.user_id = p_user_id and tp.joined_at is not null
      and tp.status = 'confirmed'
    union all
    select date_trunc('month', r.created_at)::date,
           0, coalesce(array_length(r.photo_urls, 1), 0), 1, 0
    from public.trek_reviews r
    where r.user_id = p_user_id
    union all
    select date_trunc('month', tb.batch_date)::date,
           0, 0, 0, coalesce(t.distance_km, 0)
    from public.trek_participants tp
    join public.trek_batches tb on tb.id = tp.batch_id
    join public.treks t        on t.id  = tb.trek_id
    where tp.user_id = p_user_id and tb.batch_date < current_date
      and tp.status = 'confirmed'
  ) m
  group by m.month
  having sum(m.treks_joined) <> 0 or sum(m.photos_shared) <> 0
      or sum(m.reviews_written) <> 0 or sum(m.distance_km) <> 0;

  -- Evaluate badges off the freshly-computed source metrics.
  perform public.award_user_achievements(p_user_id);
end;
$$;
revoke all on function public.recompute_user_stats(uuid) from public, anon, authenticated;

-- award_user_achievements — evaluate the badge catalog for one user and insert
-- every newly-qualifying badge into user_achievements (append-only, on conflict
-- do nothing). Idempotent. SECURITY DEFINER so it can write the system-managed
-- table; execute revoked from clients. Keys must match src/lib/achievements.ts.
create or replace function public.award_user_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_joined    integer := 0;
  v_completed integer := 0;
  v_distance  numeric := 0;
  v_locations integer := 0;
  v_hard      integer := 0;
  v_months    integer := 0;
  v_reviews   integer := 0;
  v_photos    integer := 0;
begin
  select
    coalesce(count(*), 0),
    coalesce(count(*) filter (where tb.batch_date < current_date), 0),
    coalesce(sum(t.distance_km) filter (where tb.batch_date < current_date), 0),
    coalesce(count(distinct t.location) filter (where tb.batch_date < current_date), 0),
    coalesce(count(*) filter (where tb.batch_date < current_date
                                and t.difficulty in ('Hard', 'Expert')), 0),
    coalesce(count(distinct date_trunc('month', tb.batch_date))
               filter (where tb.batch_date < current_date), 0)
  into v_joined, v_completed, v_distance, v_locations, v_hard, v_months
  from public.trek_participants tp
  join public.trek_batches tb on tb.id = tp.batch_id
  join public.treks t        on t.id  = tb.trek_id
  where tp.user_id = p_user_id
    and tp.status = 'confirmed';

  select
    coalesce(count(*), 0),
    coalesce(sum(coalesce(array_length(r.photo_urls, 1), 0)), 0)
  into v_reviews, v_photos
  from public.trek_reviews r
  where r.user_id = p_user_id;

  insert into public.user_achievements (user_id, achievement_key)
  select p_user_id, c.key
  from (values
    ('trailblazer',      v_joined    >= 1),
    ('first_steps',      v_completed >= 1),
    ('trail_regular',    v_completed >= 5),
    ('seasoned_trekker', v_completed >= 10),
    ('mountain_master',  v_completed >= 25),
    ('trail_legend',     v_completed >= 50),
    ('warming_up',       v_distance  >= 10),
    ('centurion',        v_distance  >= 100),
    ('ultra_explorer',   v_distance  >= 500),
    ('explorer',         v_locations >= 5),
    ('globetrotter',     v_locations >= 10),
    ('peak_conqueror',   v_hard      >= 1),
    ('dedicated',        v_months    >= 6),
    ('storyteller',      v_reviews   >= 5),
    ('shutterbug',       v_photos    >= 25)
  ) as c(key, earned)
  where c.earned
  on conflict (user_id, achievement_key) do nothing;
end;
$$;
revoke all on function public.award_user_achievements(uuid) from public, anon, authenticated;

-- get_user_profile — one read path for the profile page: stats + current-month
-- activity + earned badge keys in a single JSON round trip. SECURITY INVOKER so
-- own-row RLS on each source table still applies (callers only see their own
-- data); p_user_id defaults to auth.uid().
create or replace function public.get_user_profile(p_user_id uuid default auth.uid())
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'stats', (
      select to_jsonb(s) from public.user_stats s
      where s.user_id = p_user_id
    ),
    'current_month', (
      select to_jsonb(m) from public.user_monthly_activity m
      where m.user_id = p_user_id
        and m.month = date_trunc('month', current_date)::date
    ),
    'achievements', (
      select coalesce(jsonb_agg(a.achievement_key order by a.earned_at), '[]'::jsonb)
      from public.user_achievements a
      where a.user_id = p_user_id
    )
  );
$$;
grant execute on function public.get_user_profile(uuid) to authenticated;

-- trg_recompute_user_stats — trigger glue: recompute the affected user's stats.
create or replace function public.trg_recompute_user_stats()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.recompute_user_stats(coalesce(new.user_id, old.user_id));
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    perform public.recompute_user_stats(old.user_id);
  end if;
  return null;
end;
$$;

-- update_user_stats_timestamp — touch last_updated on user_stats UPDATE.
create or replace function public.update_user_stats_timestamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.last_updated = now();
  return new;
end;
$$;

-- on_user_join_trek — currently a no-op (legacy; kept because a trigger may
-- still reference it in some environments).
create or replace function public.on_user_join_trek()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return new;
end;
$$;

-- create_trek_initial_message inserts into `trek_messages`, a table that does
-- NOT exist — every trek INSERT used to error because of it. FIXED 2026-07-02:
-- the multi-tenant migration dropped its trigger (trg_initial_trek_message, §6)
-- so company admins can create treks. The function is kept (unused) per the
-- repo convention of not deleting pre-existing code out of scope.
create or replace function public.create_trek_initial_message()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into trek_messages (trek_id, user_id, message)
  values (new.id, null, 'Welcome to the trek chat! Feel free to start chatting.');
  return new;
end;
$$;

-- increment_participants was DROPPED 2026-08-08 (NEW-5,
-- supabase/phases/fix-drop-dead-increment-participants.sql). It backed the legacy
-- src/lib/database.ts join path, which is itself dead. No trigger referenced it and
-- its EXECUTE was already fully revoked. Do NOT confuse it with
-- update_participants_count() below, which is live and load-bearing.

-- update_participants_count — recomputes treks.participants_joined for the trek
-- behind the affected participation row. Resolves trek_id via the batch (the
-- table is keyed by batch_id, NOT trek_id), and handles INSERT (NEW) and DELETE
-- (OLD). SECURITY DEFINER so the write to treks succeeds regardless of who
-- triggers it. Attached to the trek_participants trigger below (NEW-5). This
-- replaces the old dead/broken version that referenced trek_participants.trek_id.
create or replace function public.update_participants_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch_id uuid := coalesce(new.batch_id, old.batch_id);
  v_trek_id  uuid;
begin
  select trek_id into v_trek_id
  from public.trek_batches
  where id = v_batch_id;

  if v_trek_id is not null then
    update public.treks
    set participants_joined = (
      select count(*)
      from public.trek_participants tp
      join public.trek_batches tb on tb.id = tp.batch_id
      where tb.trek_id = v_trek_id
        and tp.status = 'confirmed'
    )
    where id = v_trek_id;
  end if;

  return coalesce(new, old);
end;
$$;

-- promote_waitlist_on_leave — FIFO waitlist promotion. Fires after a CONFIRMED
-- participant leaves: promotes the oldest 'waitlisted' joiner in the same batch
-- to 'confirmed' and adds them to the batch chat. NULL max = unlimited (no-op).
-- SECURITY DEFINER so it can write across tables regardless of who triggers it.
create or replace function public.promote_waitlist_on_leave()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max integer;
  v_confirmed integer;
  v_promote_id uuid;
  v_promote_user uuid;
  v_convo_id uuid;
begin
  if old.status is distinct from 'confirmed' then
    return old;
  end if;

  select max_participants into v_max
  from public.trek_batches where id = old.batch_id;
  if v_max is null then
    return old;
  end if;

  select count(*) into v_confirmed
  from public.trek_participants
  where batch_id = old.batch_id and status = 'confirmed';
  if v_confirmed >= v_max then
    return old;
  end if;

  select id, user_id into v_promote_id, v_promote_user
  from public.trek_participants
  where batch_id = old.batch_id and status = 'waitlisted'
  order by joined_at asc
  limit 1
  for update skip locked;
  if v_promote_id is null then
    return old;
  end if;

  update public.trek_participants
  set status = 'confirmed'
  where id = v_promote_id;

  select id into v_convo_id
  from public.conversations where batch_id = old.batch_id limit 1;
  if v_convo_id is not null then
    insert into public.conversation_participants (conversation_id, user_id)
    values (v_convo_id, v_promote_user)
    on conflict (conversation_id, user_id) do nothing;
  end if;

  return old;
end;
$$;

-- notify_trek_participation — fires on trek_participants insert/delete and POSTs
-- to the send-trek-(leave-)notification edge functions. NO key is embedded in
-- DDL (CRIT-1 fix). The functions run verify_jwt=false and authorize on a shared
-- WEBHOOK SECRET read from Vault (`edge_function_token`) and sent on a custom
-- header; the PUBLIC publishable key rides on `apikey` only for gateway routing.
-- The functions use their own SUPABASE_SECRET_KEYS env for the admin client, so
-- the powerful secret key never enters the DB/Vault/pg_net. SECURITY DEFINER (to
-- read vault.decrypted_secrets) and fail-safe: any error is swallowed so a failed
-- notification can never roll back the join/leave.
create or replace function public.notify_trek_participation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
  v_apikey text := 'sb_publishable_9A0yuGlK1_9N_UH6-nVd2A_M2D8OMzM'; -- PUBLIC, routing only
  v_base   text := 'https://dtjmyqogeozrzzbdjokr.supabase.co/functions/v1/';
  v_url    text;
  v_body   jsonb;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'edge_function_token'
  limit 1;

  if v_secret is null or length(btrim(v_secret)) = 0 then
    return coalesce(new, old);   -- no secret yet -> skip, never block join/leave
  end if;

  if tg_op = 'INSERT' then
    v_url  := v_base || 'send-trek-notification';
    v_body := jsonb_build_object(
      'type','INSERT','table','trek_participants','schema','public',
      'record', to_jsonb(new), 'old_record', null
    );
  elsif tg_op = 'DELETE' then
    v_url  := v_base || 'send-trek-leave-notification';
    v_body := jsonb_build_object(
      'type','DELETE','table','trek_participants','schema','public',
      'record', null, 'old_record', to_jsonb(old)
    );
  else
    return coalesce(new, old);
  end if;

  perform net.http_post(
    url := v_url,
    body := v_body,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey', v_apikey,                 -- public publishable key, routing only
      'x-trek-webhook-secret', v_secret   -- authorizes the call inside the fn
    ),
    timeout_milliseconds := 5000
  );

  return coalesce(new, old);
exception when others then
  return coalesce(new, old);     -- notification failure must not roll back the tx
end;
$$;

-- notify_trek_join / notify_trek_remove — pg_net POST to an edge function.
-- NOTE: these post to `/functions/v1/trek-email-notification`, which does NOT
-- exist (the deployed functions are send-trek-notification /
-- send-trek-leave-notification, invoked by the separate webhook triggers
-- below). The anon key is hard-coded in the live definitions; replaced with a
-- placeholder here. These are effectively redundant/dead.
create or replace function public.notify_trek_join()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  project_url text := 'https://YOUR-PROJECT.supabase.co';
  anon_key text := 'REPLACE_WITH_ANON_KEY';
begin
  perform net.http_post(
    url := project_url || '/functions/v1/trek-email-notification',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || anon_key),
    body := jsonb_build_object('type','JOIN','user_id',new.user_id,'batch_id',new.batch_id)
  );
  return new;
end;
$$;

create or replace function public.notify_trek_remove()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  project_url text := 'https://YOUR-PROJECT.supabase.co';
  anon_key text := 'REPLACE_WITH_ANON_KEY';
begin
  perform net.http_post(
    url := project_url || '/functions/v1/trek-email-notification',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || anon_key),
    body := jsonb_build_object('type','REMOVE','user_id',old.user_id,'batch_id',old.batch_id)
  );
  return old;
end;
$$;


-- ============================================================================
-- 6. TRIGGERS
-- ============================================================================

-- Create the profile row when an auth user signs up.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Touch user_stats.last_updated on update.
drop trigger if exists trg_update_user_stats_timestamp on public.user_stats;
create trigger trg_update_user_stats_timestamp
  before update on public.user_stats
  for each row execute function public.update_user_stats_timestamp();

-- System-managed stats: recompute the affected user on join/leave and on review
-- changes. Time-based completion (batch_date crossing into the past) is caught by
-- the daily pg_cron job below, not by these triggers.
drop trigger if exists trg_participant_stats on public.trek_participants;
create trigger trg_participant_stats
  after insert or delete on public.trek_participants
  for each row execute function public.trg_recompute_user_stats();

drop trigger if exists trg_review_stats on public.trek_reviews;
create trigger trg_review_stats
  after insert or update or delete on public.trek_reviews
  for each row execute function public.trg_recompute_user_stats();

-- trg_initial_trek_message DROPPED 2026-07-02 (multi-tenant migration): it fired
-- the broken trek_messages insert on every trek create (see function note in §5).
-- Its intent (seed a welcome message) is superseded by join_trek_and_chat().
drop trigger if exists trg_initial_trek_message on public.treks;

-- Email-notification webhooks on join/leave. These call the DEPLOYED edge
-- functions via notify_trek_participation(), which reads the bearer token from
-- Vault (secret `edge_function_token`) instead of embedding a key in DDL.
-- (Replaces the old supabase_functions.http_request triggers that carried the
-- service_role JWT as a plaintext literal — see security-fixes.sql / CRIT-1.)
drop trigger if exists "trek-join-notification" on public.trek_participants;
create trigger "trek-join-notification"
  after insert on public.trek_participants
  for each row execute function public.notify_trek_participation();

drop trigger if exists "trek-leave-notification" on public.trek_participants;
create trigger "trek-leave-notification"
  after delete on public.trek_participants
  for each row execute function public.notify_trek_participation();

-- Redundant pg_net notification triggers (point at a non-existent edge fn).
drop trigger if exists trek_join_email_trigger on public.trek_participants;
create trigger trek_join_email_trigger
  after insert on public.trek_participants
  for each row execute function public.notify_trek_join();

drop trigger if exists trek_remove_email_trigger on public.trek_participants;
create trigger trek_remove_email_trigger
  after delete on public.trek_participants
  for each row execute function public.notify_trek_remove();

-- Keep treks.participants_joined in sync on join/leave (NEW-5). Recomputes the
-- count via update_participants_count() so it is accurate for every join path
-- (direct insert and the join_trek_and_chat RPC).
drop trigger if exists trek_participants_count_trigger on public.trek_participants;
create trigger trek_participants_count_trigger
  after insert or delete on public.trek_participants
  for each row execute function public.update_participants_count();

-- Promote the oldest waitlisted joiner when a confirmed participant leaves.
drop trigger if exists trek_participants_waitlist_promote on public.trek_participants;
create trigger trek_participants_waitlist_promote
  after delete on public.trek_participants
  for each row execute function public.promote_waitlist_on_leave();

-- Lock down trigger-only SECURITY DEFINER functions: they fire as triggers and
-- must NOT be callable via /rest/v1/rpc. Revoke from PUBLIC (anon/authenticated
-- inherit EXECUTE through it; revoking only those two is a no-op). Triggers
-- still fire; the owner keeps EXECUTE. join_trek_and_chat / is_chat_participant
-- stay callable (app RPC + RLS policies use them).
revoke execute on function public.handle_new_user()           from public, anon, authenticated;
revoke execute on function public.notify_trek_participation() from public, anon, authenticated;
revoke execute on function public.update_participants_count() from public, anon, authenticated;
revoke execute on function public.promote_waitlist_on_leave()  from public, anon, authenticated;
revoke execute on function public.recompute_user_stats(uuid)  from public, anon, authenticated;
revoke execute on function public.trg_recompute_user_stats()  from public, anon, authenticated;
revoke execute on function public.award_user_achievements(uuid) from public, anon, authenticated;

-- Scheduled job (pg_cron): daily catch-up so treks_completed / total_distance_km
-- and monthly distance pick up batches whose batch_date has crossed into the past
-- (a time-based event no trigger can observe). Recomputes every profile at 00:05 UTC.
--   create extension if not exists pg_cron;
--   select cron.schedule('recompute-user-stats-daily', '5 0 * * *',
--     $$ select public.recompute_user_stats(p.id) from public.profiles p $$);


-- ============================================================================
-- 7. ROW LEVEL SECURITY — enable
-- ============================================================================
alter table public.profiles                  enable row level security;
alter table public.treks                      enable row level security;
alter table public.trek_batches               enable row level security;
alter table public.trek_participants          enable row level security;
alter table public.trek_reviews               enable row level security;
alter table public.favorites                  enable row level security;
alter table public.conversations              enable row level security;
alter table public.conversation_participants  enable row level security;
alter table public.conversation_messages      enable row level security;
alter table public.user_stats                 enable row level security;
alter table public.user_monthly_activity      enable row level security;
alter table public.user_achievements          enable row level security;


-- ============================================================================
-- 8. RLS POLICIES (public schema) — mirrors live
-- ============================================================================

-- ---- profiles ---------------------------------------------------------------
-- Own-row only. Cross-user reads go through the public_profiles view.
drop policy if exists "Users can view own profile"   on public.profiles;
create policy "Users can view own profile"   on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update to authenticated using (auth.uid() = id);

-- ---- treks / trek_batches ---------------------------------------------------
-- REPLACED 2026-07-02 (multi-tenant): the old unconditional public-read
-- policies ("view all treks", "Anyone can view trek batches") were dropped.
-- Reads now go through is_trek_visible() and companies get scoped write
-- policies — see §12.

-- ---- trek_participants (own rows only — NEW-4) ------------------------------
drop policy if exists "Users can view own trek participation" on public.trek_participants;
create policy "Users can view own trek participation" on public.trek_participants for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users can join treks" on public.trek_participants;
create policy "Users can join treks" on public.trek_participants for insert to authenticated with check (auth.uid() = user_id);
-- NO UPDATE policy (M-update fix): join = INSERT, leave = DELETE. An UPDATE
-- policy let users rewrite their row's batch_id (review join-gate bypass), and
-- WITH CHECK cannot pin batch_id (it can't see the OLD row). UPDATE is now
-- default-denied. Explicitly drop any older variant.
drop policy if exists "Users can update own participation" on public.trek_participants;
drop policy if exists "Users can leave treks" on public.trek_participants;
create policy "Users can leave treks" on public.trek_participants for delete to authenticated using (auth.uid() = user_id);

-- ---- trek_reviews (public read; join-gated insert — NEW-3) ------------------
drop policy if exists "Reviews are viewable by everyone" on public.trek_reviews;
create policy "Reviews are viewable by everyone" on public.trek_reviews for select to public using (true);
drop policy if exists "Users can review treks they joined" on public.trek_reviews;
create policy "Users can review treks they joined" on public.trek_reviews for insert to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.trek_participants tp
    join public.trek_batches tb on tb.id = tp.batch_id
    where tp.user_id = auth.uid() and tb.trek_id = trek_reviews.trek_id
  )
);
drop policy if exists "Users can update their own reviews" on public.trek_reviews;
create policy "Users can update their own reviews" on public.trek_reviews for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own reviews" on public.trek_reviews;
create policy "Users can delete their own reviews" on public.trek_reviews for delete to authenticated using (auth.uid() = user_id);

-- ---- favorites (own rows only) ----------------------------------------------
drop policy if exists "Users can see their favorites" on public.favorites;
create policy "Users can see their favorites" on public.favorites for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can favorite treks" on public.favorites;
create policy "Users can favorite treks" on public.favorites for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can remove favorites" on public.favorites;
create policy "Users can remove favorites" on public.favorites for delete to authenticated using (auth.uid() = user_id);

-- ---- conversations (membership-gated via SECURITY DEFINER helper) -----------
drop policy if exists "Users can view their conversations" on public.conversations;
create policy "Users can view their conversations" on public.conversations for select to public using (public.is_chat_participant(id));

-- ---- conversation_participants ----------------------------------------------
drop policy if exists "Users can view participants of their chats" on public.conversation_participants;
create policy "Users can view participants of their chats" on public.conversation_participants for select to public using (public.is_chat_participant(conversation_id));
drop policy if exists "System adds participants" on public.conversation_participants;
create policy "System adds participants" on public.conversation_participants for insert to public with check (auth.role() = 'service_role');
drop policy if exists "Users can leave conversation" on public.conversation_participants;
create policy "Users can leave conversation" on public.conversation_participants for delete to public using (user_id = auth.uid());

-- ---- conversation_messages --------------------------------------------------
drop policy if exists "Read messages of joined conversations" on public.conversation_messages;
create policy "Read messages of joined conversations" on public.conversation_messages for select to public using (public.is_chat_participant(conversation_id));
-- §17 added `and is_announcement = false` to both with_check clauses: without it
-- any trekker could POST an is_announcement:true row and forge an operator notice.
drop policy if exists "Send messages" on public.conversation_messages;
create policy "Send messages" on public.conversation_messages for insert to public with check (user_id = auth.uid() and public.is_chat_participant(conversation_id) and is_announcement = false);
drop policy if exists "Edit own messages" on public.conversation_messages;
create policy "Edit own messages" on public.conversation_messages for update to public using (user_id = auth.uid()) with check (user_id = auth.uid() and is_announcement = false);
drop policy if exists "Delete own messages" on public.conversation_messages;
create policy "Delete own messages" on public.conversation_messages for delete to public using (user_id = auth.uid());

-- ---- user_stats (own rows, read-only) ---------------------------------------
-- System-managed aggregates. Clients get SELECT on their own row only; there are
-- intentionally NO client INSERT/UPDATE policies. Writes happen exclusively via
-- SECURITY DEFINER maintenance functions/triggers, which bypass RLS. Granting
-- self-write here let users inflate their own vanity stats. See security-fixes.sql.
drop policy if exists "Users can view own stats" on public.user_stats;
create policy "Users can view own stats" on public.user_stats for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert their own stats record" on public.user_stats;
drop policy if exists "Users can update their own stats" on public.user_stats;

-- ---- user_monthly_activity (own rows, read-only) ----------------------------
-- Same model as user_stats: read-only to clients, system-managed writes only.
drop policy if exists "Users can view their own activity" on public.user_monthly_activity;
create policy "Users can view their own activity" on public.user_monthly_activity for select to public using (auth.uid() = user_id);
drop policy if exists "Users can insert their own monthly record" on public.user_monthly_activity;
drop policy if exists "Users can update their own activity" on public.user_monthly_activity;

-- ---- user_achievements (own rows, read-only) --------------------------------
-- Append-only badges; same model: read-only to clients, writes only via the
-- SECURITY DEFINER award_user_achievements().
drop policy if exists "Users can view own achievements" on public.user_achievements;
create policy "Users can view own achievements" on public.user_achievements for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.user_achievements from anon, authenticated;


-- ============================================================================
-- 9. STORAGE — buckets + object policies
-- ============================================================================
insert into storage.buckets (id, name, public) values ('avatars',      'avatars',      true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('trek-reviews', 'trek-reviews', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('trek-profile', 'trek-profile', true) on conflict (id) do nothing;
-- NOTE: bucket `trek-profile` is public but has NO object policies (no client
-- write path; objects are reachable only via public URL). Likely unused — and
-- deliberately left uncapped below for that reason.

-- Per-upload ceiling (§13.4 caps how many; this caps how big). Enforced by
-- storage-api at the edge, before the bytes are stored — compressImage() runs
-- in the browser and is skipped by calling the Storage API directly with the
-- publishable key. 3 MiB, not tighter, because compressImage() returns the
-- ORIGINAL file when compression fails (src/utils/imageCompression.ts).
-- The MIME list is a guardrail, not a scanner: it stops a 40MB video/mp4 in the
-- avatars bucket, not a renamed file.
update storage.buckets
set file_size_limit    = 3145728,  -- 3 MiB
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id in ('avatars','trek-reviews');

-- ---- avatars: authenticated read (anon listing blocked), owner-scoped writes -
-- Ownership accepts both layouts: avatars/{uid}/file AND avatars/{uid}.ext
-- Any signed-in user can view all avatars (needed for chat/review author display).
-- Anonymous listing is blocked; CDN public URLs still serve photos without auth.
drop policy if exists "Public can view avatars" on storage.objects;
drop policy if exists "Authenticated users can view own avatars" on storage.objects;
drop policy if exists "Authenticated users can view avatars" on storage.objects;
create policy "Authenticated users can view avatars" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload avatars" on storage.objects;
create policy "Users can upload avatars" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or name like auth.uid()::text || '.%'));

drop policy if exists "Users can update avatars" on storage.objects;
create policy "Users can update avatars" on storage.objects for update to authenticated
using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or name like auth.uid()::text || '.%'))
with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or name like auth.uid()::text || '.%'));

drop policy if exists "Users can delete avatars" on storage.objects;
create policy "Users can delete avatars" on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or name like auth.uid()::text || '.%'));

-- ---- trek-reviews: authenticated read (anon listing blocked), owner-scoped writes
-- Any signed-in user can view review photos (shown on trek detail pages).
-- Anonymous listing is blocked; CDN public URLs still serve photos without auth.
drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Authenticated users can view review photos" on storage.objects;
create policy "Authenticated users can view review photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'trek-reviews');

drop policy if exists "Authenticated users can upload review photos" on storage.objects;
create policy "Authenticated users can upload review photos" on storage.objects for insert to authenticated
with check (bucket_id = 'trek-reviews' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own review photos" on storage.objects;
create policy "Users can delete their own review photos" on storage.objects for delete to authenticated
using (bucket_id = 'trek-reviews' and (storage.foldername(name))[1] = auth.uid()::text);


-- ============================================================================
-- 10. OPEN ADVISOR ITEMS (not enforced here — see SECURITY_AUDIT_ISSUE.md)
-- ============================================================================
-- Advisor state re-checked 2026-07-02 after the multi-tenant migration:
-- * security_definer_view: public_profiles (intentional; documented above).
-- * public_bucket_allows_listing: avatars, trek-reviews + NEW company-logos,
--   trek-images (broad authenticated SELECT allows listing; object URLs don't
--   need it — deliberate, mirrors the avatars pattern to block anon listing).
-- * anon can EXECUTE the multi-tenant SECURITY DEFINER RPCs (apply_for_company,
--   approve/reject/suspend_company, get_company_batch_participants, helpers)
--   via the default PUBLIC grant. Every one fails safely for anon (auth.uid()
--   / is_platform_admin() checked inside), but revoking anon EXECUTE on the
--   five action RPCs would silence the linter — optional hardening, tracked in
--   FEATURES.md §1.
-- * rls_enabled_no_policy on platform_admins: INTENTIONAL default-deny (§12).
-- * Auth: leaked-password protection disabled; raise min password length.
-- * Postgres has pending security patches (upgrade in dashboard).
-- ============================================================================


-- ============================================================================
-- 11. BACKFILL — initialise denormalised counters (NEW-5)
-- ============================================================================
-- One-time recompute so treks.participants_joined reflects existing rows; the
-- trek_participants_count_trigger maintains it from here on. Safe to re-run.
update public.treks t
set participants_joined = (
  select count(*)
  from public.trek_participants tp
  join public.trek_batches tb on tb.id = tp.batch_id
  where tb.trek_id = t.id
);


-- ============================================================================
-- 12. MULTI-TENANT (companies) — applied 2026-07-02 via
--     supabase/migration-multi-tenant.sql; design rationale in
--     MULTI_TENANT_PLAN.md. search_treks (§5), the treks/trek_batches read
--     policies (§8) and trg_initial_trek_message (§6) were changed in place
--     above by the same migration.
-- ============================================================================

-- ---- 12.1 Enums ---------------------------------------------------------------
do $$ begin
  create type public.company_status as enum ('pending', 'approved', 'rejected', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.company_role as enum ('owner', 'admin', 'staff');
exception when duplicate_object then null; end $$;

-- ---- 12.2 Tables ----------------------------------------------------------------

-- companies — a tenant/operator. Approval-workflow fields (status/approved_by/
-- approved_at/rejection_reason/created_by) are pinned against self-edit by the
-- trigger in 12.5.
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

-- Spam guard: one pending application per user (rejected users can reapply).
create unique index if not exists companies_one_pending_per_creator
  on public.companies (created_by) where (status = 'pending');

-- company_members — user ↔ company with role. role='owner' is set exactly once,
-- by apply_for_company(); no client write path can create or reassign an owner.
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

-- platform_admins — super-admin allowlist. RLS enabled with ZERO policies =
-- default-deny for every client role; rows are added ONLY via the SQL Editor.
-- A client-reachable "make me admin" path would be a privilege escalation, so
-- there deliberately isn't one. Checked via is_platform_admin().
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);

-- treks: tenant ownership + soft-delete flag (see table comment in §3).
alter table public.treks add column if not exists company_id uuid references public.companies(id);
alter table public.treks add column if not exists is_active boolean not null default true;

create index if not exists treks_company_id_idx on public.treks (company_id);

-- ---- 12.3 Helper functions (SECURITY DEFINER — same pattern as
--          is_chat_participant: bypass RLS on membership tables so policies
--          calling them don't recurse; pinned search_path) --------------------

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

-- is_approved_company_member — is_company_member + the company must be approved.
-- The PUBLISHING tier (§16, applied 2026-08-08): treks + trek_batches writes and
-- the trek-images bucket. Orphaned from the multi-tenant migration until then.
create or replace function public.is_approved_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.company_members cm
    join public.companies c on c.id = cm.company_id
    where cm.company_id = p_company_id
      and cm.user_id = auth.uid()
      and c.status = 'approved'
  );
$$;
grant execute on function public.is_approved_company_member(uuid) to authenticated;

-- is_company_writable — the frozen/not-frozen test (§16, applied 2026-08-08).
-- About the COMPANY only; composed with is_company_member / is_company_admin at
-- each call site rather than forking those into status-aware twins. pending and
-- approved are writable (an applicant sets up while it waits); rejected and
-- suspended are FROZEN — read-only tenant.
--
-- DEFINER because two callers need it where the caller can't see the companies
-- row under RLS: the invitee in accept_company_invite() (a non-member sees only
-- approved rows), and the companies UPDATE policy, which must not recurse into
-- "view companies".
create or replace function public.is_company_writable(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.companies c
    where c.id = p_company_id
      and c.status in ('pending', 'approved')
  );
$$;
grant execute on function public.is_company_writable(uuid) to authenticated;

-- is_trek_visible — single source of truth for "can the caller see this trek":
-- public rule (active + company approved) OR owning-company staff OR platform
-- admin OR the caller already holds a booking on one of the trek's batches.
-- Used by treks AND trek_batches SELECT policies so a batch can't leak dates
-- for a hidden trek. Granted to anon: the policies run as the caller.
-- The participant arm keeps a user's OWN booking history readable after a trek
-- is archived or its company suspended (the trek_batches!inner->treks joins in
-- profile history/favorites would otherwise drop the row); it does NOT re-list
-- the trek publicly — search_treks() filters on active+approved directly.
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
-- is_chat_participant-only, so an inline subquery in the delete policy would be
-- blind to a chat the deleting owner never joined and wrongly pass the guard.
-- join_trek_and_chat creates one conversation per batch on the first join and
-- nothing deletes it, so a vacated batch keeps its conversation; the FK
-- (conversations.batch_id, NO ACTION) would otherwise reject the delete (23503).
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

-- ---- 12.4 RPCs — mediated write paths (mirror join_trek_and_chat: SECURITY
--          DEFINER, caller derived from auth.uid(), auth re-checked inside) ---

-- apply_for_company — the ONLY way a company row is created (no INSERT policy
-- on companies). Forces status='pending' and makes the applicant the owner.
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

-- approve/reject/suspend — platform-admin only; the check is INSIDE each
-- function (defense in depth, not just grants).
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
-- PII. Re-checks membership against the batch's owning company on every call;
-- returns an empty set (not an error) on foreign batches to avoid leaking
-- "this batch id exists".
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

-- get_trek_batch_confirmed_counts — confirmed-participant counts for every batch
-- of a trek in ONE call, returning NO PII (batch id + integer only). Rendering a
-- departure list used to fan out get_company_batch_participants per batch and
-- discard everything but a count; this replaces that N+1 and its PII exposure.
-- Same membership re-check + empty-set-on-foreign pattern as the roster RPC.
-- Applied + verified live 2026-07-04 (member → counts; non-member/anon/unknown → empty set).
create or replace function public.get_trek_batch_confirmed_counts(p_trek_id uuid)
returns table (
  batch_id        uuid,
  confirmed_count bigint
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
  from public.treks t
  where t.id = p_trek_id;

  if v_company_id is null or not public.is_company_member(v_company_id) then
    return;
  end if;

  return query
  select tb.id, count(tp.id) filter (where tp.status = 'confirmed')
  from public.trek_batches tb
  left join public.trek_participants tp on tp.batch_id = tb.id
  where tb.trek_id = p_trek_id
  group by tb.id;
end;
$$;
grant execute on function public.get_trek_batch_confirmed_counts(uuid) to authenticated;

-- get_company_members / invite_company_member — added in Phase C (dashboard team
-- page). Both must read profiles the caller doesn't own, and public.profiles is
-- self-only under RLS, so they're mediated by SECURITY DEFINER RPCs (same
-- pattern as get_company_batch_participants). Applied + verified live 2026-07-02.
create or replace function public.get_company_members(p_company_id uuid)
returns table (
  member_id  uuid,
  user_id    uuid,
  role       public.company_role,
  full_name  text,
  email      text,
  avatar_url text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_company_member(p_company_id) then
    return;
  end if;

  return query
  select cm.id, p.id, cm.role, p.full_name, p.email, p.avatar_url, cm.created_at
  from public.company_members cm
  join public.profiles p on p.id = cm.user_id
  where cm.company_id = p_company_id
  order by cm.role, p.full_name nulls last, cm.created_at;
end;
$$;
grant execute on function public.get_company_members(uuid) to authenticated;

-- invite_company_member — owner/admin-only; resolves an existing account by
-- email and adds them as STAFF (role escalation impossible from the client).
-- Authorization is re-checked inside the function (defense-in-depth).
-- Rate-limited to 20 probes/hour/user (§13): the function answers whether an
-- email has a Trekker account, so uncapped it enumerates a mailing list. The
-- "not found" branch RETURNS instead of RAISING — a raised exception rolls back
-- the rate_events row recording the attempt, so every failed probe would erase
-- its own evidence and the limit would count nothing.
create or replace function public.invite_company_member(p_company_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_count   int;
  v_uid     uuid := auth.uid();
begin
  if not public.is_company_admin(p_company_id) then
    raise exception 'Only company owners/admins can invite members';
  end if;

  select count(*) into v_count
  from public.rate_events
  where actor = v_uid and action = 'invite' and at > now() - interval '1 hour';

  if v_count >= 20 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into public.rate_events (actor, action) values (v_uid, 'invite');

  select id into v_user_id
  from public.profiles
  where lower(email) = lower(trim(p_email));

  if v_user_id is null then
    return jsonb_build_object('error', 'not_found');
  end if;

  insert into public.company_members (company_id, user_id, role)
  values (p_company_id, v_user_id, 'staff')
  on conflict (company_id, user_id) do nothing;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    return jsonb_build_object('already_member', true);
  end if;
  return jsonb_build_object('user_id', v_user_id);
end;
$$;
grant execute on function public.invite_company_member(uuid, text) to authenticated;

-- admin_list_companies / admin_get_company — audit-column reads for the
-- platform-admin dashboard. The base table's client SELECT grant excludes
-- created_by/approved_by/approved_at (see §12.6 column grant), so these
-- SECURITY DEFINER, admin-gated RPCs are the only client path to them.
create or replace function public.admin_list_companies(p_status text default 'all')
returns setof public.companies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can list companies';
  end if;
  return query
    select *
    from public.companies c
    where p_status = 'all' or c.status = p_status::public.company_status
    order by c.created_at desc;
end;
$$;
revoke execute on function public.admin_list_companies(text) from public, anon;
grant execute on function public.admin_list_companies(text) to authenticated;

create or replace function public.admin_get_company(p_company_id uuid)
returns setof public.companies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can view company audit details';
  end if;
  return query
    select * from public.companies c where c.id = p_company_id;
end;
$$;
revoke execute on function public.admin_get_company(uuid) from public, anon;
grant execute on function public.admin_get_company(uuid) to authenticated;

-- ---- 12.5 Trigger — protect approval-workflow columns ------------------------
-- Pins slug/status/approved_by/approved_at/rejection_reason/created_by back to
-- OLD on any UPDATE from a non-platform-admin (slug is immutable to prevent a
-- freed slug being reclaimed by another company → old links hijacked). RLS WITH
-- CHECK can't compare NEW vs
-- OLD, so a BEFORE UPDATE trigger is the standard way to protect columns; it
-- runs inside Postgres no matter what request shape the client crafts.
create or replace function public.protect_company_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    new.slug              := old.slug;
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

-- ---- 12.6 RLS -----------------------------------------------------------------
alter table public.companies       enable row level security;
alter table public.company_members enable row level security;
alter table public.platform_admins enable row level security;
-- platform_admins gets ZERO policies — intentional default-deny (see 12.2).

-- companies: public sees approved; members see their own regardless of status;
-- platform admins see everything. No INSERT policy (RPC-only creation); no
-- DELETE policy (companies suspend, never hard-delete).
drop policy if exists "view companies" on public.companies;
create policy "view companies" on public.companies for select to public using (
  status = 'approved' or public.is_company_member(id) or public.is_platform_admin()
);
-- Column-level SELECT: RLS is row-level only, so without this a client could
-- select the audit UUIDs (created_by/approved_by) on approved rows and cross-
-- reference them against public_profiles to deanonymize owners + approving
-- admins. Grant SELECT on non-sensitive columns only; audit columns are read
-- solely via admin_list_companies / admin_get_company below.
revoke select on public.companies from anon, authenticated;
grant select (
  id, name, slug, description, logo_url, cover_image_url, website,
  contact_email, contact_phone, status, rejection_reason, created_at
) on public.companies to anon, authenticated;
-- Frozen tenants are read-only (§16): a suspended company editing its storefront
-- copy is editing a page the platform has taken down. The platform-admin arm is
-- deliberately NOT status-gated — freezing must not lock out the role that
-- un-freezes. trg_protect_company_admin_fields still pins status/slug/approved_*,
-- so nothing here lets a company approve or un-freeze itself.
drop policy if exists "company admins update own company" on public.companies;
create policy "company admins update own company" on public.companies for update to authenticated
using (
  (public.is_company_admin(id) and public.is_company_writable(id))
  or public.is_platform_admin()
)
with check (
  (public.is_company_admin(id) and public.is_company_writable(id))
  or public.is_platform_admin()
);

-- company_members: members see own roster; owners/admins invite STAFF only
-- (owner rows are created solely by apply_for_company, can't be updated to
-- owner, and can't be deleted — a company can never lose its owner via client).
drop policy if exists "view company members" on public.company_members;
create policy "view company members" on public.company_members for select to authenticated using (
  public.is_company_member(company_id) or public.is_platform_admin()
);
-- ⚠️ DROPPED 2026-08-06 by §15.8 — kept here only to record what was live until
-- then. It constrained the company and the role but NOT user_id, so any company
-- admin could POST /rest/v1/company_members with an arbitrary user_id and add a
-- stranger to their team. Do not re-create it; memberships are RPC-only now.
drop policy if exists "company admins invite staff" on public.company_members;
-- create policy "company admins invite staff" on public.company_members for insert to authenticated
-- with check (public.is_company_admin(company_id) and role = 'staff');
-- (user_id <> auth.uid() blocks self-demotion / self-removal, so an admin can't
-- lock themselves out of management on their own row).
-- is_company_writable added by §16: a frozen company's roster is fixed as it
-- stands. role <> 'owner' and user_id <> auth.uid() are unchanged.
drop policy if exists "company admins manage member roles" on public.company_members;
create policy "company admins manage member roles" on public.company_members for update to authenticated
using (
  public.is_company_admin(company_id)
  and public.is_company_writable(company_id)
  and role <> 'owner'
  and user_id <> auth.uid()
)
with check (
  public.is_company_admin(company_id)
  and public.is_company_writable(company_id)
  and role in ('admin', 'staff')
);
drop policy if exists "company admins remove members" on public.company_members;
create policy "company admins remove members" on public.company_members for delete to authenticated
using (
  public.is_company_admin(company_id)
  and public.is_company_writable(company_id)
  and role <> 'owner'
  and user_id <> auth.uid()
);

-- treks: tenant-aware read; APPROVED company members create/update own treks
-- (archive = is_active=false, the ONLY delete path — no hard DELETE policy).
-- §16 swapped is_company_member → is_approved_company_member on both writes:
-- publishing is approved-only (the UI always claimed this; the policy didn't
-- enforce it), and archive/restore is closed for a frozen company too. SELECT is
-- untouched — is_trek_visible must keep serving staff and existing bookers.
drop policy if exists "view all treks" on public.treks;
drop policy if exists "view treks" on public.treks;
create policy "view treks" on public.treks for select to public using (public.is_trek_visible(id));

drop policy if exists "company members create treks" on public.treks;
create policy "company members create treks" on public.treks for insert to authenticated
with check (public.is_approved_company_member(company_id));

drop policy if exists "company members manage own treks" on public.treks;
create policy "company members manage own treks" on public.treks for update to authenticated
using (public.is_approved_company_member(company_id) or public.is_platform_admin())
with check (public.is_approved_company_member(company_id) or public.is_platform_admin());

-- trek_batches: tenant-aware read; APPROVED-company-managed writes (§16 — a
-- departure is a sellable date, so it follows its trek's publishing tier);
-- delete only while the batch has zero participants AND no chat conversation
-- (never orphan a booking/chat; the conversation FK would otherwise reject the
-- delete, 23503).
drop policy if exists "Anyone can view trek batches" on public.trek_batches;
drop policy if exists "view visible trek batches" on public.trek_batches;
create policy "view visible trek batches" on public.trek_batches for select to public
using (public.is_trek_visible(trek_id));

drop policy if exists "company manages own batches insert" on public.trek_batches;
create policy "company manages own batches insert" on public.trek_batches for insert to authenticated
with check (
  exists (select 1 from public.treks t where t.id = trek_batches.trek_id and public.is_approved_company_member(t.company_id))
);
drop policy if exists "company manages own batches update" on public.trek_batches;
create policy "company manages own batches update" on public.trek_batches for update to authenticated
using (
  exists (select 1 from public.treks t where t.id = trek_batches.trek_id and public.is_approved_company_member(t.company_id))
)
with check (
  exists (select 1 from public.treks t where t.id = trek_batches.trek_id and public.is_approved_company_member(t.company_id))
);
drop policy if exists "company deletes empty batches" on public.trek_batches;
create policy "company deletes empty batches" on public.trek_batches for delete to authenticated
using (
  exists (select 1 from public.treks t where t.id = trek_batches.trek_id and public.is_approved_company_member(t.company_id))
  and not public.batch_has_participants(trek_batches.id)
  and not public.batch_has_conversation(trek_batches.id)
);

-- ---- 12.7 Storage — company-scoped buckets ------------------------------------
-- Mirrors the avatars/trek-reviews pattern but keyed by company_id (first path
-- segment must be a company UUID the caller belongs to). Authenticated-only
-- SELECT blocks anon listing; public CDN URLs still serve files.
--
-- WRITE policies carry the same status tiers as the tables they feed (§16):
-- company-logos → writable (pending companies upload branding while they wait),
-- trek-images → approved-only. Both buckets are PUBLIC, so a write policy left
-- on bare membership would let a frozen company overwrite its logo/cover at the
-- exact CDN paths the storefront already links to, with no companies row ever
-- changing. SELECT stays open to all authenticated — existing images must keep
-- resolving for people who already hold bookings.
insert into storage.buckets (id, name, public) values ('company-logos', 'company-logos', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('trek-images',   'trek-images',   true) on conflict (id) do nothing;

-- Same per-upload ceiling as §9; rationale there.
update storage.buckets
set file_size_limit    = 3145728,  -- 3 MiB
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id in ('company-logos','trek-images');

drop policy if exists "Authenticated users can view company logos" on storage.objects;
create policy "Authenticated users can view company logos" on storage.objects
  for select to authenticated using (bucket_id = 'company-logos');

drop policy if exists "Company members upload own logo" on storage.objects;
create policy "Company members upload own logo" on storage.objects for insert to authenticated
with check (bucket_id = 'company-logos' and public.is_company_member(((storage.foldername(name))[1])::uuid)
            and public.is_company_writable(((storage.foldername(name))[1])::uuid));

drop policy if exists "Company members update own logo" on storage.objects;
create policy "Company members update own logo" on storage.objects for update to authenticated
using (bucket_id = 'company-logos' and public.is_company_member(((storage.foldername(name))[1])::uuid)
       and public.is_company_writable(((storage.foldername(name))[1])::uuid))
with check (bucket_id = 'company-logos' and public.is_company_member(((storage.foldername(name))[1])::uuid)
            and public.is_company_writable(((storage.foldername(name))[1])::uuid));

drop policy if exists "Company members delete own logo" on storage.objects;
create policy "Company members delete own logo" on storage.objects for delete to authenticated
using (bucket_id = 'company-logos' and public.is_company_member(((storage.foldername(name))[1])::uuid)
       and public.is_company_writable(((storage.foldername(name))[1])::uuid));

drop policy if exists "Authenticated users can view trek images" on storage.objects;
create policy "Authenticated users can view trek images" on storage.objects
  for select to authenticated using (bucket_id = 'trek-images');

drop policy if exists "Company members upload trek images" on storage.objects;
create policy "Company members upload trek images" on storage.objects for insert to authenticated
with check (bucket_id = 'trek-images' and public.is_approved_company_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "Company members update trek images" on storage.objects;
create policy "Company members update trek images" on storage.objects for update to authenticated
using (bucket_id = 'trek-images' and public.is_approved_company_member(((storage.foldername(name))[1])::uuid))
with check (bucket_id = 'trek-images' and public.is_approved_company_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "Company members delete trek images" on storage.objects;
create policy "Company members delete trek images" on storage.objects for delete to authenticated
using (bucket_id = 'trek-images' and public.is_approved_company_member(((storage.foldername(name))[1])::uuid));

-- ---- 12.8 Backfill (RAN 2026-07-02, one-time) ---------------------------------
-- The migration created the default "Trekker Originals" company (approved,
-- owned by the earliest profile), attached every pre-existing trek to it, then
-- locked company_id to NOT NULL. Verified live: 0 ownerless treks, 1 approved
-- default company with exactly 1 owner. The do-block itself lives in
-- supabase/migration-multi-tenant.sql §9 and is not reproduced here (fresh
-- projects have no ownerless treks to backfill).
alter table public.treks alter column company_id set not null;

-- ---- 12.9 Manual step — platform admins ---------------------------------------
-- There is NO client path to add a platform admin (by design). Run once in the
-- SQL Editor with your own account's email (template also in
-- supabase/phases/phase-d-platform-admin.sql):
--
--   insert into public.platform_admins (user_id)
--   select id from auth.users where email = 'YOUR_EMAIL_HERE'
--   on conflict (user_id) do nothing;
--
-- STATUS 2026-07-02: platform_admins is EMPTY — /admin and company
-- approve/reject/suspend are unusable until this runs.


-- ============================================================================
-- 13. RATE LIMITING — applied 2026-08-05 via
--     supabase/phases/rate-limiting.sql        (core write paths, §13.1–13.3)
--     supabase/phases/rate-limiting-storage.sql (uploads, §13.4 + §9/§12.7 caps)
--     all verified live; the upload guard was then corrected twice —
--     supabase/phases/fix-storage-rate-limit-owner.sql   (2026-08-05, identity)
--     supabase/phases/fix-storage-rate-limit-message.sql (2026-08-08, §13.5)
-- ============================================================================
-- Every limit lives in Postgres, not a Route Handler: the publishable key ships
-- in the client bundle, so anything enforced in Next.js is skipped by calling
-- PostgREST directly. Guards sit in triggers rather than RPC bodies because
-- these tables also carry a direct client INSERT policy alongside their RPC.
--
-- Already bounded by unique constraints and needing nothing (verified live):
-- favorites, trek_reviews, company_members, trek_batches, companies.
--
-- The 20/hr invite-enumeration guard is inline in §12's invite_company_member.
-- (plpgsql resolves tables at runtime, so §12 creating that function before
-- rate_events exists is fine on a fresh apply.)

-- ---- 13.1 rate_events — append-only counter -----------------------------------
-- Used ONLY where the evidence of an action does not survive (a left trek, a
-- failed lookup). Chat counts its own rows instead — messages are soft-deleted
-- (is_deleted), never removed, so the table is its own accurate counter.
create table if not exists public.rate_events (
  id     bigint generated always as identity primary key,
  actor  uuid        not null references auth.users(id) on delete cascade,
  action text        not null,
  at     timestamptz not null default now()
);

create index if not exists rate_events_actor_action_at_idx
  on public.rate_events (actor, action, at desc);

-- No policies and no grants: RLS on with zero policies denies everything, and
-- the revoke removes the table from PostgREST's reach. Only the SECURITY
-- DEFINER functions below (which bypass RLS) touch it, so a user can neither
-- read their own counter nor delete it to reset a limit.
alter table public.rate_events enable row level security;
revoke all on public.rate_events from anon, authenticated;

-- ---- 13.2 Chat flood — 30 messages / minute / user ----------------------------
-- AFTER ... FOR EACH STATEMENT, not an RLS WITH CHECK: a per-row check cannot
-- see the other rows of its own statement, so PostgREST's bulk insert (POST an
-- array) would pass 1000 messages through a check reading a count of 0 every
-- time. A statement trigger runs once the command is complete and sees all of
-- them; it also raises a real message where a failed WITH CHECK gives an opaque
-- 42501.
create index if not exists conversation_messages_user_created_idx
  on public.conversation_messages (user_id, created_at desc);

create or replace function public.enforce_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_count int;
begin
  -- Service-role / trigger-internal writes have no auth.uid(); never block them.
  if v_uid is null then
    return null;
  end if;

  select count(*) into v_count
  from public.conversation_messages
  where user_id = v_uid and created_at > now() - interval '1 minute';

  -- The rows just inserted are already visible here, so the cap is `>`.
  if v_count > 30 then
    raise exception 'You are sending messages too quickly. Please wait a moment.'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

drop trigger if exists conversation_messages_rate_limit on public.conversation_messages;
create trigger conversation_messages_rate_limit
  after insert on public.conversation_messages
  for each statement
  execute function public.enforce_message_rate_limit();

-- ---- 13.3 Join/leave email amplification — 10 joins / hour / user -------------
-- The cost here is outbound email, not rows: trek_participants carries
-- notify_trek_participation() on INSERT *and* DELETE, so one join/leave cycle
-- sends two emails to real people. UNIQUE (user_id, batch_id) does not help,
-- because leaving deletes the row and frees the slot to be re-used — which is
-- also why this counts rate_events rather than the table itself.
-- A row trigger, not a guard inside join_trek_and_chat(): the "Users can join
-- treks" policy lets a client INSERT into trek_participants directly and skip
-- the RPC. AFTER ROW triggers see earlier rows of the same statement, so a bulk
-- insert is covered too.
create or replace function public.enforce_join_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_count int;
begin
  -- Waitlist promotion and other system writes run without a session.
  if v_uid is null then
    return new;
  end if;

  select count(*) into v_count
  from public.rate_events
  where actor = v_uid and action = 'join' and at > now() - interval '1 hour';

  if v_count >= 10 then
    raise exception 'You have joined too many treks in the last hour. Please try again later.'
      using errcode = 'P0001';
  end if;

  insert into public.rate_events (actor, action) values (v_uid, 'join');
  return new;
end;
$$;

drop trigger if exists trek_participants_rate_limit on public.trek_participants;
create trigger trek_participants_rate_limit
  after insert on public.trek_participants
  for each row
  execute function public.enforce_join_rate_limit();

-- ---- 13.4 Storage uploads — 6/hour (20/hour for review photos) ----------------
-- Pairs with the per-upload size/MIME caps on the buckets themselves (§9 and
-- §12.7): the caps bound ONE upload, this bounds how many.
--
-- INSERT OR UPDATE, not INSERT: avatars use the fixed path {uid}.{ext} with
-- upsert:true, so after the first upload every avatar write is an UPDATE and an
-- INSERT-only trigger would leave that path unguarded. storage-api issues a new
-- `version` per real upload, so the version check keeps renames/metadata
-- touches from consuming budget.
--
-- Counted in rate_events, not from storage.objects: avatars are one row forever
-- (upsert to a fixed path) and review photos are user-deletable, so the object
-- table is not a truthful counter in exactly the two places that matter.
--
-- trek-reviews gets 20/hour because the review form is `multiple` with no file
-- count cap and uploads every photo in one Promise.all — at 6 a single
-- legitimate 8-photo submission would fail partway through its own submit.
--
-- The function lives in public, not storage: `postgres` holds TRIGGER on
-- storage.objects (so the trigger is creatable) but not CREATE on the storage
-- schema.
--
-- ⚠️ IDENTITY COMES FROM new.owner, NOT auth.uid(). auth.uid() returns NULL
-- inside this trigger on the storage-api path (verified live 2026-08-05 by
-- instrumenting it) even though RLS policies on the very same INSERT resolve it
-- correctly — the claims GUC is not visible in the trigger's context there.
-- Using auth.uid() made the guard silently inert: it fired, hit the null guard,
-- and recorded nothing. storage-api populates owner from the JWT sub on every
-- upload and the client cannot forge it (the storage schema is not exposed
-- through PostgREST). Do not "simplify" this back to auth.uid().
--
-- The bucket -> (action, limit) mapping is factored into storage_rate_rule()
-- because the probe in §13.5 reads the same mapping. Two copies of "6" would
-- drift on the first tuning pass and the app would report a limit that is not
-- the one being enforced. v_action is null for an uncovered bucket.
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

revoke all on function public.storage_rate_rule(text) from public, anon, authenticated;

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
  if v_uid is null then
    return null;
  end if;

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
    -- For the Postgres log only. storage-api does not forward a database error
    -- message: it answers 500 with a body of `{}`. See §13.5.
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


-- ---- 13.5 Upload rate-limit probe — how the user learns why -------------------
-- The §13.4 raise never reaches the browser. storage-api does not forward a
-- database error message; it answers 500 with a body of `{}`, which supabase-js
-- turns into the StorageApiError message "{}". No errcode gets around this —
-- storage-api maps 42501 to its own hardcoded RLS text and 23505/23503 to
-- key/bucket errors, everything else to an opaque 500. So a rate-limited upload
-- was indistinguishable from any other failure and the user was told to "try
-- again", which cannot succeed for another hour.
--
-- Rather than parse an error body that will never carry the reason, the client
-- asks. src/lib/uploadErrors.ts calls this only after an upload has already
-- failed with an unrecognised error, so the happy path costs no round trip.
--
-- Read-only and consumes no budget, so probing after a rejection cannot push
-- the caller further into the limit. Returns ONE boolean about the caller's own
-- counter — rate_events itself stays at zero policies and zero grants, so no
-- count, timestamp or other actor is exposed. auth.uid() is reliable here: this
-- is an ordinary PostgREST call, not the storage-api trigger context.
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

-- ---- 13.5 Pruning — pg_cron ---------------------------------------------------
-- Only the last hour is ever read; a day is kept for debugging.
select cron.unschedule('prune-rate-events')
where exists (select 1 from cron.job where jobname = 'prune-rate-events');

select cron.schedule(
  'prune-rate-events',
  '17 * * * *',
  $$delete from public.rate_events where at < now() - interval '1 day'$$
);


-- ============================================================================
-- 14. ACCOUNT TYPES — trekker vs company (applied 2026-08-06)
-- ============================================================================
-- Splits the single account model in two. Before this, every auth user was a
-- full trekker and "being a company" was an add-on (a company_members row), so
-- company owners could also join treks, favourite, chat and review.
-- Full rationale + verification block: supabase/phases/phase-f-account-types.sql
--
-- Reviews need no rule of their own — "Users can review treks they joined"
-- already requires participation. conversation_participants INSERT is
-- service_role-only, so chat has no client bypass either.

-- ---- 14.1 Enum + column -------------------------------------------------------
create type public.account_type as enum ('trekker', 'company');

alter table public.profiles
  add column if not exists account_type public.account_type not null default 'trekker';

-- ---- 14.2 is_trekker() — single source of truth -------------------------------
-- Mirrors is_platform_admin(). The `or is_platform_admin()` is the admin
-- exemption: platform admins keep full trekker access while owning a company,
-- so trekker flows stay testable from the admin account.
create or replace function public.is_trekker()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.account_type = 'trekker'
  ) or public.is_platform_admin();
$$;

revoke execute on function public.is_trekker() from public, anon;
grant execute on function public.is_trekker() to authenticated;

-- ---- 14.3 Trigger — pin account_type against self-edit ------------------------
-- Without this, "Users can update own profile" lets any company account demote
-- itself to 'trekker' with a one-line PATCH and walk past every rule below.
-- The auth.uid() null-check is NOT redundant with is_platform_admin(): auth.uid()
-- is NULL in the SQL Editor, so an admin-only check would evaluate FALSE there
-- and silently revert manual corrections. No client can reach that branch — the
-- profiles UPDATE policy is `to authenticated`.
--
-- UPDATED 2026-08-06 by §15: the GUC branch is the invite-accept escape hatch.
-- accept_company_invite() sets it transaction-locally right before its UPDATE
-- and clears it right after. PostgREST cannot call set_config, so the branch is
-- reachable only from inside a definer function that opts in. See §15.7.
create or replace function public.protect_profile_account_type()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.account_type_change', true), '') = 'allow' then
    return new;
  end if;

  if auth.uid() is not null and not public.is_platform_admin() then
    new.account_type := old.account_type;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_account_type on public.profiles;
create trigger trg_protect_profile_account_type
  before update on public.profiles
  for each row execute function public.protect_profile_account_type();

revoke execute on function public.protect_profile_account_type()
  from public, anon, authenticated;

-- ---- 14.4 handle_new_user — account_type at signup ----------------------------
-- See §2 for the full function. raw_user_meta_data is client-supplied, which is
-- safe in this one direction: signing up as a company is self-service (the
-- company still needs admin approval) and anything but the literal 'company'
-- falls back to 'trekker'. The escalation that matters — company → trekker — is
-- blocked by §14.3.
--   insert into public.profiles (id, email, full_name, account_type)
--   values (..., case when new.raw_user_meta_data->>'account_type' = 'company'
--                     then 'company'::public.account_type
--                     else 'trekker'::public.account_type end)

-- ---- 14.5 join_trek_and_chat — refuse company accounts ------------------------
-- Guard added immediately after the caller-identity checks, before any write, so
-- a blocked join creates no batch and no conversation. See §2 for the function.
--   if not public.is_trekker() then
--     raise exception 'Company accounts cannot join treks';
--   end if;

-- ---- 14.6 RLS — trekker-only writes -------------------------------------------
-- Defence in depth for trek_participants (the RPC in §14.5 is the real guard);
-- for favourites there is no RPC, so this IS the enforcement.
drop policy if exists "Users can join treks" on public.trek_participants;
create policy "Users can join treks" on public.trek_participants for insert to authenticated
  with check (auth.uid() = user_id and public.is_trekker());

drop policy if exists "Users can favorite treks" on public.favorites;
create policy "Users can favorite treks" on public.favorites for insert to authenticated
  with check (auth.uid() = user_id and public.is_trekker());

-- ---- 14.7 apply_for_company — company accounts only ---------------------------
-- The inverse restriction: a trekker can no longer convert mid-life. Companies
-- are created by signing up as one. See §12.4 for the full function.
--   if not exists (select 1 from public.profiles p
--                  where p.id = v_uid and p.account_type = 'company') then
--     raise exception 'Only company accounts can apply. Sign up as a trek company instead.';
--   end if;

-- ---- 14.8 Backfill (RAN 2026-08-06, one-time) ---------------------------------
-- Platform admins were NOT skipped — the data reflects reality; their exemption
-- lives in is_trekker() as one documented rule rather than two half-rules.
-- Result: 2 company / 2 trekker profiles; 0 company_members rows left as trekker.
--   update public.profiles p set account_type = 'company'
--   where p.account_type <> 'company'
--     and exists (select 1 from public.company_members cm where cm.user_id = p.id);


-- ============================================================================
-- 15. INVITE → ACCEPT — consent before conversion (applied 2026-08-06)
-- ============================================================================
-- §14 made account_type immutable, which left a trekker who genuinely wants to
-- join a company team with no way across. This section builds that path as a
-- CONSENT step. Before it, invite_company_member() inserted straight into
-- company_members and answered "Teammate added" — bolting conversion onto that
-- would let any company admin end a trekker's account by typing their email.
-- Full rationale + verification block: supabase/phases/phase-g-invite-accept.sql
--
-- Conversion deletes nothing. account_type flips, RLS then refuses new joins /
-- favourites and the (trekker) route group redirects to /dashboard; existing
-- bookings, favourites, chats and reviews stay in the database, unreachable via
-- the app. Only a platform admin can flip it back.

-- ---- 15.1 company_invites -----------------------------------------------------
-- No token column and no email delivery on purpose: invite_company_member()
-- requires the invitee to already have a Trekker account (it resolves them in
-- profiles by email), so the invite is simply shown to them at /invites when
-- they sign in. Inviting people WITHOUT accounts is what would need a hashed
-- token + a mail step. email is stored lowercased+trimmed by the RPC and every
-- lookup lowercases, so a typo'd case cannot create a second live invite.
create table if not exists public.company_invites (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  email        text not null,
  invited_by   uuid not null references public.profiles(id),
  role         public.company_role not null default 'staff' check (role <> 'owner'),
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  responded_at timestamptz
);

-- One live invite per (company, email); partial so accepted/declined/revoked
-- history doesn't block re-inviting the same person.
create unique index if not exists company_invites_pending_key
  on public.company_invites (company_id, lower(email))
  where status = 'pending';

create index if not exists company_invites_email_idx
  on public.company_invites (lower(email))
  where status = 'pending';

-- ---- 15.2 RLS — read for the company, writes RPC-only -------------------------
-- The invitee gets NO read policy here: their screen needs the company name and
-- the inviter's name, and as a non-member "view companies" hides an unapproved
-- company from them while profiles is self-only. They read through
-- get_my_invites() instead — same reason get_company_members() exists (§12).
-- The grant revokes are belt-and-braces so a carelessly added policy later
-- cannot by itself open a direct write path.
alter table public.company_invites enable row level security;

drop policy if exists "view company invites" on public.company_invites;
create policy "view company invites" on public.company_invites for select to authenticated
using (public.is_company_member(company_id) or public.is_platform_admin());

revoke all on public.company_invites from anon;
revoke insert, update, delete on public.company_invites from authenticated;
grant select on public.company_invites to authenticated;

-- ---- 15.3 invite_company_member — writes an invite, not a membership ----------
-- KEEPS from §13: the is_company_admin() gate, the 20/hour rate_events cap, and
-- the RETURNED (not raised) 'not_found' — a raise rolls back the rate_events row
-- recording the attempt, so every failed probe would erase its own evidence.
-- CHANGED: the tail writes a pending invite. Expired pendings are swept to
-- 'revoked' first, or a timed-out invite would hold the partial unique index and
-- make that person permanently un-invitable behind a confusing "already invited".
-- §16 ADDED the is_company_writable() gate, BEFORE the rate-limit insert: rate
-- limiting exists to blunt email enumeration through 'not_found', and a frozen
-- company is refused before it learns anything, so there is nothing to meter.
-- Returned as 'company_frozen' (not raised) to match the other expected answers
-- the client maps to copy.
create or replace function public.invite_company_member(p_company_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id   uuid;
  v_count     int;
  v_uid       uuid := auth.uid();
  v_email     text := lower(trim(p_email));
  v_invite_id uuid;
begin
  if not public.is_company_admin(p_company_id) then
    raise exception 'Only company owners/admins can invite members';
  end if;

  if not public.is_company_writable(p_company_id) then
    return jsonb_build_object('error', 'company_frozen');
  end if;

  select count(*) into v_count
  from public.rate_events
  where actor = v_uid and action = 'invite' and at > now() - interval '1 hour';

  if v_count >= 20 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into public.rate_events (actor, action) values (v_uid, 'invite');

  select id into v_user_id from public.profiles where lower(email) = v_email;

  if v_user_id is null then
    return jsonb_build_object('error', 'not_found');
  end if;

  if exists (
    select 1 from public.company_members
    where company_id = p_company_id and user_id = v_user_id
  ) then
    return jsonb_build_object('already_member', true);
  end if;

  update public.company_invites
     set status = 'revoked', responded_at = now()
   where company_id = p_company_id
     and lower(email) = v_email
     and status = 'pending'
     and expires_at <= now();

  if exists (
    select 1 from public.company_invites
    where company_id = p_company_id and lower(email) = v_email and status = 'pending'
  ) then
    return jsonb_build_object('error', 'already_invited');
  end if;

  insert into public.company_invites (company_id, email, invited_by, role)
  values (p_company_id, v_email, v_uid, 'staff')
  returning id into v_invite_id;

  return jsonb_build_object('invite_id', v_invite_id);
end;
$$;
grant execute on function public.invite_company_member(uuid, text) to authenticated;

-- ---- 15.4 get_my_invites — the invitee's side ---------------------------------
-- DEFINER because the invitee is not a member yet. The caller's email comes from
-- their own profile row, never from an argument or a JWT claim; signed out the
-- subquery is NULL and no row matches.
create or replace function public.get_my_invites()
returns table (
  invite_id        uuid,
  company_id       uuid,
  company_name     text,
  company_slug     text,
  company_logo_url text,
  role             public.company_role,
  invited_by_name  text,
  created_at       timestamptz,
  expires_at       timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, c.id, c.name, c.slug, c.logo_url, i.role,
         p.full_name, i.created_at, i.expires_at
  from public.company_invites i
  join public.companies c on c.id = i.company_id
  left join public.profiles p on p.id = i.invited_by
  where i.status = 'pending'
    and i.expires_at > now()
    and lower(i.email) = (
      select lower(me.email) from public.profiles me where me.id = auth.uid()
    )
  order by i.created_at desc;
$$;
revoke execute on function public.get_my_invites() from public, anon;
grant execute on function public.get_my_invites() to authenticated;

-- ---- 15.5 accept_company_invite — the only trekker → company path -------------
-- The invite is matched against the caller's OWN profiles.email, so holding an
-- invite id is not enough to accept someone else's invite.
--
-- Branches on the RAW account_type, deliberately NOT is_trekker(): that returns
-- true for platform admins whatever their column says, which would send an admin
-- who is already a company account down the conversion branch. An account that
-- is already 'company' just gains the membership — company accounts could always
-- be added to a second team and §15.8 must not silently remove that.
--
-- Upcoming participation blocks conversion because a converted account can no
-- longer open /messages: a booking would strand them in a batch chat they can't
-- reach. WAITLISTED rows count too — promote_waitlist_on_leave() promotes FIFO
-- without consulting account_type, so a waitlisted row is a booking that can
-- activate itself after the conversion.
--
-- DIRECTION: the UPDATE hard-codes 'company' inside the trekker branch. Nothing
-- here can move an account back; company → trekker stays platform-admin-only.
create or replace function public.accept_company_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_email        text;
  v_account_type public.account_type;
  v_company_id   uuid;
  v_role         public.company_role;
  v_converted    boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select lower(p.email), p.account_type into v_email, v_account_type
  from public.profiles p where p.id = v_uid;

  if v_email is null then
    raise exception 'Your account has no email address';
  end if;

  select i.company_id, i.role into v_company_id, v_role
  from public.company_invites i
  where i.id = p_invite_id
    and i.status = 'pending'
    and i.expires_at > now()
    and lower(i.email) = v_email
  for update;

  if v_company_id is null then
    raise exception 'That invitation is no longer valid';
  end if;

  -- §16: status is re-checked HERE, not only at invite time — an invite issued
  -- while approved stays live after a reject/suspend, and accepting it converts
  -- the trekker's account irreversibly for a seat on a tenant that can do
  -- nothing. After the lookup, so a non-owner still gets 'no longer valid' and
  -- learns nothing about the company's status.
  if not public.is_company_writable(v_company_id) then
    raise exception 'That company is no longer active on Trekker, so this invitation can no longer be accepted.';
  end if;

  if v_account_type = 'trekker' then
    if exists (
      select 1
      from public.trek_participants tp
      join public.trek_batches b on b.id = tp.batch_id
      where tp.user_id = v_uid and b.batch_date >= current_date
    ) then
      raise exception 'You have an upcoming trek booked. Leave it before joining a company team.';
    end if;

    perform set_config('app.account_type_change', 'allow', true);
    update public.profiles set account_type = 'company' where id = v_uid;
    perform set_config('app.account_type_change', '', true);

    v_converted := true;
  end if;

  insert into public.company_members (company_id, user_id, role)
  values (v_company_id, v_uid, v_role)
  on conflict (company_id, user_id) do nothing;

  update public.company_invites
     set status = 'accepted', responded_at = now()
   where id = p_invite_id;

  return jsonb_build_object('company_id', v_company_id, 'converted', v_converted);
end;
$$;
revoke execute on function public.accept_company_invite(uuid) from public, anon;
grant execute on function public.accept_company_invite(uuid) to authenticated;

-- ---- 15.6 decline / revoke ----------------------------------------------------
-- decline: same ownership rule as accept (matched on the caller's own email).
-- revoke: the company's side, gated on is_company_admin of the invite's company.
create or replace function public.decline_company_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  update public.company_invites
     set status = 'declined', responded_at = now()
   where id = p_invite_id
     and status = 'pending'
     and lower(email) = (
       select lower(me.email) from public.profiles me where me.id = v_uid
     );

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'That invitation is no longer valid';
  end if;

  return jsonb_build_object('declined', true);
end;
$$;
revoke execute on function public.decline_company_invite(uuid) from public, anon;
grant execute on function public.decline_company_invite(uuid) to authenticated;

create or replace function public.revoke_company_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
begin
  select company_id into v_company_id
  from public.company_invites
  where id = p_invite_id and status = 'pending';

  if v_company_id is null then
    raise exception 'That invitation is no longer pending';
  end if;

  if not public.is_company_admin(v_company_id) then
    raise exception 'Only company owners/admins can revoke invites';
  end if;

  update public.company_invites
     set status = 'revoked', responded_at = now()
   where id = p_invite_id;

  return jsonb_build_object('revoked', true);
end;
$$;
revoke execute on function public.revoke_company_invite(uuid) from public, anon;
grant execute on function public.revoke_company_invite(uuid) to authenticated;

-- ---- 15.7 protect_profile_account_type — the escape hatch ---------------------
-- Definition lives in §14.3 (updated in place). The GUC is transaction-local and
-- only settable by SQL running inside the database: PostgREST exposes functions
-- in the API schema, set_config lives in pg_catalog and is not among them, and
-- the only GUCs a request can influence are the request.* ones PostgREST sets
-- itself. If that ever stops being true, the §14 pin is gone and with it every
-- rule that depends on account_type.

-- ---- 15.8 Close the direct-insert bypass --------------------------------------
-- The dropped policy is quoted at §12 where it used to live. company_members now
-- has SELECT / UPDATE / DELETE policies only; the sole INSERT paths are
-- apply_for_company() (owner row, §12.4) and accept_company_invite() (§15.5),
-- both SECURITY DEFINER and both re-checking authorization internally. Verified
-- before dropping that no app code inserts into company_members directly.
-- UPDATE/DELETE untouched: reversible acts on a membership the admin can already
-- see, still carrying role <> 'owner' and user_id <> auth.uid().
drop policy if exists "company admins invite staff" on public.company_members;
revoke insert on public.company_members from anon, authenticated;


-- ============================================================================
-- 16. FROZEN COMPANIES — rejected / suspended tenants are read-only
--     (applied + verified live 2026-08-08)
-- ============================================================================
-- Until this section, every company-scoped WRITE policy asked only "is the
-- caller a member?". Status was consulted for READS (is_trek_visible hides an
-- unapproved catalogue) and nothing else, so a company a platform admin had
-- rejected or suspended kept full write access to its own tenant: invite staff,
-- change roles, remove members, rewrite its public storefront copy,
-- archive/restore treks, add and delete departures.
--
-- TWO TIERS, because "not approved yet" and "approval withdrawn" differ:
--   is_company_writable()        pending + approved   settings, team, logos
--   is_approved_company_member() approved only        treks, batches, trek images
-- Plain is_company_member / is_company_admin now mean "is a member", NOT "may
-- write" — pair them with is_company_writable(), or use the approved helper for
-- anything that reaches the public catalogue.
--
-- SELECT is deliberately never gated by either (is_trek_visible already handles
-- read visibility, and staff plus existing bookers must keep reading a hidden
-- trek), and neither are the is_platform_admin() arms — freezing must not lock
-- out the role that un-freezes.
--
-- The DDL is folded in place rather than repeated here:
--   §12.4  is_company_writable() definition + grant; is_approved_company_member
--          grant (orphaned since the multi-tenant migration until now)
--   §12.6  companies UPDATE, company_members UPDATE/DELETE  → + writable
--          treks INSERT/UPDATE, trek_batches INSERT/UPDATE/DELETE → approved
--   §12.7  storage write policies, tier-matched per bucket
--   §15.3  invite_company_member → returns {"error":"company_frozen"}
--   §15.5  accept_company_invite → re-checks status at ACCEPT time
--
-- NOT gated, deliberately: revoke_company_invite / decline_company_invite (both
-- de-escalating), the platform-admin arms, and every participant-facing flow
-- (join_trek_and_chat + the waitlist/count triggers are SECURITY DEFINER, so no
-- existing booking or chat on a suspended company's trek is touched).
--
-- Non-destructive and reversible: no data was deleted or rewritten, and
-- re-approving a company restores every capability with no backfill.
--
-- Full rationale + verification blocks:
--   supabase/phases/phase-h-frozen-companies.sql


-- ============================================================================
-- 17. BATCH ANNOUNCEMENTS — company → the people who booked its departure
--     (applied 2026-08-08; behaviourally verified + tightened 2026-08-12)
-- ============================================================================
-- /messages lives under the (trekker) route group and join_trek_and_chat()
-- refuses company accounts outright, so an operator had no channel at all to its
-- own bookers. An announcement is a flagged row in the batch's EXISTING
-- conversation, not a new table — that reuses realtime delivery,
-- get_unread_counts() and mark_conversation_read() unchanged, and it lands where
-- trekkers already look.
--
-- The company user is never a conversation_participant, so both the write and the
-- read-back go through SECURITY DEFINER RPCs; the author literally cannot SELECT
-- the row it just wrote. They stay outside the chat: no trekker replies, no
-- presence, no member list.
--
-- DDL folded in place rather than repeated here:
--   §2   conversation_messages.is_announcement boolean not null default false
--   §8   "Send messages" / "Edit own messages" with_check + is_announcement=false
--        — the forgery gate. post_batch_announcement() is owned by postgres,
--        which owns the table and has NOT set FORCE ROW LEVEL SECURITY, so it
--        bypasses both policies; the pin binds PostgREST clients only.
--        Side effect, accepted: an announcement is immutable through the table
--        API, soft-delete included.
--
-- Verified as real writes 2026-08-12 (not just structurally): as a signed-in
-- trekker, POST /rest/v1/conversation_messages with is_announcement:true → 403 /
-- 42501, and the same insert without the flag → 201. Both refusal branches below
-- and all four permission controls fire as written.

create or replace function public.post_batch_announcement(p_batch_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid        uuid := auth.uid();
  v_company_id uuid;
  v_convo_id   uuid;
  v_message    text := btrim(coalesce(p_message, ''));
  v_id         uuid;
  v_created_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Same cap as messageSchema in src/lib/schemas.ts, restated here because the
  -- client bound is advisory only.
  if v_message = '' then
    raise exception 'Announcement cannot be empty';
  end if;
  if length(v_message) > 2000 then
    raise exception 'Announcement is too long (2000 characters max)';
  end if;

  select t.company_id into v_company_id
  from public.trek_batches tb
  join public.treks t on t.id = tb.trek_id
  where tb.id = p_batch_id;

  if v_company_id is null then
    raise exception 'Departure not found';
  end if;

  -- Approved-only (§16 tier): an announcement is an operational message to paying
  -- customers, so it sits at the manage-departures bar, not the looser any-member
  -- bar used for reading the roster.
  if not public.is_approved_company_member(v_company_id) then
    raise exception 'You do not have permission to post announcements for this departure';
  end if;

  select id into v_convo_id from public.conversations where batch_id = p_batch_id;
  if v_convo_id is null then
    -- join_trek_and_chat() creates the conversation on the first confirmed
    -- booking. No conversation means nobody has ever joined.
    raise exception 'No one has booked this departure yet';
  end if;

  -- Added 2026-08-12 (fix-announcement-requires-listeners.sql). The conversation
  -- outlives its members — leaveTrek() clears conversation_participants and never
  -- the conversations row — so existence is not readership, and without this a
  -- vacated departure accepted an announcement no one would ever read and
  -- reported success. Separate message from the branch above because they are
  -- different facts and the client shows P0001 text verbatim.
  if not exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = v_convo_id
  ) then
    raise exception 'Everyone has left this departure — there is no one to announce to';
  end if;

  -- conversation_messages_rate_limit (§13, AFTER STATEMENT) reads auth.uid(),
  -- which inside a definer function is still the caller — so announcements hit
  -- the same 30/min cap as chat with no extra code.
  insert into public.conversation_messages (conversation_id, user_id, message, is_announcement)
  values (v_convo_id, v_uid, v_message, true)
  returning id, created_at into v_id, v_created_at;

  return jsonb_build_object(
    'id', v_id,
    'conversation_id', v_convo_id,
    'created_at', v_created_at
  );
end;
$$;

-- Dashboard read-back. Reading matches the roster bar (any member — a frozen
-- company can still review what it sent); posting is stricter. Silent empty on no
-- access, mirroring get_company_batch_participants().
create or replace function public.get_batch_announcements(p_batch_id uuid)
returns table (
  id uuid,
  message text,
  created_at timestamptz,
  author_id uuid,
  author_name text
)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
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
  select m.id, m.message, m.created_at, m.user_id, p.full_name
  from public.conversation_messages m
  join public.conversations c on c.id = m.conversation_id
  left join public.profiles p on p.id = m.user_id
  where c.batch_id = p_batch_id
    and m.is_announcement
    and coalesce(m.is_deleted, false) = false
  order by m.created_at desc;
end;
$$;

-- Both are new functions, so without this pair they would land with the default
-- PUBLIC execute grant and re-open the anon_security_definer_function_executable
-- lint that fix-anon-execute-definer-rpcs.sql closed (21 → 3). See Known Gotchas:
-- `revoke … from public` also removes `authenticated`, which inherits through it.
revoke execute on function public.post_batch_announcement(uuid, text) from public, anon;
grant  execute on function public.post_batch_announcement(uuid, text) to authenticated;

revoke execute on function public.get_batch_announcements(uuid) from public, anon;
grant  execute on function public.get_batch_announcements(uuid) to authenticated;

-- Full rationale + verification blocks:
--   supabase/phases/phase-i-batch-announcements.sql
--   supabase/phases/fix-announcement-requires-listeners.sql


-- ============================================================================
-- 18. CHAT HOT-PATH INDEXES — applied 2026-08-12 via
--     supabase/phases/perf-chat-hot-path-indexes.sql
-- ============================================================================
-- The DDL lives beside each table in §3 (that is where a reader looks for it);
-- this section records WHY, since an index is invisible in behaviour and the
-- next reader would otherwise have no way to tell a load-bearing one from a
-- speculative one.
--
-- The gap: conversation_messages had only its (created_at, id) pkey and
-- conversation_messages_user_created_idx (user_id, created_at desc) from §13 —
-- NOTHING led with conversation_id, which is what every chat read filters on
-- (src/app/(trekker)/messages/page.tsx fetchMessagesPage). So opening a
-- conversation and every scroll-back page was a sequential scan of the
-- fastest-growing table in the schema. Same shape on conversation_participants,
-- whose two indexes both led with conversation_id, leaving "which chats am I
-- in?" — the DRIVING side of get_unread_counts(), which runs on every page load
-- for the unread badge, not just on /messages — with no usable index.
--
-- Four indexes added (all in §3):
--   conversation_messages     (conversation_id, created_at desc)
--   conversation_participants (user_id, conversation_id)
--   favorites                 (trek_id)      -- unindexed FK
--   trek_reviews              (user_id)      -- unindexed FK
--
-- Plus a duplicate dropped: conversation_participants carried TWO byte-identical
-- uniques on (conversation_id, user_id) — conversation_participants_conv_user_key
-- (declared in §3) and conversation_participants_conversation_id_user_id_key
-- (Postgres default name, never documented here). Both btrees were maintained on
-- every chat join for one guarantee. The default-named one is gone; §3 shows the
-- surviving state. Safe because every `on conflict (conversation_id, user_id)` in
-- the codebase (join_trek_and_chat §5, promote_waitlist_on_leave §5) infers its
-- arbiter from the COLUMN LIST, not a constraint name, and no FK targeted either.
--
-- Deliberately NOT indexed:
--   trek_batches.trek_id — already the leading column of
--     trek_batches_trekid_batchdate_key; a prefix is usable, so a standalone
--     index would be pure write overhead. (CODE_REVIEW item 6 suggests it — skip.)
--   companies.approved_by, company_invites.invited_by — genuinely unindexed FKs,
--     but 4 rows each on platform-admin-only paths. These are the only two the
--     unindexed-FK query still returns; that is expected, not debt to chase.
--
-- Verified live after apply: all four present, exactly one unique left on
-- conversation_participants, and `set enable_seqscan = off` + explain shows
-- Index Scan using conversation_messages_conv_created_idx with the
-- conversation_id Index Cond and NO Sort node (the index supplies the ordering).
-- At 59 rows the unforced plan still picks a seq scan — 2 pages, so that is the
-- planner being right; the index takes over as the table grows.


-- ============================================================================
-- 17. EXECUTE GRANTS — reconciled against the live database 2026-08-13
-- ============================================================================
-- Postgres grants EXECUTE to PUBLIC on every new function, and `create or
-- replace` preserves the existing ACL — so a function created without an
-- explicit grant stays anon-executable forever unless something revokes it.
-- These revokes ARE the access control; the grants above them are not.
--
-- Why this section exists: `phases/fix-anon-execute-definer-rpcs.sql` was
-- applied live on 2026-08-08 (FEATURES.md §2) but never folded back into this
-- file, so a fresh replay of schema.sql produced a database where 18 SECURITY
-- DEFINER RPCs — including get_company_batch_participants, which returns
-- participant phone numbers and emergency contacts — were callable by anon.
-- Each one still refuses to return rows to a caller with no auth.uid(), so this
-- was defence-in-depth rather than a live hole, but the file was lying.
--
-- Found by tests/db/acl.test.ts. Every signature below was verified against
-- production before being written here (has_function_privilege on anon and
-- authenticated); this section documents live state, it does not change it.
--
-- ⚠️ `revoke ... from public` ALSO strips authenticated, which nearly all of
-- these inherit through PUBLIC rather than hold directly. Every revoke must be
-- paired with an explicit `grant execute ... to authenticated` or the dashboard,
-- admin panel and chat break. Any new definer RPC ships both lines.
--
-- ⚠️ NOT revoked, deliberately: is_trek_visible, is_company_member and
-- is_platform_admin are called from PUBLIC-role SELECT policies on treks /
-- trek_batches / companies. RLS quals evaluate as the querying role, so every
-- anonymous view of /explore, /trek/[id] and /company/[slug] executes them.
-- They are load-bearing for anon, and the three matching advisor WARNs stay
-- open by design. See the Known Gotcha in FEATURES.md.

-- ---- 17.1 Company + platform admin RPCs ---------------------------------------
revoke execute on function public.apply_for_company(text, text, text, text, text, text) from public, anon;
grant  execute on function public.apply_for_company(text, text, text, text, text, text) to authenticated;

revoke execute on function public.approve_company(uuid) from public, anon;
grant  execute on function public.approve_company(uuid) to authenticated;

revoke execute on function public.reject_company(uuid, text) from public, anon;
grant  execute on function public.reject_company(uuid, text) to authenticated;

revoke execute on function public.suspend_company(uuid, text) from public, anon;
grant  execute on function public.suspend_company(uuid, text) to authenticated;

revoke execute on function public.invite_company_member(uuid, text) from public, anon;
grant  execute on function public.invite_company_member(uuid, text) to authenticated;

revoke execute on function public.get_company_members(uuid) from public, anon;
grant  execute on function public.get_company_members(uuid) to authenticated;

-- Returns phone_no / emergency_contact / emergency_no for every booking in a
-- batch. The is_company_member() check in its body is the real guard; this is
-- the second lock.
revoke execute on function public.get_company_batch_participants(uuid) from public, anon;
grant  execute on function public.get_company_batch_participants(uuid) to authenticated;

revoke execute on function public.get_trek_batch_confirmed_counts(uuid) from public, anon;
grant  execute on function public.get_trek_batch_confirmed_counts(uuid) to authenticated;

-- ---- 17.2 Chat RPCs -----------------------------------------------------------
revoke execute on function public.get_unread_counts() from public, anon;
grant  execute on function public.get_unread_counts() to authenticated;

revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant  execute on function public.mark_conversation_read(uuid) to authenticated;

-- ---- 17.3 Membership + capability predicates ----------------------------------
revoke execute on function public.is_company_admin(uuid) from public, anon;
grant  execute on function public.is_company_admin(uuid) to authenticated;

revoke execute on function public.is_approved_company_member(uuid) from public, anon;
grant  execute on function public.is_approved_company_member(uuid) to authenticated;

revoke execute on function public.is_company_writable(uuid) from public, anon;
grant  execute on function public.is_company_writable(uuid) to authenticated;

revoke execute on function public.batch_has_conversation(uuid) from public, anon;
grant  execute on function public.batch_has_conversation(uuid) to authenticated;

revoke execute on function public.batch_has_participants(uuid) from public, anon;
grant  execute on function public.batch_has_participants(uuid) to authenticated;

-- ---- 17.4 Trigger functions ---------------------------------------------------
-- Postgres checks EXECUTE at CREATE TRIGGER time, not when the trigger fires,
-- so no caller needs the grant and none is paired back.
revoke execute on function public.enforce_join_rate_limit() from public, anon;
revoke execute on function public.enforce_message_rate_limit() from public, anon;
revoke execute on function public.enforce_storage_rate_limit() from public, anon;

-- ---- 17.5 Previously undocumented -------------------------------------------
-- These two were never covered by any file in supabase/ — not by §1-16 here and
-- not by phases/fix-anon-execute-definer-rpcs.sql — yet production already has
-- anon = false and authenticated = true for both. That state existed ONLY in the
-- live database, so replaying this file could not reproduce it. Verified live
-- 2026-08-13 and written down here; applying these is a no-op on production.
revoke execute on function public.is_chat_participant(uuid) from public, anon;
grant  execute on function public.is_chat_participant(uuid) to authenticated;

revoke execute on function public.join_trek_and_chat(uuid, uuid, date) from public, anon;
grant  execute on function public.join_trek_and_chat(uuid, uuid, date) to authenticated;


-- ============================================================================
-- 18. RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0001', 'baseline')
on conflict (version) do nothing;


-- ##########################################################################
-- # 0002_trek-returning-and-chat-policy-roles.sql
-- ##########################################################################

-- ============================================================================
-- 0002 — createTrek() RETURNING fix + chat policy role scoping
-- ============================================================================
-- Both changes were applied to production on 2026-08-13, shortly after 0001,
-- via phases/fix-trek-returning-and-chat-policy-roles.sql. They are recorded
-- here as their own migration so the ledger reflects what actually ran, in the
-- order it ran. Re-running this file against production is a no-op: every
-- statement is `drop policy if exists` + `create policy`, and the resulting
-- definitions match what is already live.
--
-- Found by tests/db/catalogue-writes.test.ts. Neither change grants any
-- visibility that did not already exist.
--
-- Rationale in full: FEATURES.md §1.7 and §1.8.


-- ===== A. treks — a second SELECT policy so INSERT … RETURNING can pass ======
--
-- `insert … returning` applies the table's SELECT policy to the new row.
-- "view treks" is `using (public.is_trek_visible(id))`, and is_trek_visible is
-- STABLE with a body that reads public.treks — so it evaluates against the
-- snapshot taken at the start of the statement and cannot see the row that same
-- statement is inserting. The predicate returns false, the returned row fails
-- the SELECT check, and the INSERT is rejected with `new row violates row-level
-- security policy for table "treks"` — an error that reads like a with_check
-- failure and sends you to the wrong policy.
--
-- src/lib/company.ts createTrek() is `.insert({...}).select('id').single()`,
-- which PostgREST compiles to exactly that, so no company could publish a trek.
-- It failed for platform admins too: the `or is_platform_admin()` arm sits
-- inside the same unsatisfiable FROM clause. createBatch() was unaffected — it
-- inserts without `.select()`.
--
-- ⚠️ Do NOT fold this into "view treks" as an `or` arm instead. That policy is
-- `to public`, which includes anon, and is_approved_company_member is revoked
-- from anon (0001 §17.3) — every anonymous /explore and /trek/[id] read would
-- raise `permission denied for function is_approved_company_member`. Same trap
-- as the load-bearing trio in FEATURES.md Known Gotchas.
--
-- A second permissive policy scoped `to authenticated` avoids that: Postgres
-- only applies policies whose roles include the current role, so anon never
-- evaluates this one, and permissive policies on the same command are OR'd.
--
-- Grants no new visibility: is_trek_visible already carries
-- `or is_company_member(t.company_id)` with no status gate, and this is the
-- strictly narrower approved-only form. It exists only to be evaluable during
-- `insert … returning`, since it reads company_members/companies and never treks.
drop policy if exists "company members view own treks" on public.treks;
create policy "company members view own treks" on public.treks for select to authenticated
using (public.is_approved_company_member(company_id));


-- ===== B. chat policies — `to public` → `to authenticated` ===================
--
-- The four chat policies that call is_chat_participant() were declared
-- `to public`, which includes anon — but anon does not hold EXECUTE on
-- is_chat_participant (0001 §17.5). An anonymous read of conversation_messages
-- therefore raised `permission denied for function is_chat_participant` rather
-- than returning an empty set. It failed closed and nothing in the app reads
-- chat anonymously, so this is tidiness, not exposure.
--
-- Note this is the OPPOSITE resolution to the load-bearing trio in FEATURES.md
-- Known Gotchas — same shape (a definer function called from a `to public`
-- policy), different answer, because chat genuinely has no anonymous read path
-- while /explore does.
--
-- Only these four are re-scoped. The other four chat policies stay `to public`:
-- "System adds participants" tests `auth.role() = 'service_role'` and would be
-- excluded by re-scoping, and the three `user_id = auth.uid()` ones call no
-- revoked function. Quals are otherwise unchanged — note `is_announcement =
-- false` stays pinned on "Send messages".
drop policy if exists "Users can view their conversations" on public.conversations;
create policy "Users can view their conversations" on public.conversations for select to authenticated
using (public.is_chat_participant(id));

drop policy if exists "Users can view participants of their chats" on public.conversation_participants;
create policy "Users can view participants of their chats" on public.conversation_participants for select to authenticated
using (public.is_chat_participant(conversation_id));

drop policy if exists "Read messages of joined conversations" on public.conversation_messages;
create policy "Read messages of joined conversations" on public.conversation_messages for select to authenticated
using (public.is_chat_participant(conversation_id));

drop policy if exists "Send messages" on public.conversation_messages;
create policy "Send messages" on public.conversation_messages for insert to authenticated
with check (user_id = auth.uid() and public.is_chat_participant(conversation_id) and is_announcement = false);


-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0002', 'trek-returning-and-chat-policy-roles')
on conflict (version) do nothing;


-- ##########################################################################
-- # 0003_lock-platform-admins-grants.sql
-- ##########################################################################

-- ============================================================================
-- 0003 — revoke client grants on platform_admins (defense in depth)
-- ============================================================================
-- platform_admins is the super-admin allowlist; a successful INSERT into it is
-- a full privilege escalation. It has always been protected by RLS enabled with
-- deliberately ZERO policies (default-deny for every client role), and there is
-- no client path to add an admin — rows are inserted only in the SQL Editor as
-- the table owner.
--
-- But in production the table still carried Supabase's default GRANT ALL to
-- anon/authenticated, so RLS was the SOLE barrier. Disable RLS once — a stray
-- migration, a debug session — and an anonymous caller could both read the
-- admin list and insert its own uid as an admin. (This also made a plain
-- `select` return `[]` with 200 instead of a permission error, since the grant
-- was present; a Strix probe on 2026-08-18 flagged exactly that.)
--
-- Mirror rate_events (0001 §13): revoke the grants outright, so the table is
-- defended by BOTH the missing privilege AND RLS — either alone now denies
-- access, and clients get a hard permission error rather than an empty read.
-- Re-running is a no-op; revoking a privilege that isn't held does nothing.

revoke all on public.platform_admins from anon, authenticated;

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0003', 'lock-platform-admins-grants')
on conflict (version) do nothing;


-- ##########################################################################
-- # 0004_realtime-private-channel-authorization.sql
-- ##########################################################################

-- ============================================================================
-- 0004 — realtime.messages: private chat channel authorization (record only)
-- ============================================================================
-- messages/page.tsx opens `conversation:${id}` with `{ private: true }` for two
-- things: presence (who's online) and a `typing` broadcast. Supabase private
-- channels are authorized by RLS on realtime.messages — a table this repo
-- never touched, which is what REALTIME-002/003 (2026-08-24 pentest) flagged.
--
-- realtime.messages is owned by supabase_realtime_admin, not postgres. Verified
-- live (read-only MCP, 2026-08-25): `postgres` holds no membership in
-- supabase_realtime_admin (`select rolname from pg_auth_members ... where
-- member = 'postgres'::regrole` — anon/authenticated/service_role and a few
-- admin roles, no supabase_realtime_admin). That means `alter table
-- realtime.messages enable row level security` and `create policy ... on
-- realtime.messages` can NEVER be run from the SQL Editor on this — or any —
-- Supabase project: it fails with `must be owner of table messages` by
-- platform design, not a grant this repo revoked. The only supported path is
-- the Dashboard: Database → Realtime → Policies.
--
-- That path was already used, before this migration existed: querying
-- pg_class/pg_policy live shows realtime.messages already has RLS enabled and
-- two policies — "chat members read conversation channel" (select) and "chat
-- members write conversation channel" (insert) — both `to authenticated`,
-- both gated on `('conversation:' || conversations.id) = realtime.topic() and
-- is_chat_participant(conversations.id)`. REALTIME-002/003 is closed in
-- production. This file exists only to:
--
--   1. Record that fact in version control (nothing else in the repo mentions
--      realtime.messages, and CLAUDE.md is explicit that DB state undocumented
--      here is state nobody can reason about).
--   2. Let tests/db (PGlite, connected as an actual superuser — the ownership
--      restriction above is a hosted-Supabase-only boundary) replay the same
--      protection, so `tests/db/chat.test.ts` can assert it behaviourally
--      instead of everyone trusting a comment.
--
-- Do NOT paste the ALTER TABLE / CREATE POLICY statements below into the SQL
-- Editor against production — they will fail with "must be owner of table
-- messages" exactly as they did the first time this was tried. Only the
-- ledger INSERT at the bottom targets a table this repo actually owns
-- (supabase_migrations.schema_migrations); running just that (optional —
-- bookkeeping only, changes no access rules) records the version. To change
-- these policies going forward, use the Dashboard, then update this file to
-- match and re-record it the way 0002 documents an already-applied change.

alter table realtime.messages enable row level security;

drop policy if exists "chat members read conversation channel" on realtime.messages;
create policy "chat members read conversation channel" on realtime.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where 'conversation:' || c.id::text = realtime.topic()
      and public.is_chat_participant(c.id)
  ));

drop policy if exists "chat members write conversation channel" on realtime.messages;
create policy "chat members write conversation channel" on realtime.messages
  for insert to authenticated
  with check (exists (
    select 1 from public.conversations c
    where 'conversation:' || c.id::text = realtime.topic()
      and public.is_chat_participant(c.id)
  ));

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0004', 'realtime-private-channel-authorization')
on conflict (version) do nothing;


-- ##########################################################################
-- # 0005_cap-trek-profile-bucket-mime.sql
-- ##########################################################################

-- ============================================================================
-- 0005 — cap trek-profile: close the last bucket that can serve a sniffable
--        Content-Type (STORAGE-002, 2026-08-24 pentest)
-- ============================================================================
-- STORAGE-002: public storage objects are served without
-- `X-Content-Type-Options: nosniff`. Confirmed live 2026-08-25 —
-- `curl -D - .../storage/v1/object/public/avatars/<uid>/<file>.jpeg` returns
-- `content-type: image/jpeg`, `cache-control`, and nothing else. The app's own
-- nosniff header is set in next.config.mjs and covers only the Next.js origin;
-- every image the app renders resolves on dtjmyqogeozrzzbdjokr.supabase.co,
-- which is storage-api behind Cloudflare. There is no header configuration for
-- it, so nosniff CANNOT be added from this repo at all — not from
-- next.config.mjs, not from a migration.
--
-- What IS controllable is what nosniff would be protecting: the Content-Type
-- itself. A browser only sniffs when the declared type is absent, generic
-- (application/octet-stream, text/plain) or unknown; a concrete `image/*` is
-- taken at its word by every current engine, HTML bytes or not. So a bucket
-- with `allowed_mime_types` restricted to real image types can never produce a
-- sniffable response, which is the same end state nosniff would buy.
--
-- §9/§12.7 already set that on avatars, trek-reviews, company-logos and
-- trek-images. trek-profile was deliberately left uncapped (14 legacy objects,
-- no object policies, no client write path — see 0001 §9). That reasoning held
-- for the rate-limit work it was written for, where the question was abuse
-- volume. It does not hold here: an uncapped bucket is the one place a
-- non-image Content-Type could ever be stored, and the exemption also means
-- "every public bucket is capped" is not an invariant anyone can assert. Cap it
-- to match the other four. Its 14 existing objects are already image/jpeg and
-- image/png (verified live over MCP), so nothing in flight breaks; the cap
-- applies to writes, and this bucket has no write path to break.
--
-- Residual risk after this, stated plainly: an authenticated user can still
-- upload HTML bytes while DECLARING image/png, since storage-api validates the
-- declared type and does not inspect the bytes. That object is then served as
-- image/png, which Chrome, Firefox and Safari render as a broken image rather
-- than a document. The remaining exposure is legacy engines that sniff anyway,
-- and it lands on the supabase.co origin, not the app's — no app session
-- cookie is reachable from there. Accepted; see FEATURES.md.

update storage.buckets
set file_size_limit    = 3145728,  -- 3 MiB, same ceiling and rationale as §9
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'trek-profile';

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0005', 'cap-trek-profile-bucket-mime')
on conflict (version) do nothing;


-- ##########################################################################
-- # 0006_scope-storage-select-to-own-prefix.sql
-- ##########################################################################

-- ============================================================================
-- 0006 — scope storage SELECT to the caller's own prefix
--        (public_bucket_allows_listing: avatars, trek-reviews, company-logos,
--         trek-images)
-- ============================================================================
-- §9 and §12.7 gave every bucket a SELECT policy of the shape
-- `using (bucket_id = '<bucket>')` for role `authenticated`. That was written to
-- block ANON listing, and it does. What it does not block is listing by any
-- signed-in user: storage-api's list endpoint is a SELECT over storage.objects,
-- so one account with the publishable key could enumerate every other account's
-- folder — i.e. every user UID, and every filename under it — in all four
-- buckets. The 0001 §10 note calls that deliberate; it is being reversed here.
-- The note's own reasoning is why it is safe to reverse: object URLs do not go
-- through RLS at all. All five buckets are public, so the CDN path
-- (/storage/v1/object/public/...) serves bytes with no session, which is how
-- every image in the app actually resolves — getPublicUrl() builds a string and
-- makes no request. The app has no list(), download() or createSignedUrl() call
-- anywhere (src/, e2e/, supabase/functions/), so nothing reads these buckets
-- through the authenticated path except the upload itself.
--
-- Uploads keep working: upload(..., { upsert: true }) inserts with RETURNING,
-- and RETURNING is checked against the SELECT policy — but every write policy
-- below already confines a writer to the prefix these SELECT policies grant, so
-- a caller can always read back exactly what it was allowed to write.
--
-- Write policies are untouched. Only SELECT changes.

-- ---- avatars ----------------------------------------------------------------
-- Ownership must accept BOTH layouts the write policies accept — avatars/{uid}/file
-- and the legacy flat avatars/{uid}.ext. foldername() drops the last segment, so
-- for a flat name it returns {} and [1] is NULL; a folder-prefix-only policy
-- would leave the 1 flat object live in production outside its own owner's
-- SELECT, and break that owner's next upsert on the RETURNING check.
drop policy if exists "Public can view avatars" on storage.objects;
drop policy if exists "Authenticated users can view avatars" on storage.objects;
drop policy if exists "Authenticated users can view own avatars" on storage.objects;
drop policy if exists "Users can view own avatars" on storage.objects;
create policy "Users can view own avatars" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars'
         and ((storage.foldername(name))[1] = auth.uid()::text
              or name like auth.uid()::text || '.%'));

-- ---- trek-reviews -----------------------------------------------------------
-- Same key layout as avatars minus the flat variant: the write policies only
-- ever accept trek-reviews/{uid}/file, and all 11 live objects match.
drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Authenticated users can view review photos" on storage.objects;
drop policy if exists "Users can view own review photos" on storage.objects;
create policy "Users can view own review photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'trek-reviews'
         and (storage.foldername(name))[1] = auth.uid()::text);

-- ---- company-logos ----------------------------------------------------------
-- Keyed by company_id, so "own prefix" is "a company I belong to".
-- is_company_member, NOT is_company_writable/is_approved_company_member: the
-- status tiers in §16 gate PUBLISHING, and a frozen company's staff still need
-- to see their own branding in the dashboard. Reading back your own file is not
-- the capability those tiers exist to withhold.
drop policy if exists "Authenticated users can view company logos" on storage.objects;
drop policy if exists "Company members can view own logo" on storage.objects;
create policy "Company members can view own logo" on storage.objects
  for select to authenticated
  using (bucket_id = 'company-logos'
         and public.is_company_member(((storage.foldername(name))[1])::uuid));

-- ---- trek-images ------------------------------------------------------------
-- is_company_member for the same reason as company-logos; the approved-only gate
-- stays where it belongs, on insert/update/delete.
drop policy if exists "Authenticated users can view trek images" on storage.objects;
drop policy if exists "Company members can view own trek images" on storage.objects;
create policy "Company members can view own trek images" on storage.objects
  for select to authenticated
  using (bucket_id = 'trek-images'
         and public.is_company_member(((storage.foldername(name))[1])::uuid));

-- ---- trek-profile: nothing to do --------------------------------------------
-- It has no object policies at all, so RLS already denies every authenticated
-- SELECT on it. Its 14 objects are reachable by public URL only, which is the
-- end state this migration puts the other four in.

-- Known edge, stated rather than defended against: the two company buckets cast
-- the first path segment to uuid. A non-uuid FOLDER name there would raise
-- 22P02 on read instead of filtering the row out. Nothing can create one — the
-- insert policies carry the same cast, so an authenticated write with a
-- non-uuid prefix is rejected before the row exists (a flat name yields NULL,
-- not an error, and is simply invisible). Only a service_role write, e.g. a
-- manual dashboard upload into a folder like `temp/`, could introduce one.
-- Live check at time of writing: 0 such objects in either bucket.

-- ============================================================================
-- SUPERSEDES the 0001 §10 advisor note
-- ============================================================================
-- `public_bucket_allows_listing` is no longer accepted for avatars,
-- trek-reviews, company-logos or trek-images. All four now scope SELECT to the
-- caller's own prefix; only trek-profile remains flagged, and it has no SELECT
-- policy to widen. The 0001 text is history and stays as written.

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0006', 'scope-storage-select-to-own-prefix')
on conflict (version) do nothing;


-- ##########################################################################
-- # 0007_drop-dead-trek-email-notification-triggers.sql
-- ##########################################################################

-- ============================================================================
-- 0007 — drop the dead notify_trek_join / notify_trek_remove path
-- ============================================================================
-- `0001` §"notify_trek_join / notify_trek_remove" installed two AFTER triggers
-- on `trek_participants` that `net.http_post` to
-- `/functions/v1/trek-email-notification`. That edge function has never
-- existed: `list_edge_functions` over the read-only MCP (2026-08-25, EDGE-001)
-- returns only `send-trek-notification` and `send-trek-leave-notification`.
-- The pentest's `404` on that slug was an unmatched route, not a broken
-- deployment.
--
-- So every join and every leave has been queuing a pg_net request to a URL that
-- 404s, holding the response in `net._http_response` until pg_net's retention
-- sweeps it. The emails users actually receive come from a different pair of
-- triggers on the same table — `trek-join-notification` /
-- `trek-leave-notification` → `notify_trek_participation()` → the two functions
-- that do exist — which are untouched here.
--
-- Two reasons not to leave this in place as merely inert:
--   * The live function bodies hard-code a legacy anon key (`0001` replaced it
--     with a placeholder rather than reproducing it). That key class is now
--     DISABLED on the project, so the header is a dead credential sitting in a
--     function body — nothing to rotate, but nothing that should stay either.
--   * `notify_trek_join()` has no exception handler, unlike
--     `notify_trek_participation()`, whose `exception when others` comment
--     spells out why a notification must not roll back the transaction. A
--     `net.http_post` that raises here — pg_net absent after a restore, its
--     queue table unavailable — aborts the enclosing INSERT, i.e. fails the
--     join itself. It has not fired, but the shape is wrong.
--
-- Triggers first, then the functions they reference.
drop trigger if exists trek_join_email_trigger on public.trek_participants;
drop trigger if exists trek_remove_email_trigger on public.trek_participants;

drop function if exists public.notify_trek_join();
drop function if exists public.notify_trek_remove();

-- ============================================================================
-- SUPERSEDES the 0001 note on these two functions
-- ============================================================================
-- `0001`'s "these are effectively redundant/dead" is resolved rather than
-- restated: the path is gone. `notify_trek_participation()` and its
-- `trek-join-notification` / `trek-leave-notification` triggers remain the only
-- notification path on `trek_participants`. The `0001` text is history and
-- stays as written.

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0007', 'drop-dead-trek-email-notification-triggers')
on conflict (version) do nothing;


-- ##########################################################################
-- # 0008_drop-embedded-publishable-key-from-notification-trigger.sql
-- ##########################################################################

-- ============================================================================
-- 0008 — drop the embedded publishable key from notify_trek_participation()
-- ============================================================================
-- `0001` §notify_trek_participation embeds the project's publishable key as a
-- literal in the function body and sends it on `apikey`, with an inline comment
-- telling whoever rotates the key to come back and edit the DDL. Nothing
-- enforces that. The key is public by design (it ships in the browser bundle),
-- so this was never a disclosure — it is a rotation trap: the day the key is
-- rotated the literal becomes a *wrong* key, and a wrong key is strictly worse
-- than none (see below). The trigger swallows every error, so the failure mode
-- is silent — joins and leaves keep working and the emails just stop.
--
-- The premise behind the header was wrong. `0001`'s comment says the key "rides
-- on `apikey` only for gateway routing"; measured against the live project
-- (2026-08-26), routing does not need it. Both notification functions run
-- `verify_jwt=false`, and the Supabase gateway only validates an `apikey` when
-- one is present:
--
--   no apikey     -> 401 from the FUNCTION (x-served-by: supabase-edge-runtime,
--                    x-deno-execution-id present) — the request reached the
--                    function and its own x-trek-webhook-secret check rejected it
--   valid apikey  -> same: reaches the function, same 401
--   invalid apikey-> 401 {"message":"Invalid API key"} from the GATEWAY, no
--                    execution-id header — the function never runs
--
-- So the header buys nothing and costs a silent outage on rotation. Dropping it
-- leaves no key material of any kind in DDL and nothing to keep in sync.
--
-- Authorization is unchanged and was never the `apikey`: it is the shared secret
-- read from Vault (`edge_function_token`) and sent on `x-trek-webhook-secret`,
-- which both functions compare in constant time. Everything else about the
-- function — SECURITY DEFINER (to read `vault.decrypted_secrets`), the pinned
-- search_path, the skip-when-no-secret branch, and the `exception when others`
-- that keeps a failed notification from rolling back a join or leave — is
-- carried over verbatim.
create or replace function public.notify_trek_participation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
  v_base   text := 'https://dtjmyqogeozrzzbdjokr.supabase.co/functions/v1/';
  v_url    text;
  v_body   jsonb;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'edge_function_token'
  limit 1;

  if v_secret is null or length(btrim(v_secret)) = 0 then
    return coalesce(new, old);   -- no secret yet -> skip, never block join/leave
  end if;

  if tg_op = 'INSERT' then
    v_url  := v_base || 'send-trek-notification';
    v_body := jsonb_build_object(
      'type','INSERT','table','trek_participants','schema','public',
      'record', to_jsonb(new), 'old_record', null
    );
  elsif tg_op = 'DELETE' then
    v_url  := v_base || 'send-trek-leave-notification';
    v_body := jsonb_build_object(
      'type','DELETE','table','trek_participants','schema','public',
      'record', null, 'old_record', to_jsonb(old)
    );
  else
    return coalesce(new, old);
  end if;

  -- No `apikey` header on purpose: the gateway routes verify_jwt=false
  -- functions without one, and a stale literal here would 401 at the gateway
  -- and be swallowed by the handler below. Do not re-add one.
  perform net.http_post(
    url := v_url,
    body := v_body,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-trek-webhook-secret', v_secret   -- the only credential; authorizes inside the fn
    ),
    timeout_milliseconds := 5000
  );

  return coalesce(new, old);
exception when others then
  return coalesce(new, old);     -- notification failure must not roll back the tx
end;
$$;

-- `create or replace` preserves the ACL, and this function is reached only as a
-- trigger (Postgres checks EXECUTE at CREATE TRIGGER time, not at fire time), so
-- there is nothing to re-grant. The `trek-join-notification` /
-- `trek-leave-notification` triggers on `trek_participants` are untouched and
-- pick up the new body on their next fire.

-- ============================================================================
-- SUPERSEDES the 0001 note on notify_trek_participation
-- ============================================================================
-- `0001`'s "the PUBLIC publishable key rides on `apikey` only for gateway
-- routing" and the two inline "routing only" comments no longer describe the
-- function. The `0001` text is history and stays as written.

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0008', 'drop-embedded-publishable-key-from-notification-trigger')
on conflict (version) do nothing;
