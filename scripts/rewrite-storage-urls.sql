-- One-off: point every stored image URL at R2 instead of Supabase Storage.
-- Paste into the SQL Editor AFTER scripts/migrate-storage-to-r2.mjs reports
-- 0 copied for every bucket. Not a migration — the prefixes are environment
-- data and would otherwise land in the generated schema.sql.
--
-- Replace <R2_PUBLIC> with NEXT_PUBLIC_R2_PUBLIC_URL (no trailing slash).
-- The key layout is identical on both sides, so this is a prefix swap.

begin;

create temp table prefixes as
select 'https://dtjmyqogeozrzzbdjokr.supabase.co/storage/v1/object/public/'::text as old_prefix,
       '<R2_PUBLIC>/'::text                                                    as new_prefix;

update public.profiles p
   set avatar_url = replace(p.avatar_url, x.old_prefix, x.new_prefix)
  from prefixes x
 where p.avatar_url like x.old_prefix || '%';

update public.treks t
   set cover_image_url = replace(t.cover_image_url, x.old_prefix, x.new_prefix)
  from prefixes x
 where t.cover_image_url like x.old_prefix || '%';

update public.companies c
   set logo_url = replace(c.logo_url, x.old_prefix, x.new_prefix)
  from prefixes x
 where c.logo_url like x.old_prefix || '%';

update public.companies c
   set cover_image_url = replace(c.cover_image_url, x.old_prefix, x.new_prefix)
  from prefixes x
 where c.cover_image_url like x.old_prefix || '%';

update public.trek_reviews r
   set photo_urls = array(select replace(u, x.old_prefix, x.new_prefix) from unnest(r.photo_urls) u)
  from prefixes x
 where exists (select 1 from unnest(r.photo_urls) u where u like x.old_prefix || '%');

-- Every count must be 0 before commit.
select 'profiles.avatar_url'       as col, count(*) from public.profiles, prefixes where avatar_url       like old_prefix || '%'
union all
select 'treks.cover_image_url',              count(*) from public.treks, prefixes    where cover_image_url  like old_prefix || '%'
union all
select 'companies.logo_url',                 count(*) from public.companies, prefixes where logo_url        like old_prefix || '%'
union all
select 'companies.cover_image_url',          count(*) from public.companies, prefixes where cover_image_url like old_prefix || '%'
union all
select 'trek_reviews.photo_urls',            count(*) from public.trek_reviews r, prefixes
 where exists (select 1 from unnest(r.photo_urls) u where u like old_prefix || '%');

commit;
