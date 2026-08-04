-- ============================================================================
-- PHASE B — Company application flow + role plumbing (app layer)
-- ============================================================================
-- NO NEW SQL. Everything Phase B's app code calls shipped in Phase A
-- (supabase/migration-multi-tenant.sql):
--
--   apply_for_company() RPC          → src/lib/company.ts  applyForCompany()
--   companies / company_members RLS  → getMyCompanies(), getCompany(slug)
--   is_platform_admin() RPC          → src/app/admin/layout.tsx guard
--
-- Optional smoke test (safe, read-only):

-- Both RPCs the Phase B code depends on exist (expect 2 rows):
select proname
from pg_proc
where proname in ('apply_for_company', 'is_platform_admin')
  and pronamespace = 'public'::regnamespace;

-- The one-pending-application-per-user spam guard is in place (expect 1 row):
select indexname from pg_indexes
where schemaname = 'public' and indexname = 'companies_one_pending_per_creator';
