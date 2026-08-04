-- ============================================================================
-- POLISH — Participants keep seeing treks they've booked
-- ============================================================================
-- ✅ STATUS: APPLIED TO THE LIVE DB. Verified 2026-08-04 —
-- pg_get_functiondef('public.is_trek_visible(uuid)') matches the definition below
-- byte-for-byte, participant arm included. Re-running this file is a no-op.
--
-- The participant arm is also folded into migration-multi-tenant.sql §3 and
-- supabase/schema.sql (canonical), so a fresh migration apply includes it.
--
-- Problem: is_trek_visible() gates the treks AND trek_batches SELECT policies.
-- When a trek is archived (is_active=false) or its company is suspended, a
-- participant with an existing booking loses all visibility of it — the trek
-- detail page 404s and favorites/"my treks" lookups return null rows — even
-- though their trek_participants row and chat thread survive by design.
--
-- Fix: add a fourth visibility arm — the caller has a trek_participants row on
-- one of the trek's batches. This does NOT re-list the trek publicly:
-- search_treks() filters on `t.is_active and c.status = 'approved'` directly,
-- so the catalogue/storefront stay clean; only people already booked regain
-- read access to the trek they're on.
--
-- No recursion risk: SECURITY DEFINER runs as the table owner, which bypasses
-- RLS on treks/companies/trek_participants inside the function (same pattern
-- as the existing body).
-- ============================================================================

create or replace function public.is_trek_visible(p_trek_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.treks t
    join public.companies c on c.id = t.company_id
    where t.id = p_trek_id
      and (
        (t.is_active and c.status = 'approved')
        or public.is_company_member(t.company_id)
        or public.is_platform_admin()
        or exists (
          select 1
          from public.trek_participants tp
          join public.trek_batches tb on tb.id = tp.batch_id
          where tb.trek_id = t.id and tp.user_id = auth.uid()
        )
      )
  );
$$;

-- create or replace preserves the existing grants (anon, authenticated).

-- ============================================================================
-- Verification (read-only)
-- ============================================================================

-- 1. The participant arm is present (expect true):
select prosrc like '%trek_participants%' as participant_arm
from pg_proc
where proname = 'is_trek_visible' and pronamespace = 'public'::regnamespace;

-- 2. Public catalogue unaffected — archived/unapproved treks still absent
--    (expect 0 rows):
select id, title from public.search_treks()
where id in (
  select t.id from public.treks t
  join public.companies c on c.id = t.company_id
  where not t.is_active or c.status <> 'approved'
);
