-- ============================================================================
-- Phase F — Account types (trekker vs company)
-- ============================================================================
-- Splits the single account model in two. Until now every auth user was a full
-- trekker and "being a company" was an add-on (a company_members row), so a
-- company owner could also join treks, favourite, chat and review. This phase
-- makes the distinction explicit and enforces it in Postgres, which is the only
-- boundary that holds — the app talks to Supabase with the publishable key, so
-- route guards and hidden buttons are UX, not security.
--
-- Rules established here:
--   * profiles.account_type is 'trekker' or 'company', set at signup.
--   * It is immutable to clients (BEFORE UPDATE pin, platform admins exempt).
--   * Company accounts cannot join treks or favourite them.
--   * Only company accounts can apply to become a company.
--   * Platform admins are exempt from every restriction above (is_trekker()).
--
-- Reviews need no rule of their own: "Users can review treks they joined"
-- already requires participation, so blocking joins blocks reviews with it.
-- conversation_participants INSERT is service_role-only, so chat has no client
-- bypass either.
--
-- RUN ORDER MATTERS: the backfill (§2) must run before the pin trigger (§3),
-- otherwise the trigger reverts it.
-- ============================================================================


-- ---- 1. Enum + column -------------------------------------------------------
-- Default 'trekker' so every existing row (and any signup that predates the
-- app-side toggle) lands on the unrestricted side.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_type') then
    create type public.account_type as enum ('trekker', 'company');
  end if;
end
$$;

alter table public.profiles
  add column if not exists account_type public.account_type not null default 'trekker';

comment on column public.profiles.account_type is
  'Trekker vs trek-company account. Set at signup from raw_user_meta_data, then '
  'immutable to clients (trg_protect_profile_account_type). Company accounts '
  'cannot join/favourite treks; see is_trekker().';


-- ---- 2. Backfill ------------------------------------------------------------
-- Anyone who already belongs to a company becomes a company account. Platform
-- admins are NOT skipped here — the data should reflect reality; their
-- exemption lives in is_trekker() instead, as one documented rule rather than
-- two half-rules.

update public.profiles p
set account_type = 'company'
where p.account_type <> 'company'
  and exists (
    select 1 from public.company_members cm where cm.user_id = p.id
  );


-- ---- 3. is_trekker() — the single source of truth ---------------------------
-- Mirrors is_platform_admin(): no-arg, SECURITY DEFINER, pinned search_path.
-- DEFINER because RLS policies on other tables call it and profiles is
-- own-row-only; INVOKER would work for the caller's own row but breaks the
-- moment this is reused anywhere else. Returns false when signed out.
--
-- The `or is_platform_admin()` is the admin exemption: a platform admin keeps
-- full trekker access even while owning a company, so the trekker flows stay
-- testable from the admin account.

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


-- ---- 4. Pin account_type against self-edit ----------------------------------
-- Same shape as protect_company_admin_fields: RLS WITH CHECK cannot compare NEW
-- against OLD, so a BEFORE UPDATE trigger is the way to make a column immutable.
-- "Users can update own profile" would otherwise let any company account demote
-- itself to 'trekker' with a one-line PATCH and walk straight past every rule
-- below.
--
-- Two escape hatches, both deliberate:
--   * auth.uid() is null  → no client session, i.e. the SQL Editor or another
--     trusted server-side context. Without this the pin would silently swallow
--     manual corrections (auth.uid() is NULL in the SQL Editor, so a
--     platform-admin-only check would evaluate FALSE there and revert the very
--     UPDATE meant to fix a row). The profiles UPDATE policy is `to
--     authenticated`, so no client can reach this branch.
--   * platform admins, matching protect_company_admin_fields.
--
-- Phase 4 of the split (invite → accept, which converts a trekker to a company
-- account) needs an invitee-initiated path; that RPC will extend this trigger,
-- it must not work around it.

create or replace function public.protect_profile_account_type()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
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


-- ---- 5. handle_new_user — set account_type at signup ------------------------
-- raw_user_meta_data is client-supplied, which is fine in this one direction:
-- choosing to sign up as a company is self-service (the company itself still
-- needs platform-admin approval), and the value is read exactly once at INSERT.
-- Anything other than the literal 'company' falls back to 'trekker', so a
-- malformed or absent claim can only ever produce the unrestricted default.
-- The escalation that would matter — company → trekker later — is blocked by §4.
--
-- UNCHANGED from the current definition apart from the account_type column.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, account_type)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    case
      when new.raw_user_meta_data->>'account_type' = 'company'
        then 'company'::public.account_type
      else 'trekker'::public.account_type
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- ---- 6. join_trek_and_chat — refuse company accounts ------------------------
-- The RPC is the app's only join path, so this is the guard that actually
-- matters; the RLS policy in §7 is defence in depth for a hand-crafted request.
-- The check sits immediately after the caller-identity checks and before any
-- write, so a blocked join creates no batch and no conversation.
--
-- UNCHANGED from the current definition apart from that one block.

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

  -- Company accounts sell treks, they don't book them.
  if not public.is_trekker() then
    raise exception 'Company accounts cannot join treks';
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


