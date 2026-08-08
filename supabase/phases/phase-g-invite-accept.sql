-- ============================================================================
-- Phase G — Invite → accept (consent before conversion)
-- ============================================================================
-- Phase F split accounts into 'trekker' and 'company' and pinned the column so
-- nobody can change their own side of the split. That left one gap: a trekker
-- who genuinely wants to join a company team has no way across. This phase
-- builds that path — and it builds it as a CONSENT step, not a convenience.
--
-- Why consent is the whole point. Today invite_company_member() inserts
-- straight into company_members and answers "Teammate added". Bolt conversion
-- onto that and any company admin destroys a trekker's account by typing their
-- email: no more bookings, no more trek chats, no more favouriting, and the
-- profile is pinned on the far side so they can't walk back. Nothing about that
-- may happen without the person clicking a button that spells out the cost.
--
-- What conversion actually costs (this is what the UI must say, accurately):
-- nothing is deleted. account_type flips to 'company', and from that moment RLS
-- refuses new joins/favourites and the (trekker) route group bounces them to
-- /dashboard. Existing bookings, favourites, chats and reviews stay in the
-- database, unreachable through the app. Only a platform admin can flip it back.
--
-- THE BYPASS THIS PHASE CLOSES. The company_members INSERT policy was
--   with check (is_company_admin(company_id) and role = 'staff')
-- with no constraint on user_id. The publishable key ships in the client
-- bundle, so any company admin could POST /rest/v1/company_members with an
-- arbitrary user_id and skip the RPC entirely. Today that adds an unwanted
-- member. After this phase it would silently convert a stranger's account with
-- no invite and no consent — the consent gate is decorative while that policy
-- exists. It is dropped in §9, leaving the SECURITY DEFINER RPCs as the only
-- write path (apply_for_company already creates the owner row that way).
-- Verified before dropping: no app code inserts into company_members directly.
--
-- RUN ORDER MATTERS: §8 (trigger escape hatch) must be applied before anyone
-- calls accept_company_invite(), or the account_type flip is silently reverted
-- by the pin and the invitee ends up a member with a trekker account.
-- ============================================================================


-- ---- 1. company_invites -----------------------------------------------------
-- No token column and no email delivery, on purpose. invite_company_member()
-- already requires the invitee to have a Trekker account (it resolves them in
-- profiles by email), so the invite can simply be shown to them when they sign
-- in — get_my_invites() in §4. The edge functions this project has are trek
-- notifications, not transactional mail; inventing that pipeline is a bigger
-- change than this phase needs. Inviting people who have no account yet is the
-- point at which a hashed token + a mail step become worth adding.
--
-- email is stored lowercased+trimmed by the RPC; every lookup lowercases too,
-- so a typo'd case can't create a second live invite.

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

comment on table public.company_invites is
  'Pending consent step between a company admin inviting someone and that person '
  'joining the team. Accepting converts a trekker account to a company account '
  '(accept_company_invite), which is why the invite exists at all.';

-- One live invite per (company, email). Partial so the history of accepted /
-- declined / revoked invites doesn't block re-inviting the same person.
create unique index if not exists company_invites_pending_key
  on public.company_invites (company_id, lower(email))
  where status = 'pending';

-- get_my_invites() looks up by the caller's email across all companies.
create index if not exists company_invites_email_idx
  on public.company_invites (lower(email))
  where status = 'pending';


-- ---- 2. RLS — read for the company, writes RPC-only -------------------------
-- The invitee is deliberately NOT given a read policy here: their view needs
-- the company name and the inviter's name, and both are unreachable under RLS
-- for a non-member (companies hides unapproved rows, profiles is self-only).
-- That's the same reason get_company_members() exists, so the invitee reads
-- through the same kind of SECURITY DEFINER RPC instead — §4.
--
-- No INSERT/UPDATE/DELETE policies at all: every write goes through an RPC that
-- re-checks authorization. The grant revokes are belt-and-braces so a policy
-- added carelessly later can't quietly open a direct write path.

alter table public.company_invites enable row level security;

drop policy if exists "view company invites" on public.company_invites;
create policy "view company invites" on public.company_invites for select to authenticated
using (public.is_company_member(company_id) or public.is_platform_admin());

revoke all on public.company_invites from anon;
revoke insert, update, delete on public.company_invites from authenticated;
grant select on public.company_invites to authenticated;


-- ---- 3. invite_company_member — creates an invite, not a membership ---------
-- KEEPS, unchanged from Phase-rate-limiting: the is_company_admin() gate, the
-- 20/hour rate_events cap, and the "not_found" answer returned (not raised) so
-- the transaction commits and the rate-limit row survives to count the attempt.
--
-- CHANGED: the tail no longer inserts into company_members. It writes a pending
-- invite and the caller is told "invite sent", never "teammate added" — because
-- until the invitee accepts, nothing has happened to their account.
--
-- Expired pending invites are swept to 'revoked' first. Without that, an invite
-- that timed out would hold the partial unique index and make the same person
-- permanently un-invitable with a confusing "already invited" answer.

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

  select count(*) into v_count
  from public.rate_events
  where actor = v_uid and action = 'invite' and at > now() - interval '1 hour';

  if v_count >= 20 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into public.rate_events (actor, action) values (v_uid, 'invite');

  select id into v_user_id
  from public.profiles
  where lower(email) = v_email;

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


