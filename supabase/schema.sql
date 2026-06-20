-- ============================================================================
-- TREKKER — AUTHORITATIVE DATABASE SCHEMA (source of truth)
-- ============================================================================
-- This file mirrors the LIVE Supabase database (project dtjmyqogeozrzzbdjokr)
-- as introspected on 2026-06-13: tables, constraints, enums, views, functions,
-- triggers, RLS policies (public + storage), and storage buckets.
--
-- It SUPERSEDES the older fragmented files that used to live in this folder
-- (policies.sql, profiles-rls-policies.sql, multi-photo-setup.sql, fix-rls.sql,
-- storage-setup.sql, supabase-storage-policies.sql, supabase-schema.sql,
-- seed-chat-data.sql). Security hardening rationale lives in security-fixes.sql
-- and SECURITY_AUDIT_ISSUE.md; this file captures the resulting end state.
--
-- Ordering is dependency-safe so it can be run top-to-bottom on a fresh project.
-- Statements are idempotent where practical (IF NOT EXISTS / OR REPLACE /
-- DROP POLICY IF EXISTS). Known bugs in the live DB are reproduced here and
-- flagged with "BUG:" comments rather than silently fixed — see DATABASE.md.
-- ============================================================================


-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_net";          -- used by notify_trek_* functions
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

-- NOTE: the `mood` enum exists in the live DB ('Biginer','intermediate','expert')
-- but is not used by any column. Kept for parity; safe to drop.
do $$ begin
  create type public.mood as enum ('Biginer', 'intermediate', 'expert');
exception when duplicate_object then null; end $$;


-- ============================================================================
-- 3. TABLES
-- ============================================================================

-- profiles — 1:1 with auth.users. Holds PII (email/phone/emergency/age/Gender).
-- Public reads go through the public_profiles view, NOT this table (see RLS).
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id),
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

-- treks — the catalogue. Publicly readable. No owner column.
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
  trek_id          uuid not null references public.treks(id),
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
  batch_id  uuid references public.trek_batches(id),
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
  trek_id    uuid references public.treks(id),
  user_id    uuid references public.profiles(id),
  rating     integer check (rating >= 1 and rating <= 5),
  comment    text,
  created_at timestamptz default now(),
  photo_urls text[] default '{}'::text[],
  trek_date  date,
  constraint trek_reviews_trek_id_user_id_key unique (trek_id, user_id)
);

-- favorites — user ⇔ trek wishlist. No surrogate PK; uniqueness on (user,trek).
create table if not exists public.favorites (
  user_id    uuid not null references public.profiles(id),
  trek_id    uuid references public.treks(id),
  created_at timestamptz default now(),
  constraint favorites_user_id_trek_id_key unique (user_id, trek_id)
);

-- conversations — one per trek batch (batch_id is UNIQUE).
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  batch_id   uuid unique references public.trek_batches(id),
  name       text,
  created_at timestamptz default now()
);

-- conversation_participants — chat membership. Uniqueness on (conversation,user).
create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id),
  user_id         uuid not null references public.profiles(id),
  joined_at       timestamptz default now(),
  constraint conversation_participants_conv_user_key unique (conversation_id, user_id)
);

-- conversation_messages — chat messages. Composite PK (created_at, id).
-- Supports soft-delete, reply threading, and emoji reactions (jsonb).
create table if not exists public.conversation_messages (
  conversation_id uuid not null references public.conversations(id),
  user_id         uuid not null references public.profiles(id),
  message         text not null,
  created_at      timestamptz not null default now(),
  id              uuid not null default gen_random_uuid(),
  updated_at      timestamptz,
  is_deleted      boolean default false,
  reply_to        uuid,
  reactions       jsonb default '{}'::jsonb,
  primary key (created_at, id)
);

-- user_stats — aggregate per user. System-managed; rebuilt from source by
-- recompute_user_stats() (triggers + daily pg_cron). treks_organised has no
-- data source yet (no organiser column) and stays 0. avg_rating was dropped.
create table if not exists public.user_stats (
  user_id          uuid primary key references public.profiles(id),
  treks_completed  integer default 0 check (treks_completed >= 0),
  treks_organised  integer default 0 check (treks_organised >= 0),
  total_distance_km numeric default 0 check (total_distance_km >= 0),
  last_updated     timestamptz default now()
);

