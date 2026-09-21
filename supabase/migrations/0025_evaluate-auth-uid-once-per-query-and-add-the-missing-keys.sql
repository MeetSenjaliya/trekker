-- 0025 — evaluate auth.uid() once per query, and finish the keys
--
-- Three performance-advisor findings, all behaviour-identical to close. Every
-- policy below is restated with exactly the roles, commands and predicates it
-- has today; the only textual change is the one the advisor asks for.
--
--   1. auth_rls_initplan (22 WARN). A bare `auth.uid()` in a policy is a
--      function call the planner makes per candidate row; `(select auth.uid())`
--      is a scalar subquery it hoists into an InitPlan and evaluates once per
--      statement. Same answer, since auth.uid() is STABLE and reads only the
--      request's JWT claims. It is cheapest to do while the tables are near
--      empty, and the tests/db suite re-proves every policy afterwards.
--
--      Five of the 22 are `to public` and stay that way — 0002 §B explains
--      why: "System adds participants" tests auth.role() and would be excluded
--      by re-scoping, and the `user_id = auth.uid()` ones call no function
--      anon lacks EXECUTE on. Wrapping the call does not touch the role.
--
--   2. no_primary_key (2 INFO). conversation_participants and favorites were
--      created with a UNIQUE on the pair that identifies a row but no PRIMARY
--      KEY. The unique is promoted rather than duplicated: the constraint is
--      dropped and a PK on the same columns takes its place, so the table
--      never holds two identical indexes. `on conflict (conversation_id,
--      user_id)` in join_trek_and_chat keeps working — inference accepts any
--      unique index on those columns. One side effect, deliberate:
--      favorites.trek_id was nullable and a PK makes it NOT NULL. A favorite
--      with no trek is meaningless and no live row has one.
--
--   3. unindexed_foreign_keys (2 INFO). companies.approved_by and
--      company_invites.invited_by reference auth.users / profiles with no
--      covering index, so a delete or update on the parent scans the child.
--
-- Not done, by decision (2026-09-15): the multiple_permissive_policies WARN on
-- treks and the two unused_index INFOs. "company members view own treks" is
-- load-bearing (0002 §A — INSERT … RETURNING cannot pass without it) and
-- Postgres already ORs permissive policies, so merging saves no work; the two
-- indexes read as unused because the tables hold single-digit rows and the
-- planner seq-scans regardless. PERFORMANCE.md §4.4 carries both.

-- ---- 1. policies — auth.uid() / auth.role() as an InitPlan -------------------

-- company_members (0001)
drop policy if exists "company admins manage member roles" on public.company_members;
create policy "company admins manage member roles" on public.company_members for update to authenticated
using (
  public.is_company_admin(company_id)
  and public.is_company_writable(company_id)
  and role <> 'owner'
  and user_id <> (select auth.uid())
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
  and user_id <> (select auth.uid())
);

-- conversation_messages (0001, 0010)
drop policy if exists "Delete own messages" on public.conversation_messages;
create policy "Delete own messages" on public.conversation_messages for delete to public
using (user_id = (select auth.uid()));

drop policy if exists "Edit own messages" on public.conversation_messages;
create policy "Edit own messages" on public.conversation_messages for update to public
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()) and is_announcement = false);

drop policy if exists "Send messages" on public.conversation_messages;
create policy "Send messages" on public.conversation_messages
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and is_chat_participant(conversation_id)
    and is_announcement = false
    and coalesce(is_deleted, false) = false
  );

-- conversation_participants (0001, 0019)
drop policy if exists "System adds participants" on public.conversation_participants;
create policy "System adds participants" on public.conversation_participants for insert to public
with check ((select auth.role()) = 'service_role');

drop policy if exists "Users can leave conversation" on public.conversation_participants;
create policy "Users can leave conversation" on public.conversation_participants for delete to public
using (
  user_id = (select auth.uid())
  and not exists (
    select 1
      from public.conversations c
      join public.trek_participants tp on tp.batch_id = c.batch_id
     where c.id = conversation_participants.conversation_id
       and tp.user_id = (select auth.uid())
       and tp.status = 'confirmed'
  )
);

