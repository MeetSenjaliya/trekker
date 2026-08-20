-- ============================================================================
-- 0003 — revoke client grants on platform_admins (defense in depth)
-- ============================================================================
-- platform_admins is the super-admin allowlist; a successful INSERT into it is
-- a full privilege escalation. It has always been protected by RLS enabled with
-- deliberately ZERO policies (default-deny for every client role), and there is
-- no client path to add an admin — rows are inserted only in the SQL Editor as
-- the table owner.
--
-- But in production the table still carried Supabase's default GRANT ALL to
-- anon/authenticated, so RLS was the SOLE barrier. Disable RLS once — a stray
-- migration, a debug session — and an anonymous caller could both read the
-- admin list and insert its own uid as an admin. (This also made a plain
-- `select` return `[]` with 200 instead of a permission error, since the grant
-- was present; a Strix probe on 2026-08-18 flagged exactly that.)
--
-- Mirror rate_events (0001 §13): revoke the grants outright, so the table is
-- defended by BOTH the missing privilege AND RLS — either alone now denies
-- access, and clients get a hard permission error rather than an empty read.
-- Re-running is a no-op; revoking a privilege that isn't held does nothing.

revoke all on public.platform_admins from anon, authenticated;

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0003', 'lock-platform-admins-grants')
on conflict (version) do nothing;
