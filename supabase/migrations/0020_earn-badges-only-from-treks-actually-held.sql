-- 0020 — badges must reflect treks the user actually held, not treks they touched
--
-- Three defects compounded into free badges. Reproduced end to end: joining one
-- yesterday-dated 500 km Expert trek granted trailblazer, first_steps,
-- warming_up, centurion, ultra_explorer and peak_conqueror in a single
-- statement; leaving reset user_stats to 0/0 and left all six in place.
--
--   1. "Completed" was `batch_date < current_date`, and join_trek_and_chat
--      accepts `current_date - 1 day` (UTC/IST slack). So a batch could be
--      completed at the instant it was joined. That same predicate also counted
--      a multi-day trek mid-trip — the bug 0018 fixed for reviews and did not
--      reach these two functions.
--
--   2. joined_at was client input. The "Users can join treks" policy checks only
--      `auth.uid() = user_id and is_trekker()`, so a direct PostgREST insert
--      could set joined_at to any timestamp (verified: 400 days back accepted).
--      Any gate reading joined_at is worthless until the column is pinned.
--      UPDATE was already impossible — no UPDATE policy on the table — so
--      pinning INSERT is enough to make it a system timestamp.
--
--   3. award_user_achievements only ever inserted. Badges were a high-water mark
--      over metrics the user can reset at will by leaving, so the cost of a
--      badge was one join + one leave, and the badge outlived the evidence.
--      That also let the profile page show ultra_explorer beside 0 km.
--
-- The fix makes a badge a pure function of the bookings held right now: a
-- participation counts once the trek has ENDED and the booking predates its
-- departure, and badges that no longer qualify are taken back. Farming now
-- requires holding the qualifying bookings — which is the honest state.
--
-- Not addressed here (pre-existing, wider than gamification): that same INSERT
-- policy also lets a client write status = 'confirmed' directly, bypassing the
-- capacity/waitlist logic in join_trek_and_chat. Tracked in FEATURES.md §1.5.

-- ---- 1. joined_at is a system timestamp, not client input --------------------
create or replace function public.pin_participant_joined_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.joined_at := now();
  return new;
end;
$$;

drop trigger if exists trek_participants_pin_joined_at on public.trek_participants;
create trigger trek_participants_pin_joined_at
  before insert on public.trek_participants
  for each row execute function public.pin_participant_joined_at();

revoke all on function public.pin_participant_joined_at() from public, anon, authenticated;

