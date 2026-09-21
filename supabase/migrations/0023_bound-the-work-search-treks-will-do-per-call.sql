-- 0023 — bound the work search_treks() will do per call
--
-- search_treks() is the one RPC anyone with the publishable key may call
-- without signing in, and until now it took p_limit and p_offset at face value:
-- `limit greatest(p_limit, 0)` clamps a negative to zero and nothing else. A
-- caller asking for p_limit = 2147483647 got the whole catalogue in one
-- response, every row carrying the window count, the per-trek rating average
-- and the next-batch lookup — the full cost of the page, multiplied by a number
-- the caller chose. That is a request whose cost is unbounded by anything the
-- server decided, which is exactly what a public endpoint must not offer, and
-- it is the same class of hole 0009 closed on the write side by capping text
-- columns the client was free to size.
--
-- The catalogue is fourteen treks today, so no single call hurts yet. The bound
-- matters because it is the *shape* of the request that decides how the cost
-- grows: with a ceiling, the largest legal call is a known quantity and the
-- catalogue can grow without the endpoint's worst case growing with it.
--
-- 100 is the app's own ceiling already — getStorefrontTreks() asks for exactly
-- that, the Explore page asks for 6 and the home page for 3 — so no caller
-- changes and no legitimate request is refused. p_offset gets a ceiling too, so
-- a deep offset cannot ask the sort to produce and discard an arbitrary prefix;
-- 10 000 is over 1 600 Explore pages, far past any page the UI can render.
--
-- This is a bound on per-call work, NOT a rate limit. A caller can still make
-- the call as often as they like; each one now costs at most a known amount.
-- Per-caller rate limiting on an anon read cannot be built inside Postgres —
-- there is no actor to key it on — it lives at the edge (Supabase platform
-- limits or a WAF in front of the project host), which is an infrastructure
-- decision, not a migration.
--
-- The body below is 0001's; only the LIMIT and OFFSET lines changed.
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
  p_offset       int     default 0,
  p_company_id   uuid    default null
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
  company_id          uuid,
  company_name        text,
  company_slug        text,
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
      c.id as company_id, c.name as company_name, c.slug as company_slug,
      case when v_tsquery is not null then ts_rank(t.fts, v_tsquery) else 0 end as rank
    from public.treks t
    join public.companies c on c.id = t.company_id
    left join lateral (
      select min(b.batch_date) as next_batch_date
      from public.trek_batches b
      where b.trek_id = t.id
        and b.batch_date >= coalesce(p_date_from, current_date)
    ) nb on true
    left join lateral (
      select round(avg(r.rating), 1) as avg_rating
      from public.trek_reviews r
      where r.trek_id = t.id
    ) rr on true
    where
      t.is_active and c.status = 'approved'
      and (not v_has_search or (v_tsquery is not null and t.fts @@ v_tsquery))
      and (p_location     is null or t.location ilike '%' || p_location || '%')
      and (p_difficulty   is null or t.difficulty::text = p_difficulty)
      and (p_min_distance is null or t.distance_km    >= p_min_distance)
      and (p_max_distance is null or t.distance_km    <= p_max_distance)
      and (p_min_price    is null or t.estimated_cost >= p_min_price)
      and (p_max_price    is null or t.estimated_cost <= p_max_price)
      and (p_date_from    is null or nb.next_batch_date is not null)
      and (p_company_id   is null or t.company_id = p_company_id)
  )
  select
    f.id, f.title, f.description, f.location, f.cover_image_url, f.difficulty,
    f.distance_km, f.duration_hours, f.max_participants, f.estimated_cost,
    f.rating, f.participants_joined, f.next_batch_date,
    f.company_id, f.company_name, f.company_slug,
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
  limit  least(greatest(p_limit,  0), 100)
  offset least(greatest(p_offset, 0), 10000);
end;
$$;

-- create or replace preserves the ACL; restated so the grant state is visible
-- here rather than only in 0001. Still the one anon-callable read RPC.
grant execute on function public.search_treks(
  text, text, text, numeric, numeric, numeric, numeric, date, text, int, int, uuid
) to anon, authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('0023', 'bound-the-work-search-treks-will-do-per-call')
on conflict (version) do nothing;
