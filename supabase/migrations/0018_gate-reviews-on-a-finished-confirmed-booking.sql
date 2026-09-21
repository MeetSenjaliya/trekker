-- 0018 — a review needs a booking that was confirmed AND a trek that has ended
--
-- The join gate from NEW-3 only asked "does this user hold a row on any batch of
-- this trek?". It never asked whether the booking was honoured or whether the
-- trip had happened, so two people could review a trek they had not been on:
--
--   * a 'waitlisted' participant, who never got a seat; and
--   * anyone at all, the same afternoon they booked a departure months away —
--     book March, post one star in September.
--
-- Double-reviews were never the policy's doing: the unique constraint
-- (trek_id, user_id) stops those, and still does. "Cancelled batch" is not
-- modelled — trek_batches has no status column and a batch with bookings cannot
-- be deleted — so a finished date is the only end-of-trip signal available.
--
-- The trek is over on `batch_date + (whole days spanned - 1)`, and reviews open
-- the day after that. duration_hours is the only length the schema carries, and
-- it is hours-not-days: 5 of 14 live treks exceed 24h (max 35h), so a plain
-- `batch_date < current_date` would open reviews mid-trip for those. A missing,
-- zero or sub-24h duration spans one day, which collapses to exactly
-- `batch_date < current_date`.
--
-- current_date is UTC here (the cluster runs UTC), so an IST user sees reviews
-- unlock at 05:30 local on the following day rather than midnight. That errs
-- late, never early, so it is left alone rather than pinning a timezone the
-- schema does not otherwise carry.
--
-- Joining public.treks costs no visibility: trek_batches' own SELECT policy is
-- already `is_trek_visible(trek_id)`, the same gate treks' SELECT applies, and
-- RLS runs inside these subqueries. A trek hidden from the reviewer already
-- failed the pre-existing trek_batches join.

-- ---- INSERT -----------------------------------------------------------------
drop policy if exists "Users can review treks they joined" on public.trek_reviews;
create policy "Users can review treks they joined" on public.trek_reviews for insert to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
      from public.trek_participants tp
      join public.trek_batches tb on tb.id = tp.batch_id
      join public.treks t on t.id = tb.trek_id
     where tp.user_id = auth.uid()
       and tp.status = 'confirmed'
       and tb.trek_id = trek_reviews.trek_id
       and tb.batch_date
           + (greatest(1, ceil(coalesce(t.duration_hours, 0) / 24.0))::int - 1)
           < current_date
  )
);

-- ---- UPDATE -----------------------------------------------------------------
-- The old WITH CHECK pinned only user_id, so trek_id was rewritable: insert a
-- legitimate review on a finished trek, then UPDATE it onto a trek departing
-- next year. That is the same shape as the trek_participants batch_id hole
-- closed by the M-update fix — a WITH CHECK cannot see the OLD row, so the gate
-- has to be restated in full rather than pinning the column. The unique
-- (trek_id, user_id) blocks only a move onto a trek the user already reviewed.
drop policy if exists "Users can update their own reviews" on public.trek_reviews;
create policy "Users can update their own reviews" on public.trek_reviews for update to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1
      from public.trek_participants tp
      join public.trek_batches tb on tb.id = tp.batch_id
      join public.treks t on t.id = tb.trek_id
     where tp.user_id = auth.uid()
       and tp.status = 'confirmed'
       and tb.trek_id = trek_reviews.trek_id
       and tb.batch_date
           + (greatest(1, ceil(coalesce(t.duration_hours, 0) / 24.0))::int - 1)
           < current_date
  )
);

insert into supabase_migrations.schema_migrations (version, name)
values ('0018', 'gate-reviews-on-a-finished-confirmed-booking')
on conflict (version) do nothing;
