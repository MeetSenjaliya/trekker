-- ============================================================================
-- PHASE E — Public-facing surface changes (/company/[slug], trek attribution)
-- ============================================================================
-- NO NEW SQL. The storefront reuses machinery that shipped in Phase A
-- (supabase/migration-multi-tenant.sql):
--
--   search_treks(p_company_id => …)         → storefront trek list
--   search_treks company_name/company_slug  → "Organized by …" on cards/detail
--   companies SELECT RLS (approved-only)    → public company profile
--   is_trek_visible()                       → suspended companies auto-delist
--
-- Optional smoke test (safe, read-only) — storefront query for the default
-- company; expect its treks with company_name = 'Trekker Originals':
select id, title, company_name, company_slug, total_count
from public.search_treks(
  p_company_id => (select id from public.companies where slug = 'trekker-originals')
);