-- ---- 4. get_my_invites — the invitee's side ---------------------------------
-- DEFINER because the invitee is not a member yet: an unapproved company is
-- invisible to them under "view companies", and the inviter's name lives in
-- profiles which is self-only. The caller's email is derived from their own
-- profile row, never from an argument or a JWT claim, so this returns exactly
-- the invites addressed to whoever is calling and nothing else. Signed out
-- (auth.uid() is null) the subquery yields NULL and no row matches.

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


-- ---- 5. accept_company_invite — the only trekker → company path -------------
-- Every check is derived server-side. The invite is matched against the
-- caller's OWN profiles.email, so holding an invite id is not enough to accept
-- someone else's invite.
--
-- Two branches, and the difference matters:
--   * account_type = 'company' already → just add the membership. Company
--     accounts could always be added to a second team; keeping that working is
--     why this doesn't simply require is_trekker().
--   * account_type = 'trekker' → this is the destructive one, so it runs the
--     upcoming-trek check first and then converts.
--
-- is_trekker() is deliberately NOT used to pick the branch: it returns true for
-- platform admins whatever their account_type, which would send an admin who is
-- already a company account down the conversion branch.
--
-- WHY UPCOMING TREKS BLOCK: a converted account can no longer open /messages,
-- so a confirmed booking would strand them in a batch chat they can't reach and
-- leave the company expecting a walker who has vanished from their own app.
-- Waitlisted rows count too — promote_waitlist_on_leave() promotes FIFO without
-- consulting account_type, so a waitlisted row is a booking that can activate
-- itself after the conversion. Past batches are fine; they're history.
--
-- DIRECTION: the UPDATE hard-codes 'company' and only runs inside the
-- account_type='trekker' branch. There is no expression here that could ever
-- move an account the other way — company → trekker stays platform-admin-only.

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

  select lower(p.email), p.account_type
    into v_email, v_account_type
  from public.profiles p
  where p.id = v_uid;

  if v_email is null then
    raise exception 'Your account has no email address';
  end if;

  select i.company_id, i.role
    into v_company_id, v_role
  from public.company_invites i
  where i.id = p_invite_id
    and i.status = 'pending'
    and i.expires_at > now()
    and lower(i.email) = v_email
  for update;

  if v_company_id is null then
    raise exception 'That invitation is no longer valid';
  end if;

  if v_account_type = 'trekker' then
    if exists (
      select 1
      from public.trek_participants tp
      join public.trek_batches b on b.id = tp.batch_id
      where tp.user_id = v_uid
        and b.batch_date >= current_date
    ) then
      raise exception 'You have an upcoming trek booked. Leave it before joining a company team.';
    end if;

    -- Opt out of trg_protect_profile_account_type for this statement only.
    -- set_config(..., is_local => true) is transaction-scoped, and PostgREST
    -- gives clients no way to call set_config at all, so the hatch in §8 is
    -- reachable only from inside a definer function that asks for it. Cleared
    -- immediately so nothing later in this transaction inherits it.
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


-- ---- 6. decline_company_invite ----------------------------------------------
-- Same ownership rule as accept: matched against the caller's own email.

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


-- ---- 7. revoke_company_invite — the company's side --------------------------

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


-- ---- 8. protect_profile_account_type — the narrow escape hatch --------------
-- Phase F §4 predicted this: "Phase 4 of the split needs an invitee-initiated
-- path; that RPC will extend this trigger, it must not work around it." This is
-- that extension, and it is the smallest one available.
--
-- The GUC is transaction-local and can only be set by something running SQL
-- inside the database. A client speaks to PostgREST, which exposes functions in
-- the API schema — set_config lives in pg_catalog and is not among them, and
-- the only GUCs a request can influence are the request.* ones PostgREST sets
-- itself. So the branch below is unreachable from any client request that isn't
-- already executing a SECURITY DEFINER function that opted in.
--
-- Everything else is UNCHANGED: the auth.uid() is null branch (SQL Editor /
-- trusted server-side context) and the platform-admin exemption both stay.

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


-- ---- 9. Close the direct-insert bypass --------------------------------------
-- See the header. With this policy gone company_members has SELECT / UPDATE /
-- DELETE policies only, and the sole INSERT paths are apply_for_company()
-- (owner row) and accept_company_invite() (invited member) — both SECURITY
-- DEFINER, both re-checking authorization internally. The grant revoke means
-- even a re-added policy can't reopen it without someone also re-granting.
--
-- The UPDATE/DELETE policies are untouched: role changes and removals are
-- reversible acts on a membership the admin can already see, and they still
-- carry role <> 'owner' and user_id <> auth.uid().

drop policy if exists "company admins invite staff" on public.company_members;
revoke insert on public.company_members from anon, authenticated;


