-- ============================================================================
-- Phase H — Freeze rejected / suspended companies
-- ============================================================================
-- Until now every company-scoped write policy asked only "is the caller a
-- member?" (is_company_member / is_company_admin). Status was consulted for
-- READS — is_trek_visible hides an unapproved company's catalogue — and for
-- nothing else. So a company a platform admin had rejected or suspended kept
-- full write access to its own tenant: invite staff, change roles, remove
-- members, rewrite its public storefront copy, archive/restore treks, add and
-- delete departures. Suspension hid the treks and changed nothing else.
--
-- THE RULE THIS PHASE INSTALLS. Two tiers, because "not approved yet" and
-- "approval withdrawn" are different situations:
--
--   pending, approved  → WRITABLE. A pending applicant is meant to set the
--     company up while it waits (the dashboard banner promises exactly that).
--   rejected, suspended → FROZEN. Read-only tenant. Every existing page still
--     loads, the status banner still explains why, but nothing can be changed.
--
--   Publishing — treks, departures, trek images — stays APPROVED-ONLY, which is
--   stricter than "writable". That gate is not new as a product rule: both
--   /dashboard/treks/new and the overview already hid the create UI behind
--   status = 'approved', and the comment in new/page.tsx claimed it was
--   "enforced by the treks INSERT RLS policy". It was not — the policy was
--   is_company_member(company_id) with no status test, and the publishable key
--   ships in the client bundle, so a POST /rest/v1/treks from a pending or
--   suspended company's admin succeeded. This phase makes the claim true.
--
-- WHY THE INVITE PATH MATTERS MOST. accept_company_invite() converts a trekker
-- account to a company account, and Phase G is explicit that only a platform
-- admin can convert it back. An invite from a rejected company therefore offers
-- a trekker an irreversible trade for a seat on a team that can do nothing at
-- all. Gating invite_company_member() alone would not close that: invites
-- issued while the company was approved outlive the rejection as live rows, so
-- accept_company_invite() re-checks status at accept time (§6).
--
-- WHAT IS DELIBERATELY NOT GATED:
--   * revoke_company_invite() — de-escalating. It only invalidates an invite,
--     and §6 has already made a frozen company's invites unacceptable, so
--     blocking the one call that retires them buys nothing. (The dashboard
--     hides the pending-invite list along with the rest of team management, so
--     this is reachable only by direct REST call.)
--   * decline_company_invite() — the invitee's own refusal.
--   * platform-admin paths (approve/reject/suspend, is_platform_admin() arms of
--     the treks/companies policies) — freezing must not lock out the role that
--     un-freezes.
--   * Participant-facing flows. join_trek_and_chat() and the waitlist/count
--     triggers are all SECURITY DEFINER, so nothing here touches an existing
--     booking or chat on a suspended company's trek.
--
-- Nothing in this phase is destructive: no data is deleted or rewritten, only
-- policies and three functions are replaced. Re-approving a company restores
-- every capability immediately, with no backfill.
-- ============================================================================


-- ---- 1. is_company_writable — the frozen/not-frozen test --------------------
-- One helper about the COMPANY only, composed with the existing membership
-- helpers at each call site (is_company_member(x) and is_company_writable(x))
-- rather than forking both of those into status-aware twins.
--
-- SECURITY DEFINER because two callers need it where the caller cannot see the
-- companies row under RLS: the invitee in accept_company_invite() (a non-member
-- can only see approved rows), and the companies UPDATE policy itself, which
-- must not recurse into "view companies".

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

comment on function public.is_company_writable(uuid) is
  'True when a company is not frozen: status is pending or approved. Composed '
  'with is_company_member / is_company_admin in the company-scoped write '
  'policies so rejected and suspended tenants are read-only.';

grant execute on function public.is_company_writable(uuid) to authenticated;

-- is_approved_company_member has sat in the schema since the multi-tenant
-- migration with no caller (schema.sql documented it as ORPHANED). §7/§8/§9
-- give it its callers, so pin the grant explicitly instead of relying on the
-- default PUBLIC execute its siblings don't rely on either.
grant execute on function public.is_approved_company_member(uuid) to authenticated;


-- ---- 2. companies UPDATE — storefront edits ---------------------------------
-- The public storefront (/company/[slug]) renders name/description/logo/cover.
-- A suspended company editing that copy is editing a page the platform has
-- taken down; a rejected one is editing a page that never went up. Frozen.
--
-- The platform-admin arm is unchanged and deliberately NOT wrapped in the
-- status test — see the header.
--
-- trg_protect_company_admin_fields still pins status/slug/approved_by/…, so a
-- writable company cannot approve itself and a frozen one cannot un-freeze
-- itself through this policy.

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