-- favorites (0001)
drop policy if exists "Users can favorite treks" on public.favorites;
create policy "Users can favorite treks" on public.favorites for insert to authenticated
  with check ((select auth.uid()) = user_id and public.is_trekker());

drop policy if exists "Users can remove favorites" on public.favorites;
create policy "Users can remove favorites" on public.favorites for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can see their favorites" on public.favorites;
create policy "Users can see their favorites" on public.favorites for select to authenticated
using ((select auth.uid()) = user_id);

-- profiles (0001)
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles for select to authenticated
using ((select auth.uid()) = id);

-- trek_participants (0001, 0021)
drop policy if exists "Users can join treks" on public.trek_participants;
create policy "Users can join treks" on public.trek_participants for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and public.is_trekker()
    and exists (
      select 1 from public.trek_batches tb
      where tb.id = trek_participants.batch_id
        and public.is_trek_bookable(tb.trek_id)
    )
  );

drop policy if exists "Users can leave treks" on public.trek_participants;
create policy "Users can leave treks" on public.trek_participants for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can view own trek participation" on public.trek_participants;
create policy "Users can view own trek participation" on public.trek_participants for select to authenticated
using (user_id = (select auth.uid()));

-- trek_reviews (0001, 0018)
drop policy if exists "Users can delete their own reviews" on public.trek_reviews;
create policy "Users can delete their own reviews" on public.trek_reviews for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can review treks they joined" on public.trek_reviews;
create policy "Users can review treks they joined" on public.trek_reviews for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
      from public.trek_participants tp
      join public.trek_batches tb on tb.id = tp.batch_id
      join public.treks t on t.id = tb.trek_id
     where tp.user_id = (select auth.uid())
       and tp.status = 'confirmed'
       and tb.trek_id = trek_reviews.trek_id
       and tb.batch_date
           + (greatest(1, ceil(coalesce(t.duration_hours, 0) / 24.0))::int - 1)
           < current_date
  )
);

drop policy if exists "Users can update their own reviews" on public.trek_reviews;
create policy "Users can update their own reviews" on public.trek_reviews for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
      from public.trek_participants tp
      join public.trek_batches tb on tb.id = tp.batch_id
      join public.treks t on t.id = tb.trek_id
     where tp.user_id = (select auth.uid())
       and tp.status = 'confirmed'
       and tb.trek_id = trek_reviews.trek_id
       and tb.batch_date
           + (greatest(1, ceil(coalesce(t.duration_hours, 0) / 24.0))::int - 1)
           < current_date
  )
);

-- user_achievements, user_monthly_activity, user_stats (0001)
drop policy if exists "Users can view own achievements" on public.user_achievements;
create policy "Users can view own achievements" on public.user_achievements for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can view their own activity" on public.user_monthly_activity;
create policy "Users can view their own activity" on public.user_monthly_activity for select to public
using ((select auth.uid()) = user_id);

drop policy if exists "Users can view own stats" on public.user_stats;
create policy "Users can view own stats" on public.user_stats for select to authenticated
using ((select auth.uid()) = user_id);

-- ---- 2. primary keys — promote the existing unique, don't add a twin --------
-- Guarded on the PK so a second paste is a no-op; the drop and the add are one
-- ALTER so the table is never without a unique index on the pair.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversation_participants'::regclass and contype = 'p'
  ) then
    alter table public.conversation_participants
      drop constraint conversation_participants_conv_user_key,
      add primary key (conversation_id, user_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.favorites'::regclass and contype = 'p'
  ) then
    alter table public.favorites
      drop constraint favorites_user_id_trek_id_key,
      add primary key (user_id, trek_id);
  end if;
end $$;

-- ---- 3. the two foreign keys with no covering index -------------------------
create index if not exists companies_approved_by_idx
  on public.companies (approved_by);
create index if not exists company_invites_invited_by_idx
  on public.company_invites (invited_by);

insert into supabase_migrations.schema_migrations (version, name)
values ('0025', 'evaluate-auth-uid-once-per-query-and-add-the-missing-keys')
on conflict (version) do nothing;
