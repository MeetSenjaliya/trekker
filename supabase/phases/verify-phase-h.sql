-- Phase H behavioural verification — values filled in for project dtjmyqogeozrzzbdjokr.
-- This is the commented VERIFY block at the bottom of phase-h-frozen-companies.sql with
-- the placeholders resolved, two template bugs fixed, and positive controls added.
--
-- ============================================================================
-- ✅ RUN AND PASSED 2026-08-08 — every block, results as expected, all rolled back
-- ============================================================================
--   B0  approved: writable t, company UPDATE 1, trek INSERT 1
--   B1  rejected: status rejected, writable f, company UPDATE 0, trek UPDATE 0
--   B2  trek_batches INSERT raised 42501
--   B3  invite_company_member() → {"error": "company_frozen"} (returned, not raised)
--   C   suspended behaves identically to rejected
--   D0  the invite stays visible and pending after the freeze
--   D   accept_company_invite() raised "That company is no longer active on Trekker"
--   D2  the same invite accepted cleanly with no freeze — account_type → company,
--       membership row created. Without this, D proves nothing.
--   F   platform admin: trek UPDATE 1 + company UPDATE 1 on a suspended tenant
--   F2  approve_company() unfroze it
--   G   approved: both buckets accepted the owner's write
--   G2/G3  frozen: both buckets refused it
--   POST-CHECK  clean — approved, description unchanged, 0 fixture rows, trekker
--               still trekker, 1 member, 0 invites, 0 storage rows
--   Recorded in FEATURES.md §2 "H — behavioural verification".
--   Re-run this file whenever is_company_writable(), is_approved_company_member(),
--   accept_company_invite() or any company-scoped write policy changes.
--
-- ============================================================================
-- HOW TO RUN — read this, the format matters
-- ============================================================================
-- RUN ONE NUMBERED BLOCK AT A TIME. Select the block, run, record the row, move on.
-- Do NOT paste the whole file: the blocks that end in a deliberate ERROR abort the
-- rest of the run, which is how the first attempt (2026-08-08) got block B's error
-- and nothing else.
--
-- Every block ends in exactly ONE row-returning statement, because the SQL Editor
-- only shows you the last result. Row counts that used to be invisible ("expect
-- UPDATE 0") are now returned as columns via data-modifying CTEs, so the evidence
-- is on screen instead of in a status line you never see.
--
-- Blocks whose expected outcome IS an error say so in their header. For those the
-- error text is the result — read it and move to the next block.
--
-- Every block ends in ROLLBACK. Nothing here is committed. Run the POST-CHECK last.
--
-- ============================================================================
-- FIXTURES
-- ============================================================================
-- owner   = 4ac9720d-79cb-4ccc-bea4-518db5b651ee  mandarmahadikhpht@gmail.com
--             account_type='company', owner of Mandar Trekkers, NOT a platform admin
-- company = 13552f9d-c01d-4c03-acdb-e76c808d8a9e  "Mandar Trekkers" slug mandartekkers
--             status='approved' at rest — each block freezes it itself and rolls back
-- trekker = d903dbb6-4139-4f3d-8b57-d7a48fcecb37  achutakeshavam@gmail.com
--             account_type='trekker', no upcoming bookings (so the accept control can pass)
-- admin   = 655b4188-d194-4529-8114-e86c66d3d8ae  senjaliyameet8@gmail.com, platform admin
-- trek    = 00000000-0000-4000-8000-00000000f001  created inside each block, never at rest
--
-- TWO FIXES vs the template in phase-h-frozen-companies.sql:
--
--   (1) The template freezes with `update public.companies set status='rejected'`
--       "as owner of the DB". That is INERT: trg_protect_company_admin_fields is a
--       BEFORE trigger that does `new.status := old.status` whenever is_platform_admin()
--       is false, and in the SQL Editor auth.uid() is null, so it is false. The company
--       would stay approved and every "expect UPDATE 0" below would instead succeed —
--       reading as a broken guard when nothing is broken. Each block here freezes via
--       reject_company()/suspend_company() under the platform admin's JWT, which is both
--       the real app path and the only way past that trigger.
--
--   (2) The template needs a <trek_id> owned by the frozen company. The company has no
--       treks, and the only company that does is owned by the platform admin — which
--       cannot test a non-admin guard. Each block creates its own trek as the owner
--       while the company is still approved, which doubles as the over-blocking control:
--       if that insert fails, the block proves nothing about the freeze.
--
-- Why the positive controls: the storage rate-limit trigger shipped inert and passed
-- every structural check. "The write was refused" does not by itself prove the freeze
-- refused it — a missing grant or an unrelated policy looks identical. Every negative
-- below is paired with the same statement run while the company is writable.


-- ===== 0. PREFLIGHT (read-only — confirm the fixtures still hold) ===========
select
  (select status::text from public.companies
    where id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e')                    as company_should_be_approved,
  (select count(*) from public.platform_admins
    where user_id = '4ac9720d-79cb-4ccc-bea4-518db5b651ee')               as owner_is_admin_should_be_0,
  (select count(*) from public.platform_admins
    where user_id = '655b4188-d194-4529-8114-e86c66d3d8ae')               as admin_should_be_1,
  (select account_type::text from public.profiles
    where id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37')                    as trekker_should_be_trekker,
  (select count(*) from public.trek_participants tp
     join public.trek_batches b on b.id = tp.batch_id
    where tp.user_id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37'
      and b.batch_date >= current_date)                                   as trekker_bookings_should_be_0,
  (select count(*) from public.treks
    where id = '00000000-0000-4000-8000-00000000f001')                    as fixture_trek_should_be_0;


-- ===== B0. CONTROL — approved company, the owner's writes all work =========
-- Over-blocking control for B1. If any count here is 0, B1 proves nothing: the
-- writes were already failing for a reason that has nothing to do with freezing.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';

  with c as (
    update public.companies set description = 'control edit'
     where id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e'
    returning 1
  ), t as (
    insert into public.treks (id, title, difficulty, company_id)
    values ('00000000-0000-4000-8000-00000000f001', 'ZZ verify-phase-h', 'Easy',
            '13552f9d-c01d-4c03-acdb-e76c808d8a9e')
    returning 1
  )
  select public.is_company_writable('13552f9d-c01d-4c03-acdb-e76c808d8a9e') as writable_expect_t,
         (select count(*) from c) as company_updates_expect_1,
         (select count(*) from t) as trek_inserts_expect_1;
rollback;


-- ===== B1. rejected → the same writes are refused, silently ================
-- UPDATE refusals are silent (0 rows), not errors: a row that fails USING simply
-- doesn't match. That is why the counts are returned rather than assumed.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';

  -- Setup: the trek must exist before the freeze. Raises if RLS refuses it, which
  -- would abort the block here — on `treks`, not on anything below.
  insert into public.treks (id, title, difficulty, company_id)
  values ('00000000-0000-4000-8000-00000000f001', 'ZZ verify-phase-h', 'Easy',
          '13552f9d-c01d-4c03-acdb-e76c808d8a9e');

  -- FREEZE — as the platform admin, via the real app path (see fix (1) in the header).
  set local request.jwt.claims = '{"sub":"655b4188-d194-4529-8114-e86c66d3d8ae","role":"authenticated"}';
  select public.reject_company('13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'phase-h verification');

  -- NEGATIVE — same owner, same statements, now frozen.
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  with c as (
    update public.companies set description = 'frozen edit'
     where id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e'
    returning 1
  ), t as (
    update public.treks set is_active = false
     where id = '00000000-0000-4000-8000-00000000f001'
    returning 1
  )
  select (select status::text from public.companies
           where id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e')             as status_expect_rejected,
         public.is_company_writable('13552f9d-c01d-4c03-acdb-e76c808d8a9e') as writable_expect_f,
         (select count(*) from c)                                         as company_updates_expect_0,
         (select count(*) from t)                                         as trek_updates_expect_0;
rollback;


-- ===== B2. rejected → INSERT raises ========================================
-- ⚠️ EXPECTED OUTCOME IS AN ERROR:
--    new row violates row-level security policy for table "trek_batches"
-- (Confirmed 2026-08-08.) Unlike UPDATE, an INSERT that fails WITH CHECK raises.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  insert into public.treks (id, title, difficulty, company_id)
  values ('00000000-0000-4000-8000-00000000f001', 'ZZ verify-phase-h', 'Easy',
          '13552f9d-c01d-4c03-acdb-e76c808d8a9e');

  set local request.jwt.claims = '{"sub":"655b4188-d194-4529-8114-e86c66d3d8ae","role":"authenticated"}';
  select public.reject_company('13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'phase-h verification');

  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  insert into public.trek_batches (trek_id, batch_date)
  values ('00000000-0000-4000-8000-00000000f001', current_date + 30);
rollback;


-- ===== B3. invite_company_member() returns the frozen sentinel =============
-- Returns rather than raises — the app renders this as a message, not a crash.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"655b4188-d194-4529-8114-e86c66d3d8ae","role":"authenticated"}';
  select public.reject_company('13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'phase-h verification');

  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  select public.invite_company_member('13552f9d-c01d-4c03-acdb-e76c808d8a9e',
                                      'achutakeshavam@gmail.com') as expect_company_frozen;
    -- expect: {"error": "company_frozen"}
rollback;


-- ===== C. suspended behaves identically to rejected ========================
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"655b4188-d194-4529-8114-e86c66d3d8ae","role":"authenticated"}';
  select public.suspend_company('13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'phase-h verification');

  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  with c as (
    update public.companies set description = 'suspended edit'
     where id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e'
    returning 1
  )
  select (select status::text from public.companies
           where id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e')             as status_expect_suspended,
         public.is_company_writable('13552f9d-c01d-4c03-acdb-e76c808d8a9e') as writable_expect_f,
         (select count(*) from c)                                         as company_updates_expect_0;
rollback;


-- ===== D0. the invite survives the freeze — only accepting is blocked ======
-- Establishes that block D's failure is about the company's status and not about
-- the invite having been revoked, expired, or never issued.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  select public.invite_company_member('13552f9d-c01d-4c03-acdb-e76c808d8a9e',
                                      'achutakeshavam@gmail.com');

  set local request.jwt.claims = '{"sub":"655b4188-d194-4529-8114-e86c66d3d8ae","role":"authenticated"}';
  select public.reject_company('13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'phase-h verification');

  set local request.jwt.claims = '{"sub":"d903dbb6-4139-4f3d-8b57-d7a48fcecb37","role":"authenticated"}';
  select count(*) as invite_still_visible_expect_1
    from public.get_my_invites()
   where company_id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e';
rollback;


-- ===== D. an invite issued while approved cannot be accepted after freeze ==
-- The whole reason §5 of phase H exists: the invite is valid, the company is not.
-- ⚠️ EXPECTED OUTCOME IS AN ERROR:
--    That company is no longer active on Trekker, so this invitation can no
--    longer be accepted.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  select public.invite_company_member('13552f9d-c01d-4c03-acdb-e76c808d8a9e',
                                      'achutakeshavam@gmail.com');

  set local request.jwt.claims = '{"sub":"655b4188-d194-4529-8114-e86c66d3d8ae","role":"authenticated"}';
  select public.reject_company('13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'phase-h verification');

  set local request.jwt.claims = '{"sub":"d903dbb6-4139-4f3d-8b57-d7a48fcecb37","role":"authenticated"}';
  select public.accept_company_invite(
    (select invite_id from public.get_my_invites()
      where company_id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e' limit 1));
rollback;


-- ===== D2. CONTROL — identical, minus the freeze. Must SUCCEED. ============
-- Without this, block D's error could equally be a broken invite or a stale email
-- match. The final select reads the *effects* of the accept rather than its return
-- value: a single statement sees one snapshot, so reading profiles in the same
-- statement as the call would still show the pre-accept row.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  select public.invite_company_member('13552f9d-c01d-4c03-acdb-e76c808d8a9e',
                                      'achutakeshavam@gmail.com');

  set local request.jwt.claims = '{"sub":"d903dbb6-4139-4f3d-8b57-d7a48fcecb37","role":"authenticated"}';
  select public.accept_company_invite(
    (select invite_id from public.get_my_invites()
      where company_id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e' limit 1));

  select (select account_type::text from public.profiles
           where id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37')             as expect_company,
         (select count(*) from public.company_members
           where company_id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e'
             and user_id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37')        as membership_expect_1,
         (select count(*) from public.company_invites
           where company_id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e'
             and status = 'accepted')                                     as accepted_invites_expect_1;
rollback;


-- ===== F. a platform admin is not frozen out ===============================
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  insert into public.treks (id, title, difficulty, company_id)
  values ('00000000-0000-4000-8000-00000000f001', 'ZZ verify-phase-h', 'Easy',
          '13552f9d-c01d-4c03-acdb-e76c808d8a9e');

  set local request.jwt.claims = '{"sub":"655b4188-d194-4529-8114-e86c66d3d8ae","role":"authenticated"}';
  select public.suspend_company('13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'phase-h verification');

  with t as (
    update public.treks set is_active = false
     where id = '00000000-0000-4000-8000-00000000f001'
    returning 1
  ), c as (
    update public.companies set description = 'admin edit while suspended'
     where id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e'
    returning 1
  )
  select (select count(*) from t) as trek_updates_expect_1,
         (select count(*) from c) as company_updates_expect_1;
    -- the is_platform_admin() arm of the treks / companies policies
rollback;

-- F2. an admin can always unfreeze.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"655b4188-d194-4529-8114-e86c66d3d8ae","role":"authenticated"}';
  select public.suspend_company('13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'phase-h verification');
  select public.approve_company('13552f9d-c01d-4c03-acdb-e76c808d8a9e');
  select status::text as expect_approved from public.companies
   where id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e';
rollback;


-- ===== G. CONTROL — approved company, both buckets accept the write ========
-- trek-images gates on is_approved_company_member(); company-logos on
-- is_company_member() AND is_company_writable(). Rows go straight into
-- storage.objects — no file is uploaded, and it rolls back.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';

  with a as (
    insert into storage.objects (bucket_id, name, owner)
    values ('trek-images', '13552f9d-c01d-4c03-acdb-e76c808d8a9e/verify-h.jpg',
            '4ac9720d-79cb-4ccc-bea4-518db5b651ee')
    returning 1
  ), b as (
    insert into storage.objects (bucket_id, name, owner)
    values ('company-logos', '13552f9d-c01d-4c03-acdb-e76c808d8a9e/verify-h-logo.jpg',
            '4ac9720d-79cb-4ccc-bea4-518db5b651ee')
    returning 1
  )
  select (select count(*) from a) as trek_images_inserts_expect_1,
         (select count(*) from b) as company_logos_inserts_expect_1;
rollback;

-- G2. frozen → trek-images upload refused.
-- ⚠️ EXPECTED OUTCOME IS AN ERROR: new row violates row-level security policy
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"655b4188-d194-4529-8114-e86c66d3d8ae","role":"authenticated"}';
  select public.reject_company('13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'phase-h verification');

  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  insert into storage.objects (bucket_id, name, owner)
  values ('trek-images', '13552f9d-c01d-4c03-acdb-e76c808d8a9e/verify-h.jpg',
          '4ac9720d-79cb-4ccc-bea4-518db5b651ee');
rollback;

-- G3. frozen → company-logos upload refused.
-- ⚠️ EXPECTED OUTCOME IS AN ERROR: new row violates row-level security policy
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"655b4188-d194-4529-8114-e86c66d3d8ae","role":"authenticated"}';
  select public.reject_company('13552f9d-c01d-4c03-acdb-e76c808d8a9e', 'phase-h verification');

  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  insert into storage.objects (bucket_id, name, owner)
  values ('company-logos', '13552f9d-c01d-4c03-acdb-e76c808d8a9e/verify-h-logo.jpg',
          '4ac9720d-79cb-4ccc-bea4-518db5b651ee');
rollback;


-- ===== POST-CHECK — prove nothing leaked out of the rollbacks ==============
select (select status::text from public.companies
         where id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e')               as company_back_to_approved,
       (select description from public.companies
         where id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e')               as description_unchanged,
       (select count(*) from public.treks
         where id = '00000000-0000-4000-8000-00000000f001')               as fixture_trek_should_be_0,
       (select count(*) from public.trek_batches
         where trek_id = '00000000-0000-4000-8000-00000000f001')          as fixture_batches_should_be_0,
       (select account_type::text from public.profiles
         where id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37')               as trekker_still_trekker,
       (select count(*) from public.company_members
         where company_id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e')       as members_should_be_1,
       (select count(*) from public.company_invites
         where company_id = '13552f9d-c01d-4c03-acdb-e76c808d8a9e')       as invites_should_be_0,
       (select count(*) from storage.objects
         where name like '13552f9d-c01d-4c03-acdb-e76c808d8a9e/verify-h%') as storage_rows_should_be_0;