-- user_monthly_activity — per-user per-month counters. `month` must be day 1.
create table if not exists public.user_monthly_activity (
  user_id         uuid not null references public.profiles(id),
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
      and joined_at <= (select joined_at from public.trek_participants where id = v_participant_id);
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
  p_offset       int     default 0
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
  total_count         bigint
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_str     text;
  v_tsquery tsquery := null;
begin
  -- Build a prefix tsquery: "base camp" -> 'base:* & camp:*'. Strip anything
  -- that isn't a letter/digit/space so user input can't break to_tsquery.
  if p_search is not null and length(trim(p_search)) > 0 then
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
      case when v_tsquery is not null then ts_rank(t.fts, v_tsquery) else 0 end as rank
    from public.treks t
    left join lateral (
      select min(b.batch_date) as next_batch_date
      from public.trek_batches b
      where b.trek_id = t.id
        and b.batch_date >= coalesce(p_date_from, current_date)
    ) nb on true
    -- Real ratings rollup: average of trek_reviews.rating (null when no reviews,
    -- so the card's rating badge hides). Replaces the static treks.rating column.
    left join lateral (
      select round(avg(r.rating), 1) as avg_rating
      from public.trek_reviews r
      where r.trek_id = t.id
    ) rr on true
    where
      (v_tsquery     is null or t.fts @@ v_tsquery)
      and (p_location     is null or t.location ilike '%' || p_location || '%')
      and (p_difficulty   is null or t.difficulty::text = p_difficulty)
      and (p_min_distance is null or t.distance_km    >= p_min_distance)
      and (p_max_distance is null or t.distance_km    <= p_max_distance)
      and (p_min_price    is null or t.estimated_cost >= p_min_price)
      and (p_max_price    is null or t.estimated_cost <= p_max_price)
      and (p_date_from    is null or nb.next_batch_date is not null)
  )
  select
    f.id, f.title, f.description, f.location, f.cover_image_url, f.difficulty,
    f.distance_km, f.duration_hours, f.max_participants, f.estimated_cost,
    f.rating, f.participants_joined, f.next_batch_date,
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
  text, text, text, numeric, numeric, numeric, numeric, date, text, int, int
) to anon, authenticated;

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
  where tp.user_id = p_user_id;

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

-- BUG: create_trek_initial_message inserts into `trek_messages`, a table that
-- does NOT exist. Its trigger (trg_initial_trek_message) fires AFTER INSERT on
-- treks, so creating a trek via SQL/PostgREST currently ERRORS. Left as-is to
-- match live; fix by dropping the trigger or rewriting to use conversation_*.
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

-- increment_participants — backing for the legacy src/lib/database.ts join path
-- (NEW-5). Despite the name it RECOMPUTES the exact count (idempotent) instead
-- of blindly +1, so it stays consistent with the trigger below no matter how it
-- is called. Resolves the count via the batch -> trek join (trek_participants is
-- keyed by batch_id). SECURITY DEFINER so the write to treks is not blocked by
-- RLS (treks has no UPDATE policy for regular users).
create or replace function public.increment_participants(trek_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.treks t
  set participants_joined = (
    select count(*)
    from public.trek_participants tp
    join public.trek_batches tb on tb.id = tp.batch_id
    where tb.trek_id = increment_participants.trek_id
  )
  where t.id = increment_participants.trek_id;
$$;

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

-- BUG (see function note): fires the broken trek_messages insert on trek create.
drop trigger if exists trg_initial_trek_message on public.treks;
create trigger trg_initial_trek_message
  after insert on public.treks
  for each row execute function public.create_trek_initial_message();

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
-- stay callable (app RPC + RLS policies use them). increment_participants is
-- revoked too — the trek_participants_count_trigger makes it redundant.
revoke execute on function public.handle_new_user()           from public, anon, authenticated;
revoke execute on function public.notify_trek_participation() from public, anon, authenticated;
revoke execute on function public.update_participants_count() from public, anon, authenticated;
revoke execute on function public.promote_waitlist_on_leave()  from public, anon, authenticated;
revoke execute on function public.increment_participants(uuid) from public, anon, authenticated;
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

-- ---- treks (public read) ----------------------------------------------------
drop policy if exists "view all treks" on public.treks;
create policy "view all treks" on public.treks for select to public using (true);

-- ---- trek_batches (public read; writes only via SECURITY DEFINER RPC) --------
drop policy if exists "Anyone can view trek batches" on public.trek_batches;
create policy "Anyone can view trek batches" on public.trek_batches for select to public using (true);

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
drop policy if exists "Send messages" on public.conversation_messages;
create policy "Send messages" on public.conversation_messages for insert to public with check (user_id = auth.uid() and public.is_chat_participant(conversation_id));
drop policy if exists "Edit own messages" on public.conversation_messages;
create policy "Edit own messages" on public.conversation_messages for update to public using (user_id = auth.uid()) with check (user_id = auth.uid());
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
-- write path; objects are reachable only via public URL). Likely unused.

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
-- * security_definer_view: public_profiles (intentional; documented above).
-- * public_bucket_allows_listing: avatars, trek-reviews (broad SELECT allows
--   listing; object URLs don't need it — consider narrowing).
-- * anon/authenticated can EXECUTE handle_new_user / is_chat_participant /
--   join_trek_and_chat via /rest/v1/rpc. handle_new_user is a trigger fn and
--   should have EXECUTE revoked from anon, authenticated.
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
