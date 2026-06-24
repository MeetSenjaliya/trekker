-- Review follow-ups #1, #2, #3, #5 — correctness fixes (2026-06-22)
-- Apply in Supabase SQL editor. Re-runnable (CREATE OR REPLACE; grants are preserved).
-- Mirrors supabase/schema.sql. Safe to delete this file after applying.

-- #1 — update_participants_count(): denormalised counter excludes waitlisted
create or replace function public.update_participants_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch_id uuid := coalesce(new.batch_id, old.batch_id);
  v_trek_id  uuid;
begin
  select trek_id into v_trek_id
  from public.trek_batches
  where id = v_batch_id;

  if v_trek_id is not null then
    update public.treks
    set participants_joined = (
      select count(*)
      from public.trek_participants tp
      join public.trek_batches tb on tb.id = tp.batch_id
      where tb.trek_id = v_trek_id
        and tp.status = 'confirmed'
    )
    where id = v_trek_id;
  end if;

  return coalesce(new, old);
end;
$$;

-- #2 — recompute_user_stats(): stats count only confirmed participations
create or replace function public.recompute_user_stats(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_stats as us (user_id, treks_completed, total_distance_km)
  select
    p_user_id,
    coalesce(count(*) filter (where tb.batch_date < current_date), 0),
    coalesce(sum(t.distance_km) filter (where tb.batch_date < current_date), 0)
  from public.trek_participants tp
  join public.trek_batches tb on tb.id = tp.batch_id
  join public.treks t        on t.id  = tb.trek_id
  where tp.user_id = p_user_id
    and tp.status = 'confirmed'
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
    where tp.user_id = p_user_id and tb.batch_date < current_date
      and tp.status = 'confirmed'
  ) m
  group by m.month
  having sum(m.treks_joined) <> 0 or sum(m.photos_shared) <> 0
      or sum(m.reviews_written) <> 0 or sum(m.distance_km) <> 0;

  -- Evaluate badges off the freshly-computed source metrics.
  perform public.award_user_achievements(p_user_id);
end;
$$;
revoke all on function public.recompute_user_stats(uuid) from public, anon, authenticated;

-- #2 — award_user_achievements(): badges count only confirmed participations
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
begin
  select
    coalesce(count(*), 0),
    coalesce(count(*) filter (where tb.batch_date < current_date), 0),
    coalesce(sum(t.distance_km) filter (where tb.batch_date < current_date), 0),
    coalesce(count(distinct t.location) filter (where tb.batch_date < current_date), 0),
    coalesce(count(*) filter (where tb.batch_date < current_date
                                and t.difficulty in ('Hard', 'Expert')), 0),
    coalesce(count(distinct date_trunc('month', tb.batch_date))
               filter (where tb.batch_date < current_date), 0)
  into v_joined, v_completed, v_distance, v_locations, v_hard, v_months
  from public.trek_participants tp
  join public.trek_batches tb on tb.id = tp.batch_id
  join public.treks t        on t.id  = tb.trek_id
  where tp.user_id = p_user_id
    and tp.status = 'confirmed';

  select
    coalesce(count(*), 0),
    coalesce(sum(coalesce(array_length(r.photo_urls, 1), 0)), 0)
  into v_reviews, v_photos
  from public.trek_reviews r
  where r.user_id = p_user_id;

  insert into public.user_achievements (user_id, achievement_key)
  select p_user_id, c.key
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
  ) as c(key, earned)
  where c.earned
  on conflict (user_id, achievement_key) do nothing;
end;
$$;
revoke all on function public.award_user_achievements(uuid) from public, anon, authenticated;