-- ============================================================================
-- VERIFY
-- ============================================================================
-- Structural checks are NOT sufficient — the storage rate-limit phase passed
-- every catalogue check while being completely inert. This phase turns on
-- auth.uid() in the same way Phase F did, so run the behavioural block too.

-- ---- Structural -------------------------------------------------------------
-- select to_regclass('public.company_invites');                       -- not null
-- select relrowsecurity from pg_class
--  where oid = 'public.company_invites'::regclass;                    -- t
--
-- select polname, polcmd from pg_policy
--  where polrelid = 'public.company_invites'::regclass;
--   -- expect exactly 1 row: "view company invites", polcmd = 'r'
--
-- select polname, polcmd from pg_policy
--  where polrelid = 'public.company_members'::regclass order by polname;
--   -- expect 3 rows (r/w/d). NO 'a' (insert) row.
-- select has_table_privilege('authenticated','public.company_members','insert');  -- f
-- select has_table_privilege('authenticated','public.company_invites','insert');  -- f
-- select has_table_privilege('authenticated','public.company_invites','select');  -- t
-- select has_table_privilege('anon','public.company_invites','select');           -- f
--
-- select proname, prosecdef, proconfig from pg_proc
--  where pronamespace = 'public'::regnamespace
--    and proname in ('invite_company_member','get_my_invites','accept_company_invite',
--                    'decline_company_invite','revoke_company_invite',
--                    'protect_profile_account_type');
--   -- expect 6 rows, all prosecdef=t, proconfig={search_path=public, pg_temp}
--
-- select has_function_privilege('anon','public.accept_company_invite(uuid)','execute');           -- f
-- select has_function_privilege('authenticated','public.accept_company_invite(uuid)','execute');  -- t

-- ---- Behavioural (impersonate real users; every block rolls back) -----------
-- Use a company admin who is NOT a platform admin (:admin_uid) and a plain
-- trekker (:trekker_uid, also not a platform admin) — an admin passes every
-- check by design and gives a false PASS. :company_id is the admin's company.
--
-- A. invite creates a PENDING INVITE, not a membership
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<admin_uid>","role":"authenticated"}';
--   select public.invite_company_member('<company_id>', '<trekker_email>');
--     -- expect: {"invite_id": "..."}
--   select status, email from public.company_invites where company_id='<company_id>';
--     -- expect: pending, lowercased email
--   select count(*) from public.company_members
--    where company_id='<company_id>' and user_id='<trekker_uid>';       -- expect 0
-- rollback;
--
-- B. the dropped policy — a direct insert now fails
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<admin_uid>","role":"authenticated"}';
--   insert into public.company_members (company_id, user_id, role)
--     values ('<company_id>', '<trekker_uid>', 'staff');
--     -- expect: ERROR permission denied for table company_members
-- rollback;
--
-- C. accept converts + joins, in one transaction
--    (run A's invite in the same transaction, uncommitted, then accept)
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<admin_uid>","role":"authenticated"}';
--   select public.invite_company_member('<company_id>', '<trekker_email>');
--   set local request.jwt.claims = '{"sub":"<trekker_uid>","role":"authenticated"}';
--   select invite_id from public.get_my_invites();                     -- expect 1 row
--   select public.accept_company_invite(
--     (select invite_id from public.get_my_invites() limit 1));
--     -- expect: {"company_id":"...","converted":true}
--   select account_type from public.profiles where id='<trekker_uid>';  -- expect company
--   select role from public.company_members
--    where company_id='<company_id>' and user_id='<trekker_uid>';       -- expect staff
--   select status from public.company_invites where company_id='<company_id>';  -- accepted
-- rollback;
--
-- D. the pin still holds for a plain PATCH (hatch didn't leak)
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<trekker_uid>","role":"authenticated"}';
--   update public.profiles set account_type='company' where id='<trekker_uid>';
--   select account_type from public.profiles where id='<trekker_uid>';  -- expect trekker
-- rollback;
--
-- E. an upcoming booking blocks conversion
--    (give <trekker_uid> a confirmed row on a batch dated >= today first)
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<admin_uid>","role":"authenticated"}';
--   select public.invite_company_member('<company_id>', '<trekker_email>');
--   set local request.jwt.claims = '{"sub":"<trekker_uid>","role":"authenticated"}';
--   select public.accept_company_invite(
--     (select invite_id from public.get_my_invites() limit 1));
--     -- expect: ERROR You have an upcoming trek booked...
-- rollback;
--
-- F. invite ids are not bearer tokens — a third party can't accept
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<admin_uid>","role":"authenticated"}';
--   select public.invite_company_member('<company_id>', '<trekker_email>');
--   set local request.jwt.claims = '{"sub":"<other_uid>","role":"authenticated"}';
--   select public.accept_company_invite(
--     (select id from public.company_invites where status='pending' limit 1));
--     -- expect: ERROR That invitation is no longer valid
-- rollback;
--
-- Each block must be run on its own: the first error aborts the transaction.