-- ---- 2. recompute_user_stats — count only treks that ended ------------------
-- The completed set is derived once in a CTE rather than repeating the end-date
-- expression per aggregate. `joined_at is null` is legacy data (the column has
-- always defaulted to now() and is now pinned); those rows keep counting so a
-- real user's history is not silently zeroed.
create or replace function public.recompute_user_stats(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  with completed as (
    select tb.batch_date, t.distance_km
    from public.trek_participants tp
    join public.trek_batches tb on tb.id = tp.batch_id
    join public.treks t        on t.id  = tb.trek_id
    where tp.user_id = p_user_id
      and tp.status = 'confirmed'
      and tb.batch_date
          + (greatest(1, ceil(coalesce(t.duration_hours, 0) / 24.0))::int - 1)
          < current_date
      and coalesce(tp.joined_at::date, tb.batch_date) <= tb.batch_date
  )
  insert into public.user_stats as us (user_id, treks_completed, total_distance_km)
  select p_user_id,
         coalesce(count(*), 0),
         coalesce(sum(distance_km), 0)
  from completed
  on conflict (user_id) do update set
    treks_completed   = excluded.treks_completed,
    total_distance_km = excluded.total_distance_km;

  delete from public.user_monthly_activity where user_id = p_user_id;

  insert into public.user_monthly_activity
    (user_id, month, treks_joined, photos_shared, reviews_written, distance_km)
  select p_user_id, m.month,
         sum(m.treks_joined), sum(m.photos_shared),
         sum(m.reviews_written), sum(m.distance_km)
  from (
    select date_trunc('month', tp.joined_at)::date as month,
           1 treks_joined, 0 photos_shared, 0 reviews_written, 0::numeric distance_km
    from public.trek_participants tp
    where tp.user_id = p_user_id and tp.joined_at is not null
      and tp.status = 'confirmed'
    union all
    select date_trunc('month', r.created_at)::date,
           0, coalesce(array_length(r.photo_urls, 1), 0), 1, 0
    from public.trek_reviews r
    where r.user_id = p_user_id
    union all
    select date_trunc('month', tb.batch_date)::date,
           0, 0, 0, coalesce(t.distance_km, 0)
    from public.trek_participants tp
    join public.trek_batches tb on tb.id = tp.batch_id
    join public.treks t        on t.id  = tb.trek_id
    where tp.user_id = p_user_id
      and tp.status = 'confirmed'
      and tb.batch_date
          + (greatest(1, ceil(coalesce(t.duration_hours, 0) / 24.0))::int - 1)
          < current_date
      and coalesce(tp.joined_at::date, tb.batch_date) <= tb.batch_date
  ) m
  group by m.month
  having sum(m.treks_joined) <> 0 or sum(m.photos_shared) <> 0
      or sum(m.reviews_written) <> 0 or sum(m.distance_km) <> 0;

  -- Evaluate badges off the freshly-computed source metrics.
  perform public.award_user_achievements(p_user_id);
end;
$$;
revoke all on function public.recompute_user_stats(uuid) from public, anon, authenticated;

-- ---- 3. award_user_achievements — reconcile, do not accumulate ---------------
-- Same completed set as above. The catalog is evaluated once into two arrays so
-- one list of thresholds drives both the insert and the delete, and a key this
-- function does not own can never be removed by it.
create or replace function public.award_user_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_joined    integer := 0;
  v_completed integer := 0;
  v_distance  numeric := 0;
  v_locations integer := 0;
  v_hard      integer := 0;
  v_months    integer := 0;
  v_reviews   integer := 0;
  v_photos    integer := 0;
  v_earned    text[];
  v_all       text[];
begin
  select coalesce(count(*), 0)
  into v_joined
  from public.trek_participants tp
  where tp.user_id = p_user_id
    and tp.status = 'confirmed';

  with completed as (
    select tb.batch_date, t.distance_km, t.location, t.difficulty
    from public.trek_participants tp
    join public.trek_batches tb on tb.id = tp.batch_id
    join public.treks t        on t.id  = tb.trek_id
    where tp.user_id = p_user_id
      and tp.status = 'confirmed'
      and tb.batch_date
          + (greatest(1, ceil(coalesce(t.duration_hours, 0) / 24.0))::int - 1)
          < current_date
      and coalesce(tp.joined_at::date, tb.batch_date) <= tb.batch_date
  )
  select
    coalesce(count(*), 0),
    coalesce(sum(distance_km), 0),
    coalesce(count(distinct location), 0),
    coalesce(count(*) filter (where difficulty in ('Hard', 'Expert')), 0),
    coalesce(count(distinct date_trunc('month', batch_date)), 0)
  into v_completed, v_distance, v_locations, v_hard, v_months
  from completed;

  select
    coalesce(count(*), 0),
    coalesce(sum(coalesce(array_length(r.photo_urls, 1), 0)), 0)
  into v_reviews, v_photos
  from public.trek_reviews r
  where r.user_id = p_user_id;

  -- One catalog, two uses: v_all is every key this function owns, v_earned the
  -- subset currently qualifying. The delete is scoped to v_all so a key written
  -- by anything else is never touched.
  select array_agg(c.key) filter (where c.earned), array_agg(c.key)
  into v_earned, v_all
  from (values
    ('trailblazer',      v_joined    >= 1),
    ('first_steps',      v_completed >= 1),
    ('trail_regular',    v_completed >= 5),
    ('seasoned_trekker', v_completed >= 10),
    ('mountain_master',  v_completed >= 25),
    ('trail_legend',     v_completed >= 50),
    ('warming_up',       v_distance  >= 10),
    ('centurion',        v_distance  >= 100),
    ('ultra_explorer',   v_distance  >= 500),
    ('explorer',         v_locations >= 5),
    ('globetrotter',     v_locations >= 10),
    ('peak_conqueror',   v_hard      >= 1),
    ('dedicated',        v_months    >= 6),
    ('storyteller',      v_reviews   >= 5),
    ('shutterbug',       v_photos    >= 25)
  ) as c(key, earned);

  v_earned := coalesce(v_earned, '{}');

  insert into public.user_achievements (user_id, achievement_key)
  select p_user_id, k from unnest(v_earned) k
  on conflict (user_id, achievement_key) do nothing;

  -- Badges are a function of the metrics, not a high-water mark: what leaving
  -- un-earns, leaving takes back.
  delete from public.user_achievements a
  where a.user_id = p_user_id
    and a.achievement_key = any(v_all)
    and not (a.achievement_key = any(v_earned));
end;
$$;
revoke all on function public.award_user_achievements(uuid) from public, anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('0020', 'earn-badges-only-from-treks-actually-held')
on conflict (version) do nothing;