-- #3 — search_treks(): punctuation-only search returns no matches, not all
create or replace function public.search_treks(
  p_search       text    default null,
  p_location     text    default null,
  p_difficulty   text    default null,
  p_min_distance numeric default null,
  p_max_distance numeric default null,
  p_min_price    numeric default null,
  p_max_price    numeric default null,
  p_date_from    date    default null,
  p_sort         text    default 'date',
  p_limit        int     default 6,
  p_offset       int     default 0
)
returns table (
  id                  uuid,
  title               text,
  description         text,
  location            text,
  cover_image_url     text,
  difficulty          public.difficulty,
  distance_km         numeric,
  duration_hours      numeric,
  max_participants    integer,
  estimated_cost      numeric,
  rating              numeric,
  participants_joined smallint,
  next_batch_date     date,
  total_count         bigint
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_str        text;
  v_tsquery    tsquery := null;
  v_has_search boolean := false;
begin
  -- Build a prefix tsquery: "base camp" -> 'base:* & camp:*'. Strip anything
  -- that isn't a letter/digit/space so user input can't break to_tsquery.
  if p_search is not null and length(trim(p_search)) > 0 then
    v_has_search := true;
    v_str := (
      select string_agg(tok || ':*', ' & ')
      from unnest(
        string_to_array(
          regexp_replace(lower(trim(p_search)), '[^a-z0-9 ]', ' ', 'g'),
          ' ')
      ) as tok
      where tok <> ''
    );
    if v_str is not null and length(v_str) > 0 then
      v_tsquery := to_tsquery('english', v_str);
    end if;
  end if;

  return query
  with filtered as (
    select
      t.id, t.title, t.description, t.location, t.cover_image_url, t.difficulty,
      t.distance_km, t.duration_hours, t.max_participants, t.estimated_cost,
      rr.avg_rating as rating, t.participants_joined,
      nb.next_batch_date,
      case when v_tsquery is not null then ts_rank(t.fts, v_tsquery) else 0 end as rank
    from public.treks t
    left join lateral (
      select min(b.batch_date) as next_batch_date
      from public.trek_batches b
      where b.trek_id = t.id
        and b.batch_date >= coalesce(p_date_from, current_date)
    ) nb on true
    -- Real ratings rollup: average of trek_reviews.rating (null when no reviews,
    -- so the card's rating badge hides). Replaces the static treks.rating column.
    left join lateral (
      select round(avg(r.rating), 1) as avg_rating
      from public.trek_reviews r
      where r.trek_id = t.id
    ) rr on true
    where
      -- A non-empty search that sanitizes to nothing (e.g. "!!!") leaves
      -- v_tsquery null: treat it as "no matches", not "no filter".
      (not v_has_search or (v_tsquery is not null and t.fts @@ v_tsquery))
      and (p_location     is null or t.location ilike '%' || p_location || '%')
      and (p_difficulty   is null or t.difficulty::text = p_difficulty)
      and (p_min_distance is null or t.distance_km    >= p_min_distance)
      and (p_max_distance is null or t.distance_km    <= p_max_distance)
      and (p_min_price    is null or t.estimated_cost >= p_min_price)
      and (p_max_price    is null or t.estimated_cost <= p_max_price)
      and (p_date_from    is null or nb.next_batch_date is not null)
  )
  select
    f.id, f.title, f.description, f.location, f.cover_image_url, f.difficulty,
    f.distance_km, f.duration_hours, f.max_participants, f.estimated_cost,
    f.rating, f.participants_joined, f.next_batch_date,
    count(*) over () as total_count
  from filtered f
  order by
    case when p_sort = 'relevance'     then f.rank           end desc nulls last,
    case when p_sort = 'price_asc'     then f.estimated_cost end asc  nulls last,
    case when p_sort = 'price_desc'    then f.estimated_cost end desc nulls last,
    case when p_sort = 'distance_asc'  then f.distance_km    end asc  nulls last,
    case when p_sort = 'distance_desc' then f.distance_km    end desc nulls last,
    case when p_sort = 'rating'        then f.rating         end desc nulls last,
    case when p_sort = 'date'          then f.next_batch_date end asc nulls last,
    f.title asc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

grant execute on function public.search_treks(
  text, text, text, numeric, numeric, numeric, numeric, date, text, int, int
) to anon, authenticated;

-- #5 — join_trek_and_chat(): waitlist_position tie-breaks by id
create or replace function public.join_trek_and_chat(
  p_user_id uuid,
  p_trek_id uuid,
  p_batch_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch_id uuid;
  v_convo_id uuid;
  v_participant_id uuid;
  v_trek_title text;
  v_trek_max integer;
  v_batch_max integer;
  v_confirmed integer;
  v_status text;
  v_position integer := null;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  -- Require the caller to act as themselves (closes the NULL p_user_id bypass).
  if p_user_id is null or p_user_id <> v_uid then
    raise exception 'p_user_id must equal the authenticated user';
  end if;

  -- Bound batch/conversation creation (DoS guard).
  if p_batch_date is null then
    raise exception 'Batch date is required';
  end if;
  if p_batch_date < current_date - interval '1 day' then
    raise exception 'Cannot join a trek batch in the past';
  end if;
  if p_batch_date > current_date + interval '1 year' then
    raise exception 'Batch date is too far in the future';
  end if;

  select title, max_participants into v_trek_title, v_trek_max
  from public.treks where id = p_trek_id;
  if v_trek_title is null then
    raise exception 'Trek not found';
  end if;

  insert into public.trek_batches (trek_id, batch_date, max_participants)
  values (p_trek_id, p_batch_date, v_trek_max)
  on conflict (trek_id, batch_date) do nothing
  returning id into v_batch_id;
  if v_batch_id is null then
    select id into v_batch_id from public.trek_batches
    where trek_id = p_trek_id and batch_date = p_batch_date limit 1;
  end if;

  -- Lock the batch row so concurrent joins serialize on the capacity check.
  select max_participants into v_batch_max
  from public.trek_batches where id = v_batch_id for update;

  insert into public.conversations (batch_id, name)
  values (v_batch_id, (v_trek_title || ' — ' || p_batch_date::text))
  on conflict (batch_id) do nothing
  returning id into v_convo_id;
  if v_convo_id is null then
    select id into v_convo_id from public.conversations
    where batch_id = v_batch_id limit 1;
  end if;

  -- Already a participant? Return the existing membership unchanged.
  select id, status into v_participant_id, v_status
  from public.trek_participants
  where user_id = v_uid and batch_id = v_batch_id;

  if v_participant_id is null then
    select count(*) into v_confirmed
    from public.trek_participants
    where batch_id = v_batch_id and status = 'confirmed';

    if v_batch_max is not null and v_confirmed >= v_batch_max then
      v_status := 'waitlisted';
    else
      v_status := 'confirmed';
    end if;

    insert into public.trek_participants (user_id, batch_id, status)
    values (v_uid, v_batch_id, v_status)
    returning id into v_participant_id;

    -- Only confirmed participants get a seat in the batch chat.
    if v_status = 'confirmed' then
      insert into public.conversation_participants (conversation_id, user_id)
      values (v_convo_id, v_uid)
      on conflict (conversation_id, user_id) do nothing;
    end if;
  end if;

  if v_status = 'waitlisted' then
    select count(*) into v_position
    from public.trek_participants
    where batch_id = v_batch_id
      and status = 'waitlisted'
      and (joined_at, id) <= (
        select joined_at, id from public.trek_participants where id = v_participant_id
      );
  end if;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'participant_id', v_participant_id,
    'conversation_id', v_convo_id,
    'status', v_status,
    'waitlist_position', v_position
  );
end;
$$;