-- ---- 7. RLS — trekker-only writes -------------------------------------------
-- Both policies keep their existing self-only check and add is_trekker(). The
-- trek_participants one closes the direct-insert path the RPC guard can't see;
-- favourites has no RPC at all, so this IS its enforcement.

drop policy if exists "Users can join treks" on public.trek_participants;
create policy "Users can join treks" on public.trek_participants for insert to authenticated
  with check (auth.uid() = user_id and public.is_trekker());

drop policy if exists "Users can favorite treks" on public.favorites;
create policy "Users can favorite treks" on public.favorites for insert to authenticated
  with check (auth.uid() = user_id and public.is_trekker());


-- ---- 8. apply_for_company — company accounts only ---------------------------
-- The inverse restriction: a trekker account can no longer turn itself into a
-- company mid-life. Companies are created by signing up as one.
--
-- The message is deliberately phrased for the UI — src/lib/company.ts only
-- surfaces raise text it recognises, so this string must be added to
-- KNOWN_APPLY_ERRORS when the app side of the split lands (until then users see
-- the generic fallback).
--
-- UNCHANGED from the current definition apart from that one block.

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

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.account_type = 'company'
  ) then
    raise exception 'Only company accounts can apply. Sign up as a trek company instead.';
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


-- ============================================================================
-- VERIFY
-- ============================================================================
-- Structural checks alone are NOT sufficient here — the storage rate-limit
-- phase passed every catalogue check while being completely inert, because
-- auth.uid() resolved differently at runtime than assumed. This phase depends
-- on auth.uid() in exactly the same way (is_trekker, the pin trigger), so run
-- the behavioural block too.
--
-- >> The behavioural block below is filled in and ready to run, with real
-- >> non-admin UIDs and a positive control beside each negative, in
-- >> supabase/phases/verify-phase-f.sql — prefer that file. Run it there.

-- ---- Structural -------------------------------------------------------------
-- select column_name, data_type, column_default, is_nullable
--   from information_schema.columns
--  where table_schema='public' and table_name='profiles' and column_name='account_type';
--   -- expect: USER-DEFINED, 'trekker'::account_type, NO
--
-- select tgname, tgenabled from pg_trigger
--  where tgrelid='public.profiles'::regclass and tgname='trg_protect_profile_account_type';
--   -- expect: 1 row, tgenabled='O'
--
-- select proname, prosecdef, proconfig from pg_proc
--  where pronamespace='public'::regnamespace and proname in ('is_trekker','protect_profile_account_type');
--   -- expect: both prosecdef=t, proconfig={search_path=public, pg_temp}
--
-- select polname, pg_get_expr(polwithcheck, polrelid) from pg_policy
--  where polname in ('Users can join treks','Users can favorite treks');
--   -- expect: both WITH CHECK expressions mention is_trekker()
--
-- select has_function_privilege('anon','public.is_trekker()','execute');           -- f
-- select has_function_privilege('authenticated','public.is_trekker()','execute');  -- t
--
-- select account_type, count(*) from public.profiles group by 1;
--   -- expect: company count == distinct users in company_members
-- select count(*) from public.company_members cm
--   join public.profiles p on p.id=cm.user_id where p.account_type <> 'company';   -- 0

-- ---- Behavioural (impersonate a real user; rolls back) ----------------------
-- Replace :company_uid with a profiles.id where account_type='company' and that
-- is NOT in platform_admins — an admin passes every check by design and will
-- give a false PASS. Same for :trekker_uid / :trek_uid.
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<company_uid>","role":"authenticated"}';
--
--   select public.is_trekker();                                    -- expect f
--
--   update public.profiles set account_type='trekker' where id='<company_uid>';
--   select account_type from public.profiles where id='<company_uid>';  -- expect company (pin held)
--
--   insert into public.favorites (user_id, trek_id)
--     values ('<company_uid>','<trek_uid>');
--     -- expect: ERROR new row violates row-level security policy
-- rollback;
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<company_uid>","role":"authenticated"}';
--   select public.join_trek_and_chat('<company_uid>','<trek_uid>', current_date + 7);
--     -- expect: ERROR Company accounts cannot join treks
-- rollback;
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<trekker_uid>","role":"authenticated"}';
--   select public.is_trekker();                                    -- expect t
-- rollback;
--
-- Each block must be run on its own: the first error aborts the transaction.
