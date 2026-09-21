-- 0026 — user_completed_treks says "completed" the way 0020 does
--
-- 0020 changed what a completed trek is for recompute_user_stats() and
-- award_user_achievements(): the booking is confirmed, the trek has ended
-- (batch_date plus the whole days it spans, minus one, is before today) and
-- the booking predates departure. This view kept 0001's bare
-- `batch_date < current_date`, which both banks a multi-day trek mid-trip and
-- counts a waitlisted row. Nothing in src/ reads it and no client role holds
-- SELECT on it, so the disagreement was invisible — and it would have become
-- a bug the day something started reading it. The predicate below is the CTE
-- from 0020, verbatim.
--
-- ⚠️ That expression now lives in three places: the 0018 review policies, the
-- 0020 functions, and here. Change all three together.
--
-- Also records a drift: the live view carries security_invoker = on, which no
-- migration ever set (0001 creates it bare). Stated here so the file matches
-- production and a rebuild gets the same view. No grant is added — the view
-- stays unreadable from a client session, exactly as it is today.
create or replace view public.user_completed_treks
with (security_invoker = on) as
  select tp.user_id,
         t.id           as trek_id,
         t.title,
         t.cover_image_url,
         tb.batch_date,
         tb.id          as batch_id
  from public.trek_participants tp
  join public.trek_batches tb on tp.batch_id = tb.id
  join public.treks t        on tb.trek_id  = t.id
  where tp.status = 'confirmed'
    and tb.batch_date
        + (greatest(1, ceil(coalesce(t.duration_hours, 0) / 24.0))::int - 1)
        < current_date
    and coalesce(tp.joined_at::date, tb.batch_date) <= tb.batch_date
  order by tb.batch_date desc;

insert into supabase_migrations.schema_migrations (version, name)
values ('0026', 'define-completed-in-user-completed-treks-as-0020-does')
on conflict (version) do nothing;
