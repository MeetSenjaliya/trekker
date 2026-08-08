-- Phase G behavioural verification — values filled in for project dtjmyqogeozrzzbdjokr.
-- RUN EACH BLOCK ON ITS OWN. The first error aborts the transaction, so a later
-- statement in the same block would report a misleading failure.
-- Every block ends in ROLLBACK: nothing here is committed.
--
-- admin   = 4ac9720d-79cb-4ccc-bea4-518db5b651ee  mandarmahadikhpht@gmail.com (owner, NOT platform admin)
-- company = 13552f9d-c01d-4c03-acdb-e76c808d8a9e  Mandar Trekkers (approved)
-- trekker = d903dbb6-4139-4f3d-8b57-d7a48fcecb37  achutakeshavam@gmail.com   (NOT platform admin)
-- other   = 662d9204-02ed-4b6e-982a-35ddb4d7fefc  rexaba2099@emaxasp.com


-- ===== A. invite creates a PENDING INVITE, not a membership =================
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';

  select public.invite_company_member(
    '13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'ACHUTAkeshavam@gmail.com');
    -- expect: {"invite_id": "..."}   (mixed case on purpose — it must store lowercased)

  select status, email, role, expires_at
  from public.company_invites
  where company_id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e';
    -- expect: pending | achutakeshavam@gmail.com | staff | ~14 days out

  select count(*) as should_be_zero from public.company_members
  where company_id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e'
    and user_id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37';
    -- expect: 0
rollback;


-- ===== B. the dropped policy — a direct insert now fails ====================
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';

  insert into public.company_members (company_id, user_id, role)
  values ('13552f9d-c01d-4c03-acdb-e76c808d8a9e',
          'd903dbb6-4139-4f3d-8b57-d7a48fcecb37', 'staff');
    -- expect: ERROR  permission denied for table company_members
rollback;


-- ===== C. accept converts + joins, in one transaction ======================
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  select public.invite_company_member(
    '13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'achutakeshavam@gmail.com');

  set local request.jwt.claims = '{"sub":"d903dbb6-4139-4f3d-8b57-d7a48fcecb37","role":"authenticated"}';

  select invite_id, company_name, invited_by_name from public.get_my_invites();
    -- expect: exactly 1 row, company_name = 'Mandar Trekkers'

  select public.accept_company_invite(
    (select invite_id from public.get_my_invites() limit 1));
    -- expect: {"company_id":"13552f9d-...","converted":true}

  select account_type from public.profiles
  where id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37';
    -- expect: company        <-- the pin was opened, deliberately

  select role from public.company_members
  where company_id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e'
    and user_id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37';
    -- expect: staff

  select status, responded_at is not null as responded from public.company_invites
  where company_id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e';
    -- expect: accepted | t
rollback;


-- ===== D. the pin still holds for a plain PATCH (hatch didn't leak) =========
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"d903dbb6-4139-4f3d-8b57-d7a48fcecb37","role":"authenticated"}';

  update public.profiles set account_type = 'company'
  where id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37';

  select account_type from public.profiles
  where id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37';
    -- expect: trekker   (silently pinned back — the UPDATE reports success, that's the design)
rollback;


-- ===== E. an upcoming booking blocks conversion ============================
-- The booking is created inside the transaction with triggers off. Not cosmetic:
-- trek_participants carries the trek-join notification webhook, which would send
-- a real email to a real address, and the join rate-limit trigger reads
-- auth.uid() — NULL here — before the impersonation is set up. DDL is
-- transactional in Postgres, so ROLLBACK restores the triggers.
begin;
  alter table public.trek_participants disable trigger user;

  insert into public.trek_participants (user_id, batch_id, status)
  values ('d903dbb6-4139-4f3d-8b57-d7a48fcecb37',
          '5c55735e-52fa-4c78-9dde-1b67ed3e4d22', 'confirmed');
    -- Chopta - Tungnath, 2026-08-08 (>= today)

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  select public.invite_company_member(
    '13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'achutakeshavam@gmail.com');

  set local request.jwt.claims = '{"sub":"d903dbb6-4139-4f3d-8b57-d7a48fcecb37","role":"authenticated"}';
  select public.accept_company_invite(
    (select invite_id from public.get_my_invites() limit 1));
    -- expect: ERROR  You have an upcoming trek booked. Leave it before joining a company team.
rollback;

-- E2. same again with status = 'waitlisted' — must ALSO be refused, because
-- promote_waitlist_on_leave() promotes FIFO without consulting account_type.
begin;
  alter table public.trek_participants disable trigger user;
  insert into public.trek_participants (user_id, batch_id, status)
  values ('d903dbb6-4139-4f3d-8b57-d7a48fcecb37',
          '5c55735e-52fa-4c78-9dde-1b67ed3e4d22', 'waitlisted');

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  select public.invite_company_member(
    '13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'achutakeshavam@gmail.com');

  set local request.jwt.claims = '{"sub":"d903dbb6-4139-4f3d-8b57-d7a48fcecb37","role":"authenticated"}';
  select public.accept_company_invite(
    (select invite_id from public.get_my_invites() limit 1));
    -- expect: same ERROR
rollback;


-- ===== F. invite ids are not bearer tokens =================================
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  select public.invite_company_member(
    '13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'achutakeshavam@gmail.com');

  -- a different signed-in user, holding the invite id
  set local request.jwt.claims = '{"sub":"662d9204-02ed-4b6e-982a-35ddb4d7fefc","role":"authenticated"}';

  select count(*) as should_be_zero from public.get_my_invites();
    -- expect: 0  — it isn't addressed to them

  select public.accept_company_invite(
    (select id from public.company_invites where status = 'pending' limit 1));
    -- expect: ERROR  That invitation is no longer valid
rollback;


-- ===== POST-CHECK — prove nothing leaked out of the rollbacks =============
select (select count(*) from public.company_invites)                              as invites_should_be_0,
       (select account_type::text from public.profiles
         where id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37')                        as trekker_should_be_trekker,
       (select count(*) from public.company_members
         where user_id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37')                   as memberships_should_be_0,
       (select count(*) from pg_trigger
         where tgrelid = 'public.trek_participants'::regclass and tgenabled = 'D') as disabled_triggers_should_be_0;


-- ===== F2. invite ids are not bearer tokens — the isolated version =========
-- F's subquery read company_invites as the third party, whom RLS hides the row
-- from, so it may have passed NULL and raised for the wrong reason. Here the id
-- is captured while impersonating the admin and held in a variable across the
-- identity switch, so the ownership check in accept_company_invite() is the only
-- thing that can reject it.
begin;
  do $$
  declare
    v_invite uuid;
    v_msg    text;
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}', true);
    v_invite := (public.invite_company_member(
      '13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'achutakeshavam@gmail.com')->>'invite_id')::uuid;

    if v_invite is null then
      raise exception 'SETUP FAILED — no invite was created';
    end if;
    raise notice 'invite id captured as admin: %', v_invite;

    -- become a different signed-in user, still holding the real id
    perform set_config('request.jwt.claims',
      '{"sub":"662d9204-02ed-4b6e-982a-35ddb4d7fefc","role":"authenticated"}', true);

    begin
      perform public.accept_company_invite(v_invite);
      raise exception 'FAIL — third party accepted a KNOWN invite id (%)', v_invite;
    exception
      when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text;
        if v_msg = 'That invitation is no longer valid' then
          raise notice 'PASS — known invite id rejected on ownership: %', v_msg;
        else
          raise exception 'UNEXPECTED: %', v_msg;
        end if;
    end;
  end
  $$;
rollback;
