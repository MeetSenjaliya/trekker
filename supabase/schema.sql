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
  participants_joined smallint
);

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
create table if not exists public.trek_participants (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid references public.profiles(id),
  batch_id  uuid references public.trek_batches(id),
  joined_at timestamptz default now(),
  constraint trek_participants_user_batch_key unique (user_id, batch_id)
);

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

-- user_stats — aggregate per user (currently not actively maintained by app).
create table if not exists public.user_stats (
  user_id          uuid primary key references public.profiles(id),
  treks_completed  integer default 0 check (treks_completed >= 0),
  treks_organised  integer default 0 check (treks_organised >= 0),
  total_distance_km numeric default 0 check (total_distance_km >= 0),
  avg_rating       numeric default 0 check (avg_rating >= 0 and avg_rating <= 5),
  last_updated     timestamptz default now()
);

-- user_monthly_activity — per-user per-month counters. `month` must be day 1.
create table if not exists public.user_monthly_activity (
  user_id         uuid not null references public.profiles(id),
  month           date not null check (extract(day from month) = 1),
  treks_joined    integer default 0,
  photos_shared   integer default 0,
  reviews_written integer default 0,
  distance_km     numeric default 0,
  primary key (user_id, month)
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
-- trek participant and the chat participant, returns their ids.
-- HARDENED (DoS fix): requires p_user_id = auth.uid() (no NULL bypass) and
-- validates p_batch_date (not past, within a 1-year window) so a user cannot
-- mass-create trek_batches/conversations over unbounded future dates. Long-term
-- batch creation should be split out of the join path (admin-created batches).
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

  select title into v_trek_title from public.treks where id = p_trek_id;
  if v_trek_title is null then
    raise exception 'Trek not found';
  end if;

  insert into public.trek_batches (trek_id, batch_date)
  values (p_trek_id, p_batch_date)
  on conflict (trek_id, batch_date) do nothing
  returning id into v_batch_id;
  if v_batch_id is null then
    select id into v_batch_id from public.trek_batches
    where trek_id = p_trek_id and batch_date = p_batch_date limit 1;
  end if;

  insert into public.conversations (batch_id, name)
  values (v_batch_id, (v_trek_title || ' — ' || p_batch_date::text))
  on conflict (batch_id) do nothing
  returning id into v_convo_id;
  if v_convo_id is null then
    select id into v_convo_id from public.conversations
    where batch_id = v_batch_id limit 1;
  end if;

  insert into public.trek_participants (user_id, batch_id)
  values (v_uid, v_batch_id)
  on conflict (user_id, batch_id) do nothing
  returning id into v_participant_id;
  if v_participant_id is null then
    select id into v_participant_id from public.trek_participants
    where user_id = v_uid and batch_id = v_batch_id limit 1;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_convo_id, v_uid)
  on conflict (conversation_id, user_id) do nothing;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'participant_id', v_participant_id,
    'conversation_id', v_convo_id
  );
end;
$$;

-- get_trek_participant_count — count of participants across a trek's batches.
-- Plain SQL, SECURITY INVOKER, pinned search_path. Used by the app to show
-- participant counts (bypasses the own-row RLS on trek_participants? No —
-- INVOKER respects RLS; counts work because it is called for the caller).
create or replace function public.get_trek_participant_count(trek_uuid uuid)
returns integer
language sql
set search_path = public, pg_temp
as $$
  select count(tp.id)
  from public.trek_participants tp
  join public.trek_batches tb on tb.id = tp.batch_id
  where tb.trek_id = trek_uuid;
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

-- Lock down trigger-only SECURITY DEFINER functions: they fire as triggers and
-- must NOT be callable via /rest/v1/rpc. Revoke from PUBLIC (anon/authenticated
-- inherit EXECUTE through it; revoking only those two is a no-op). Triggers
-- still fire; the owner keeps EXECUTE. join_trek_and_chat / is_chat_participant
-- / increment_participants stay callable (app RPC + RLS policies use them).
revoke execute on function public.handle_new_user()           from public, anon, authenticated;
revoke execute on function public.notify_trek_participation() from public, anon, authenticated;
revoke execute on function public.update_participants_count() from public, anon, authenticated;


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

-- ---- user_stats (own rows) --------------------------------------------------
drop policy if exists "Users can view own stats" on public.user_stats;
create policy "Users can view own stats" on public.user_stats for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert their own stats record" on public.user_stats;
create policy "Users can insert their own stats record" on public.user_stats for insert to public with check (auth.uid() = user_id);
drop policy if exists "Users can update their own stats" on public.user_stats;
create policy "Users can update their own stats" on public.user_stats for update to public using (auth.uid() = user_id);

-- ---- user_monthly_activity (own rows) ---------------------------------------
drop policy if exists "Users can view their own activity" on public.user_monthly_activity;
create policy "Users can view their own activity" on public.user_monthly_activity for select to public using (auth.uid() = user_id);
drop policy if exists "Users can insert their own monthly record" on public.user_monthly_activity;
create policy "Users can insert their own monthly record" on public.user_monthly_activity for insert to public with check (auth.uid() = user_id);
drop policy if exists "Users can update their own activity" on public.user_monthly_activity;
create policy "Users can update their own activity" on public.user_monthly_activity for update to public using (auth.uid() = user_id);


-- ============================================================================
-- 9. STORAGE — buckets + object policies
-- ============================================================================
insert into storage.buckets (id, name, public) values ('avatars',      'avatars',      true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('trek-reviews', 'trek-reviews', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('trek-profile', 'trek-profile', true) on conflict (id) do nothing;
-- NOTE: bucket `trek-profile` is public but has NO object policies (no client
-- write path; objects are reachable only via public URL). Likely unused.

-- ---- avatars: public read, owner-scoped writes ------------------------------
-- Ownership accepts both layouts: avatars/{uid}/file AND avatars/{uid}.ext
drop policy if exists "Public can view avatars" on storage.objects;
create policy "Public can view avatars" on storage.objects for select to public using (bucket_id = 'avatars');

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

-- ---- trek-reviews: public read, owner-scoped insert/delete (no update) ------
drop policy if exists "Public Access" on storage.objects;
create policy "Public Access" on storage.objects for select to public using (bucket_id = 'trek-reviews');

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
