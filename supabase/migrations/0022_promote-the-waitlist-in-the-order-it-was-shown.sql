-- 0022 — promote the waitlist in the order the waitlist was shown
--
-- Two orderings of the same queue disagreed on ties. join_trek_and_chat()
-- computes the number it hands the joiner ("you are #2") with a row comparison,
-- `(joined_at, id) <= (…)` — follow-up #5 gave it that tie-break precisely
-- because joined_at is not unique. promote_waitlist_on_leave() never got the
-- same treatment: it ordered by joined_at alone, so among rows sharing a
-- timestamp it promoted whatever the plan happened to return first.
--
-- joined_at ties are not exotic. 0020 pins the column to now(), which is the
-- transaction timestamp, so two joins in one transaction are exactly equal, and
-- two joins a microsecond apart are equal often enough on a busy departure.
-- When they tie, #2 can be promoted ahead of #1 — the position the app showed
-- them was never a promise the trigger was keeping.
--
-- The fix is the tie-break, nothing else: the body below is 0001's, with
-- `, id asc` added to the ORDER BY. The two functions now read the queue the
-- same way, and (joined_at, id) is unique because id is.
create or replace function public.promote_waitlist_on_leave()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max integer;
  v_confirmed integer;
  v_promote_id uuid;
  v_promote_user uuid;
  v_convo_id uuid;
begin
  if old.status is distinct from 'confirmed' then
    return old;
  end if;

  select max_participants into v_max
  from public.trek_batches where id = old.batch_id;
  if v_max is null then
    return old;
  end if;

  select count(*) into v_confirmed
  from public.trek_participants
  where batch_id = old.batch_id and status = 'confirmed';
  if v_confirmed >= v_max then
    return old;
  end if;

  select id, user_id into v_promote_id, v_promote_user
  from public.trek_participants
  where batch_id = old.batch_id and status = 'waitlisted'
  order by joined_at asc, id asc
  limit 1
  for update skip locked;
  if v_promote_id is null then
    return old;
  end if;

  update public.trek_participants
  set status = 'confirmed'
  where id = v_promote_id;

  select id into v_convo_id
  from public.conversations where batch_id = old.batch_id limit 1;
  if v_convo_id is not null then
    insert into public.conversation_participants (conversation_id, user_id)
    values (v_convo_id, v_promote_user)
    on conflict (conversation_id, user_id) do nothing;
  end if;

  return old;
end;
$$;

-- create or replace preserves the ACL; restated so the grant state is visible
-- here rather than only in 0001.
revoke execute on function public.promote_waitlist_on_leave() from public, anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('0022', 'promote-the-waitlist-in-the-order-it-was-shown')
on conflict (version) do nothing;