-- ---- 3. company_members — roles and removals --------------------------------
-- UNCHANGED in both: role <> 'owner' (a company can never lose its owner
-- through a client) and user_id <> auth.uid() (no self-demotion / self-removal).
-- ADDED: the writable test, so a frozen company's roster is fixed as it stands.
--
-- INSERT stays absent — Phase G §9 dropped it; memberships are RPC-only.

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


-- ---- 4. invite_company_member — no new invites from a frozen company --------
-- UNCHANGED: the is_company_admin() gate, the 20/hour cap, the expired-invite
-- sweep, and the returned (not raised) answers for expected conditions.
--
-- ADDED: the writable test, placed BEFORE the rate-limit insert. Rate limiting
-- exists to blunt email-enumeration through the not_found answer; a frozen
-- company is refused before it learns anything, so there is nothing to meter
-- and no reason to spend one of its 20 slots.
--
-- Returned as {"error": "company_frozen"} rather than raised, matching the
-- rate_limited / not_found / already_invited answers the client already maps to
-- copy. The dashboard hides the invite form for a frozen company, so this fires
-- for the race (rejected while the form sat open) and for a direct REST call.

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


-- ---- 5. accept_company_invite — status is re-checked at accept time ---------
-- The one check in this phase that protects someone OUTSIDE the company. An
-- invite issued while the company was approved stays a live row after it is
-- rejected or suspended; without this, accepting one converts a trekker's
-- account irreversibly (platform-admin-only to undo, per Phase G) in exchange
-- for a seat on a tenant that can no longer publish, invite, or edit anything.
--
-- Raised, not returned: unlike the invite RPC's expected-condition answers this
-- is a state the invitee cannot have caused and can do nothing about, and the
-- neighbouring 'That invitation is no longer valid' / upcoming-trek errors are
-- already surfaced to them as text.
--
-- Placed AFTER the invite lookup so a caller who does not own the invite still
-- gets 'no longer valid' and learns nothing about the company's status.
--
-- Everything else is UNCHANGED from Phase G §5: the own-email match, the
-- account_type branch (company accounts just gain a membership), the
-- upcoming-booking block, and the transaction-local account_type_change hatch.

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

  if not public.is_company_writable(v_company_id) then
    raise exception 'That company is no longer active on Trekker, so this invitation can no longer be accepted.';
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


-- ---- 6. treks — publishing is approved-only ---------------------------------
-- is_approved_company_member replaces is_company_member on both write policies.
-- This closes the gap the header describes (the UI's approved-only gate had no
-- RLS behind it) and freezes archive/restore for a rejected or suspended
-- company in the same edit.
--
-- Pending companies lose nothing they had: they could never create a trek
-- through the UI, and reject/suspend never move a company back to pending, so
-- no company can hold treks while pending.
--
-- SELECT is untouched — is_trek_visible already lets staff and existing
-- participants see a hidden trek, and that must keep working while frozen.
-- There is still no DELETE policy; archiving (is_active = false) is the only
-- removal path, and for a frozen company even that is now closed.

drop policy if exists "company members create treks" on public.treks;
create policy "company members create treks" on public.treks for insert to authenticated
with check (public.is_approved_company_member(company_id));

drop policy if exists "company members manage own treks" on public.treks;
create policy "company members manage own treks" on public.treks for update to authenticated
using (public.is_approved_company_member(company_id) or public.is_platform_admin())
with check (public.is_approved_company_member(company_id) or public.is_platform_admin());


-- ---- 7. trek_batches — departures follow their trek -------------------------
-- Same substitution. A departure is a sellable date, so it belongs to the
-- publishing tier: adding one to a suspended company's trek would create a
-- bookable slot on a catalogue entry the platform has taken down.
--
-- UNCHANGED on delete: batch_has_participants / batch_has_conversation still
-- guard it, so a frozen company is refused before those even matter but the
-- never-orphan-a-booking rule stays written where it belongs.

drop policy if exists "company manages own batches insert" on public.trek_batches;
create policy "company manages own batches insert" on public.trek_batches for insert to authenticated
with check (
  exists (
    select 1 from public.treks t
    where t.id = trek_batches.trek_id and public.is_approved_company_member(t.company_id)
  )
);

