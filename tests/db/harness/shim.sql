-- Supabase-provided objects that schema.sql assumes already exist.
--
-- schema.sql is a dump of OUR objects only; it never creates auth.users,
-- storage.objects, the anon/authenticated roles, or the default grants that
-- make those roles able to reach public tables at all. On a real project the
-- Supabase platform provisions them. In PGlite we provision them here, and the
-- fidelity of these definitions is the fidelity of the whole suite.
--
-- Rule for editing this file: copy Supabase's real definitions. Do not invent
-- a convenient one. A shim that is more permissive than production makes a
-- test pass that should fail.

-- ---- Roles --------------------------------------------------------------------
-- NOBYPASSRLS is the whole point: PGlite connects as a superuser, and
-- superusers ignore RLS entirely. Every assertion in this suite is only
-- meaningful because it runs under SET ROLE to one of these.
create role anon          nologin noinherit nobypassrls;
create role authenticated nologin noinherit nobypassrls;
create role service_role  nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants blanket table DML to anon/authenticated and relies on RLS to
-- narrow it. Without this, a denied read would fail with "permission denied for
-- table" and we would be testing the grant, not the policy.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

-- Functions too, and the DIRECT grant to each role matters — it is not just
-- belt-and-braces over Postgres's implicit PUBLIC grant. Verified against
-- production: the enforce_*_rate_limit triggers are revoked `from public, anon`
-- with no paired grant, yet authenticated still holds EXECUTE on them live.
-- That is only possible if authenticated holds a direct grant. It also explains
-- why every revoke in schema.sql names `anon` explicitly rather than relying on
-- `from public` — anon holds a direct grant too, and would otherwise keep it.
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- ---- auth ---------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id                uuid primary key default gen_random_uuid(),
  email             text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

-- Verbatim from Supabase. auth.uid() reads the request-scoped GUC that
-- PostgREST sets from the verified JWT; tests set the same GUC (see actor.ts),
-- so policies cannot tell the difference between a test and a real request.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

grant execute on function auth.uid(), auth.role(), auth.email()
  to anon, authenticated, service_role;

-- ---- storage ------------------------------------------------------------------
-- Only the surface schema.sql touches: buckets, objects, foldername().
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  owner              uuid,
  file_size_limit    bigint,
  allowed_mime_types text[],
  avif_autodetection boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets(id),
  name        text,
  owner       uuid,
  -- storage-api stamps a new `version` per real upload; §13.4's rate-limit
  -- trigger reads new.version to tell an upload from a rename. PL/pgSQL plans
  -- that expression when the statement is reached, not when the branch is
  -- taken, so without this column EVERY insert into storage.objects fails with
  -- `record "new" has no field "version"` — the trigger's tg_op guard does not
  -- save it.
  version     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  metadata    jsonb
);
alter table storage.objects enable row level security;

-- Supabase's real implementation: split the object key on '/' so policies can
-- test foldername(name)[1] = auth.uid()::text, i.e. the "{uid}/file" convention.
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end
$$;

grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- ---- realtime -------------------------------------------------------------------
-- Only the surface 0004 touches: the messages table private channels are
-- authorized against, and the topic() helper Realtime sets per-message from
-- the connected websocket's current channel. Real column set per Supabase's
-- realtime extension (partitioned on inserted_at in production; a plain table
-- here since PGlite tests never insert enough rows to care).
create schema if not exists realtime;
grant usage on schema realtime to anon, authenticated, service_role;

create table realtime.messages (
  id           uuid primary key default gen_random_uuid(),
  topic        text not null,
  extension    text not null,
  payload      jsonb,
  event        text,
  private      boolean not null default false,
  inserted_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

grant select, insert on realtime.messages to anon, authenticated, service_role;

-- Production sets this GUC from the client's channel name on every message;
-- tests set it the same way (see chat.test.ts) so a policy cannot tell the
-- difference.
create or replace function realtime.topic() returns text
language sql stable
as $$
  select nullif(current_setting('realtime.topic', true), '')::text
$$;

grant execute on function realtime.topic() to anon, authenticated, service_role;

-- ---- pg_net -------------------------------------------------------------------
-- The notify_trek_* triggers fire net.http_post() on participant writes. We do
-- not want real HTTP from a test, but we do want the call to be reached, since
-- a trigger that throws would roll back the write under test. Record the calls
-- into a table so a test can assert a webhook WOULD have fired.
create schema if not exists net;

create table net.sent (
  id                  bigserial primary key,
  url                 text,
  body                jsonb,
  headers             jsonb,
  timeout_milliseconds int,
  at                  timestamptz not null default now()
);

create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds int default 5000
) returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into net.sent (url, body, headers, timeout_milliseconds)
  values (url, body, headers, timeout_milliseconds)
  returning id into v_id;
  return v_id;
end
$$;

-- ---- pg_cron ------------------------------------------------------------------
-- Scheduling is not under test; these exist so schema.sql's §13.5 block parses
-- and runs instead of aborting the load.
create schema if not exists cron;

create table cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text,
  command  text
);

create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint
language sql
as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid;
$$;

create or replace function cron.unschedule(job_name text) returns boolean
language sql
as $$ delete from cron.job where jobname = job_name returning true; $$;
