-- ============================================================================
-- PHASE A — Database foundation (the ONLY phase with real schema changes)
-- ============================================================================
-- All multi-tenant DDL lives in ONE file — run it top-to-bottom in the
-- Supabase SQL Editor:
--
--     supabase/migration-multi-tenant.sql
--
-- It contains: enums, companies / company_members / platform_admins tables,
-- treks.company_id + is_active, helper functions, RPCs, triggers, RLS,
-- storage buckets + policies, the extended search_treks(), the one-time
-- backfill ("Trekker Originals"), and it drops the broken
-- trg_initial_trek_message trigger. Read the two inline TODO comments
-- (backfill owner + platform_admins insert) before running.
--
-- ✅ STATUS: APPLIED 2026-07-02 and verified live via read-only MCP — all
-- checks below pass (3 tables w/ RLS, 0 ownerless treks, approved default
-- company w/ 1 owner, single 12-arg search_treks, trigger dropped). Folded
-- into supabase/schema.sql §12 as the new source of truth. One manual step
-- remains: platform_admins is EMPTY (see phase-d-platform-admin.sql).
--
-- ============================================================================
-- Verification — run AFTER applying the migration; expected results inline.
-- ============================================================================

-- 1. The three new tables exist with RLS on (expect 3 rows, rls = true):
select relname, relrowsecurity as rls
from pg_class
where relname in ('companies', 'company_members', 'platform_admins')
  and relkind = 'r';

-- 2. Backfill worked — no ownerless treks (expect 0):
select count(*) as ownerless_treks from public.treks where company_id is null;

-- 3. "Trekker Originals" exists, approved, with exactly one owner member:
select c.name, c.status,
       (select count(*) from public.company_members cm
        where cm.company_id = c.id and cm.role = 'owner') as owners
from public.companies c
where c.slug = 'trekker-originals';

-- 4. Exactly ONE search_treks overload — the new 12-arg version. Two rows
--    here means the old 11-arg overload wasn't dropped, and PostgREST RPC
--    calls will fail with an ambiguity error:
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where proname = 'search_treks' and pronamespace = 'public'::regnamespace;

-- 5. The broken trigger is gone (expect 0 rows):
select tgname from pg_trigger
where tgname = 'trg_initial_trek_message' and not tgisinternal;

-- Also run the dashboard Security Advisor (or MCP get_advisors) after
-- applying, per MULTI_TENANT_PLAN.md.