drop policy if exists "company manages own batches update" on public.trek_batches;
create policy "company manages own batches update" on public.trek_batches for update to authenticated
using (
  exists (
    select 1 from public.treks t
    where t.id = trek_batches.trek_id and public.is_approved_company_member(t.company_id)
  )
)
with check (
  exists (
    select 1 from public.treks t
    where t.id = trek_batches.trek_id and public.is_approved_company_member(t.company_id)
  )
);

drop policy if exists "company deletes empty batches" on public.trek_batches;
create policy "company deletes empty batches" on public.trek_batches for delete to authenticated
using (
  exists (
    select 1 from public.treks t
    where t.id = trek_batches.trek_id and public.is_approved_company_member(t.company_id)
  )
  and not public.batch_has_participants(trek_batches.id)
  and not public.batch_has_conversation(trek_batches.id)
);


-- ---- 8. Storage — the write policies follow their table ---------------------
-- Without this the table gates are cosmetic in one direction: a frozen company
-- could still overwrite the logo and cover at the SAME storage paths the
-- storefront already links to, changing what the public sees without ever
-- updating a companies row. Both buckets are public, so the CDN serves the new
-- bytes at the old URL.
--
-- Tier matched to the table each bucket feeds: company-logos → writable
-- (§2, pending companies upload branding while they wait), trek-images →
-- approved (§6). SELECT policies are untouched in both; existing images must
-- keep resolving for the people who already hold bookings.
--
-- First path segment is the company UUID in both buckets — TrekForm writes
-- trek-images/{companyId}/{trekId}/…, settings writes company-logos/{companyId}/….

