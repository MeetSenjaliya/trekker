-- 0031 — cap review photos at five per review
--
-- ReviewForm has always refused a sixth photo, but photo_urls is a plain
-- text[] that the reviewer's own insert/update policies let them write, so
-- the cap held only for people using the form. Nothing else bounded it: the
-- upload counter (§13.4, 20/hour on trek-reviews) limits how fast photos can
-- be made, not how many one review carries, and the shutterbug badge sums
-- exactly that count. Restated here as the form starts uploading for real.
--
-- Live data on 2026-09-21: 2 reviews, at most 2 photos each, so the
-- constraint validates in place. cardinality(null) is null and a null CHECK
-- passes; the column defaults to '{}' so that is only the shape of a review
-- posted without photos.
alter table public.trek_reviews
  drop constraint if exists trek_reviews_photo_urls_max;
alter table public.trek_reviews
  add constraint trek_reviews_photo_urls_max
  check (cardinality(photo_urls) <= 5);

insert into supabase_migrations.schema_migrations (version, name)
values ('0031', 'cap-review-photos-at-five')
on conflict (version) do nothing;
