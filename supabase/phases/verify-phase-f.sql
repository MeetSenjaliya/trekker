-- Phase F behavioural verification — values filled in for project dtjmyqogeozrzzbdjokr.
-- This is the block referenced at the bottom of phase-f-account-types.sql, with the
-- placeholders resolved and paired positive controls added.
--
-- RUN EACH BLOCK ON ITS OWN — select the block, run, record the result, move on.
-- Do NOT paste the whole file. Blocks B and C are *expected* to end in an error, and
-- an error aborts everything after it: that is how the 2026-08-08 attempt returned
-- block B's error and never reached B2/C/C2.
-- Every block ends in ROLLBACK: nothing here is committed.
--
-- ✅ RUN AND PASSED 2026-08-08 — every block, results as expected, all rolled back.
--    A   is_trekker() = f for the company account, t for the trekker
--    B   favorites INSERT refused the company account (42501)
--    B2  the identical insert as a trekker SUCCEEDED — this is what makes B evidence
--    C   join_trek_and_chat() raised "Company accounts cannot join treks"
--    C2  the same call as a trekker returned a normal jsonb payload
--    POST-CHECK  clean: no favourite, no batch, no disabled trigger, both
--                account_type values unchanged
--    Recorded in FEATURES.md §2 "Account types → 1 — database enforcement".
--    Re-run this file whenever is_trekker() or the favorites/trek_participants
--    INSERT policies change.
--
-- company = 4ac9720d-79cb-4ccc-bea4-518db5b651ee  mandarmahadikhpht@gmail.com
--             account_type='company', owner of Mandar Trekkers, NOT a platform admin
-- trekker = d903dbb6-4139-4f3d-8b57-d7a48fcecb37  achutakeshavam@gmail.com
--             account_type='trekker', NOT a platform admin
-- trek    = cce25ab0-4baa-41cc-a77f-0449aab4d4f7  "Chopta - Tungnath"
--             owned by Trekker Originals — a DIFFERENT company, so this is the
--             general "company account books someone else's trek" case
--
-- Why non-admin accounts: is_trekker() is `account_type='trekker' OR is_platform_admin()`,
-- so a platform admin passes every check below by design and would give a false PASS.
-- The one account that is both company and platform admin (senjaliyameet8@gmail.com)
-- is deliberately NOT used here.
--
-- Why the positive controls: the storage rate-limit bug shipped green because a guard
-- that never runs and a guard that works look identical from the outside. The mirror of
-- that lesson applies here — "the insert was rejected" does not by itself prove
-- is_trekker() rejected it (a missing grant, a unique violation or an unrelated policy
-- would look the same). Each negative block is paired with the SAME statement run as a
-- trekker, which must SUCCEED. Only the pair is evidence. Verified beforehand that
-- neither positive control collides with an existing row.


-- ===== A. the predicate itself ==============================================
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';
  select public.is_trekker() as company_expect_false;
    -- expect: f
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"d903dbb6-4139-4f3d-8b57-d7a48fcecb37","role":"authenticated"}';
  select public.is_trekker() as trekker_expect_true;
    -- expect: t
rollback;


-- ===== B. favorites INSERT policy ===========================================
-- Policy: with check ((auth.uid() = user_id) AND is_trekker())
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';

  insert into public.favorites (user_id, trek_id)
  values ('4ac9720d-79cb-4ccc-bea4-518db5b651ee',
          'cce25ab0-4baa-41cc-a77f-0449aab4d4f7');
    -- expect: ERROR  new row violates row-level security policy for table "favorites"
rollback;

-- B2. POSITIVE CONTROL — the identical statement as a trekker must succeed.
-- If this also fails, block B proved nothing about is_trekker().
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"d903dbb6-4139-4f3d-8b57-d7a48fcecb37","role":"authenticated"}';

  insert into public.favorites (user_id, trek_id)
  values ('d903dbb6-4139-4f3d-8b57-d7a48fcecb37',
          'cce25ab0-4baa-41cc-a77f-0449aab4d4f7');

  select count(*) as should_be_1 from public.favorites
  where user_id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37'
    and trek_id = 'cce25ab0-4baa-41cc-a77f-0449aab4d4f7';
    -- expect: 1
rollback;


-- ===== C. join_trek_and_chat() ==============================================
-- Triggers off first, and this is NOT cosmetic: trek_participants carries THREE
-- live notification triggers (trek-join-notification, trek_join_email_trigger,
-- trek-leave-notification) that send real email to a real address, plus the join
-- rate-limit trigger. If the is_trekker() guard were inert the insert would go
-- through and the mail would leave before the ROLLBACK could matter. DDL is
-- transactional in Postgres, so ROLLBACK restores the triggers.
--
-- Batch date is current_date + 200 in BOTH blocks: inside the function's
-- [-1 day, +1 year] window, and no batch exists on that date, so the trekker
-- control creates a fresh batch rather than colliding on (user_id, batch_id).
-- Same date in both means account_type is the only difference between them.
begin;
  alter table public.trek_participants disable trigger user;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"4ac9720d-79cb-4ccc-bea4-518db5b651ee","role":"authenticated"}';

  select public.join_trek_and_chat(
    '4ac9720d-79cb-4ccc-bea4-518db5b651ee',
    'cce25ab0-4baa-41cc-a77f-0449aab4d4f7',
    current_date + 200);
    -- expect: ERROR  Company accounts cannot join treks
rollback;

-- C2. POSITIVE CONTROL — same call as a trekker must return a jsonb payload.
begin;
  alter table public.trek_participants disable trigger user;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"d903dbb6-4139-4f3d-8b57-d7a48fcecb37","role":"authenticated"}';

  select public.join_trek_and_chat(
    'd903dbb6-4139-4f3d-8b57-d7a48fcecb37',
    'cce25ab0-4baa-41cc-a77f-0449aab4d4f7',
    current_date + 200);
    -- expect: {"batch_id":"...","participant_id":"...","conversation_id":"...","status":"confirmed",...}
rollback;


-- ===== D. the account_type pin ==============================================
-- Already proven behaviourally by phase G block D (2026-08-06): a plain
-- `update profiles set account_type=...` as the owning user is silently pinned
-- back, which also confirmed the step-4 GUC hatch does not leak to PostgREST.
-- Not repeated here. See supabase/phases/verify-phase-g.sql block D.


-- ===== POST-CHECK — prove nothing leaked out of the rollbacks ==============
select (select count(*) from public.favorites
         where trek_id = 'cce25ab0-4baa-41cc-a77f-0449aab4d4f7'
           and user_id in ('4ac9720d-79cb-4ccc-bea4-518db5b651ee',
                           'd903dbb6-4139-4f3d-8b57-d7a48fcecb37'))            as favorites_should_be_0,
       (select count(*) from public.trek_batches
         where trek_id = 'cce25ab0-4baa-41cc-a77f-0449aab4d4f7'
           and batch_date = current_date + 200)                                 as batches_should_be_0,
       (select count(*) from pg_trigger
         where tgrelid = 'public.trek_participants'::regclass
           and tgenabled = 'D')                                                 as disabled_triggers_should_be_0,
       (select account_type::text from public.profiles
         where id = '4ac9720d-79cb-4ccc-bea4-518db5b651ee')                     as company_should_be_company,
       (select account_type::text from public.profiles
         where id = 'd903dbb6-4139-4f3d-8b57-d7a48fcecb37')                     as trekker_should_be_trekker;