drop policy if exists "Company members upload own logo" on storage.objects;
create policy "Company members upload own logo" on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-logos'
  and public.is_company_member(((storage.foldername(name))[1])::uuid)
  and public.is_company_writable(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Company members update own logo" on storage.objects;
create policy "Company members update own logo" on storage.objects for update to authenticated
using (
  bucket_id = 'company-logos'
  and public.is_company_member(((storage.foldername(name))[1])::uuid)
  and public.is_company_writable(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'company-logos'
  and public.is_company_member(((storage.foldername(name))[1])::uuid)
  and public.is_company_writable(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Company members delete own logo" on storage.objects;
create policy "Company members delete own logo" on storage.objects for delete to authenticated
using (
  bucket_id = 'company-logos'
  and public.is_company_member(((storage.foldername(name))[1])::uuid)
  and public.is_company_writable(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Company members upload trek images" on storage.objects;
create policy "Company members upload trek images" on storage.objects for insert to authenticated
with check (
  bucket_id = 'trek-images'
  and public.is_approved_company_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Company members update trek images" on storage.objects;
create policy "Company members update trek images" on storage.objects for update to authenticated
using (
  bucket_id = 'trek-images'
  and public.is_approved_company_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'trek-images'
  and public.is_approved_company_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Company members delete trek images" on storage.objects;
create policy "Company members delete trek images" on storage.objects for delete to authenticated
using (
  bucket_id = 'trek-images'
  and public.is_approved_company_member(((storage.foldername(name))[1])::uuid)
);


-- ============================================================================
-- VERIFY
-- ============================================================================
-- Structural checks are NOT sufficient — the storage rate-limit phase passed
-- every catalogue check while being completely inert. Run the behavioural block.

-- ---- Structural -------------------------------------------------------------
-- select proname, prosecdef, provolatile, proconfig from pg_proc
--  where pronamespace = 'public'::regnamespace
--    and proname in ('is_company_writable','invite_company_member','accept_company_invite');
--   -- expect 3 rows, all prosecdef=t, proconfig={search_path=public, pg_temp}
-- select has_function_privilege('authenticated','public.is_company_writable(uuid)','execute');       -- t
-- select has_function_privilege('authenticated','public.is_approved_company_member(uuid)','execute'); -- t
--
-- select public.is_company_writable(id), status from public.companies;
--   -- expect t for pending/approved, f for rejected/suspended, on every row
--
-- Every company-scoped write policy must now mention a status-aware helper.
-- select polrelid::regclass as tbl, polname, polcmd
--   from pg_policy
--  where polrelid in ('public.companies'::regclass, 'public.company_members'::regclass,
--                     'public.treks'::regclass, 'public.trek_batches'::regclass)
--    and polcmd <> 'r'
--    and pg_get_expr(coalesce(polqual, polwithcheck), polrelid)
--        not like '%is_company_writable%'
--    and pg_get_expr(coalesce(polqual, polwithcheck), polrelid)
--        not like '%is_approved_company_member%';
--   -- expect 0 rows
--
-- select polname from pg_policy
--  where polrelid = 'storage.objects'::regclass
--    and polname like 'Company members%'
--    and polcmd <> 'r'
--    and pg_get_expr(coalesce(polqual, polwithcheck), polrelid) not like '%writable%'
--    and pg_get_expr(coalesce(polqual, polwithcheck), polrelid) not like '%approved%';
--   -- expect 0 rows (6 write policies, 3 per bucket)

-- ---- Behavioural (impersonate real users; every block rolls back) -----------
-- ⚠️ DO NOT RUN THE BLOCKS BELOW. They are kept for context only. The runnable,
-- ✅ RUN-AND-PASSED (2026-08-08) version is supabase/phases/verify-phase-h.sql —
-- placeholders resolved, plus two fixes this template needs. (1) The
-- `update companies set status=...` below is INERT when run as postgres:
-- trg_protect_company_admin_fields pins status back unless is_platform_admin(),
-- and auth.uid() is null in the SQL Editor — so every "expect UPDATE 0" here
-- would instead SUCCEED and a working guard would read as broken. (2) <trek_id>
-- has nothing to resolve to — the non-admin owner's company has no treks, so the
-- companion creates one in-transaction.
--
-- Use a company OWNER who is NOT a platform admin — a platform admin passes the
-- is_platform_admin() arm of §2/§6 and gives a false PASS. :company_id is their
-- company; :trek_id one of its treks. The company must be approved at the start
-- of each block; the block rejects it itself so the freeze is what's measured.
--
-- A. approved → every write still works (guards against over-blocking)
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<owner_uid>","role":"authenticated"}';
--   update public.companies set description = 'still editable' where id = '<company_id>';
--     -- expect UPDATE 1
--   update public.treks set is_active = is_active where id = '<trek_id>';
--     -- expect UPDATE 1
--   select public.invite_company_member('<company_id>', '<some_trekker_email>');
--     -- expect {"invite_id": "..."}
-- rollback;
--
-- B. rejected → the same writes are refused, silently (0 rows) not by error
-- begin;
--   update public.companies set status = 'rejected' where id = '<company_id>';  -- as owner of the DB
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<owner_uid>","role":"authenticated"}';
--   select public.is_company_writable('<company_id>');                    -- expect f
--   update public.companies set description = 'frozen edit' where id = '<company_id>';
--     -- expect UPDATE 0
--   update public.treks set is_active = false where id = '<trek_id>';     -- expect UPDATE 0
--   insert into public.trek_batches (trek_id, batch_date)
--     values ('<trek_id>', current_date + 30);
--     -- expect ERROR new row violates row-level security policy
--   select public.invite_company_member('<company_id>', '<some_trekker_email>');
--     -- expect {"error": "company_frozen"}
-- rollback;
--
-- C. suspended behaves identically to rejected
--   Re-run B with status = 'suspended'.
--
-- D. an invite issued while approved cannot be accepted after rejection
--    (the whole reason §5 exists)
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<owner_uid>","role":"authenticated"}';
--   select public.invite_company_member('<company_id>', '<trekker_email>');
--   set local role postgres;
--   update public.companies set status = 'rejected' where id = '<company_id>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<trekker_uid>","role":"authenticated"}';
--   select public.accept_company_invite(
--     (select invite_id from public.get_my_invites() limit 1));
--     -- expect ERROR That company is no longer active on Trekker...
--   select account_type from public.profiles where id = '<trekker_uid>';  -- expect trekker
-- rollback;
--
-- E. rejection does not touch reads or existing bookings
-- begin;
--   update public.companies set status = 'rejected' where id = '<company_id>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<owner_uid>","role":"authenticated"}';
--   select count(*) from public.treks where company_id = '<company_id>';   -- expect > 0
--   select count(*) from public.company_members where company_id = '<company_id>';
--     -- expect the full roster
--   select count(*) from public.get_company_members('<company_id>');       -- expect same
-- rollback;
--
-- F. a platform admin is not frozen out
-- begin;
--   update public.companies set status = 'suspended' where id = '<company_id>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<platform_admin_uid>","role":"authenticated"}';
--   update public.treks set is_active = false where id = '<trek_id>';      -- expect UPDATE 1
--   select public.approve_company('<company_id>');                         -- expect success
-- rollback;
--
-- Each block must be run on its own: the first error aborts the transaction.
