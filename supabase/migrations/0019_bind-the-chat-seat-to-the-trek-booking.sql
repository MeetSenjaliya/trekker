-- 0019 — leaving a trek drops the chat seat, in the same transaction
--
-- Joining is one atomic RPC (join_trek_and_chat): it writes the trek_participants
-- row and, for a 'confirmed' joiner, the conversation_participants row together.
-- Leaving was two independent client deletes in leaveTrek() — chat first, then
-- booking — with nothing in the database tying them to each other:
--
--   * delete only the trek_participants row (a plain PostgREST call, which the
--     "Users can leave treks" policy allows) and the chat seat survives. The
--     leaver keeps reading the group indefinitely — they are gone from the
--     roster, so nobody has a reason to look for them; and
--   * when the chat delete failed, the client logged the error and removed the
--     booking anyway, reaching the same state by accident.
--
-- promote_waitlist_on_leave() already holds the other half of the invariant:
-- confirmed ⇔ in the chat. It promotes FIFO on a leave and adds the promoted
-- user to the conversation. So the rule exists in the schema; only the leave
-- side of it was left to the browser to honour.
--
-- Fixed with a trigger rather than a leave RPC. A trigger covers the direct
-- table DELETE the RLS policy still permits, so the guarantee does not depend on
-- the client picking the right write path — the same reasoning that put the
-- join rate limit in a row trigger instead of inside join_trek_and_chat (§13.3).

-- ---- The bind: booking row goes → chat seat goes -----------------------------
-- Unconditional, not gated on old.status = 'confirmed'. A waitlisted row has no
-- chat seat, so the delete is a harmless no-op there, and staying unconditional
-- means any seat that has drifted out of sync gets cleaned up on the way out.
-- SECURITY DEFINER: the leaver cannot be required to hold a delete grant on
-- conversation_participants, and after 0019 the RLS policy below denies it to
-- them anyway. Same pattern as promote_waitlist_on_leave(), which inserts into
-- this table past an insert policy that only admits service_role.
create or replace function public.leave_chat_on_trek_leave()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.conversation_participants cp
  using public.conversations c
  where c.batch_id = old.batch_id
    and cp.conversation_id = c.id
    and cp.user_id = old.user_id;

  return old;
end;
$$;

-- Trigger-only, like the other four AFTER-DELETE functions on this table.
revoke execute on function public.leave_chat_on_trek_leave() from public, anon, authenticated;

-- Fires before trek_participants_waitlist_promote (triggers run in name order,
-- 'c' < 'w'). The two touch different users — this one the leaver, that one the
-- promoted joiner — so the order is not load-bearing, only stated.
drop trigger if exists trek_participants_chat_leave on public.trek_participants;
create trigger trek_participants_chat_leave
  after delete on public.trek_participants
  for each row execute function public.leave_chat_on_trek_leave();

-- ---- The mirror: a confirmed booking pins the chat seat ----------------------
-- The same split ran the other way. "Users can leave conversation" let a user
-- delete their own conversation_participants row while their booking stayed
-- 'confirmed', and re-joining does not repair it: join_trek_and_chat() returns
-- the existing membership untouched when a trek_participants row is already
-- there, so it never re-inserts the seat. That locked a paying participant out
-- of their own trek's chat permanently, with no route back through the UI.
--
-- After this, the only exit from a batch chat is leaving the batch, which the
-- trigger above turns into both deletes at once. The policy still admits the
-- rows with no confirmed booking behind them — a waitlisted user's stray seat,
-- or one left over from a batch the user has already left.
--
-- Left `to public` to keep the role scope of the original policy; anon cannot
-- satisfy user_id = auth.uid() with a NULL auth.uid() regardless.
--
-- RLS applies inside this qual, and both referenced rows are visible to the
-- caller: trek_participants by `user_id = auth.uid()` (the row is theirs), and
-- conversations by is_chat_participant(id), which is true precisely because the
-- conversation_participants row being deleted still exists during the check.
drop policy if exists "Users can leave conversation" on public.conversation_participants;
create policy "Users can leave conversation" on public.conversation_participants for delete to public
using (
  user_id = auth.uid()
  and not exists (
    select 1
      from public.conversations c
      join public.trek_participants tp on tp.batch_id = c.batch_id
     where c.id = conversation_participants.conversation_id
       and tp.user_id = auth.uid()
       and tp.status = 'confirmed'
  )
);

insert into supabase_migrations.schema_migrations (version, name)
values ('0019', 'bind-the-chat-seat-to-the-trek-booking')
on conflict (version) do nothing;
