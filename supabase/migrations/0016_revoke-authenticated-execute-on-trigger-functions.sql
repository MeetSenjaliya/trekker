-- ============================================================================
-- 0016 — the four trigger functions `authenticated` can still call
-- ============================================================================
-- Consistency, not a hole. Read the impact note before deciding it matters.
--
-- Every trigger function in this schema is revoked from the client roles, and
-- all but four of them are revoked from all three:
--
--   revoke execute on function public.protect_company_admin_fields()
--     from public, anon, authenticated;   -- and handle_new_user, and the rest
--
--   revoke execute on function public.enforce_join_rate_limit()
--     from public, anon;                  -- `authenticated` left behind
--
-- The four `enforce_*` rate-limit triggers took the two-role form. `pg_proc`
-- on the live database agrees with the file — `authenticated=X/postgres` is
-- really there, on all four — so this is not drift between the repo and
-- production, it is the migrations having written the shorter list.
--
-- ---- what it is worth ------------------------------------------------------
-- Nothing exploitable. All four are `returns trigger`, and Postgres refuses a
-- direct call before the body runs:
--
--   select public.enforce_join_rate_limit();
--   ERROR: trigger functions can only be called as triggers   (0A000)
--
-- (Verified against PGlite rather than assumed.) PostgREST does not expose a
-- `trigger`-returning function over `/rest/v1/rpc/` either. So the grant is
-- reachable in the catalogue and not in practice.
--
-- It is still worth removing. It is four of the 34 findings under the
-- `authenticated_security_definer_function_executable` advisor, and an advisor
-- list padded with items known to be inert is one nobody reads carefully — the
-- same reason `0003` and the anon sweep happened. Removing them leaves that
-- list containing only functions that really are meant to be called.
--
-- ---- why revoking is safe --------------------------------------------------
-- Postgres checks EXECUTE at CREATE TRIGGER time, not at fire time, so a
-- trigger whose function no client can call keeps firing exactly as before.
-- That is the same invariant `0001` relied on for the other nine, recorded in
-- `supabase/security-fixes.sql`, and the existing rate-limit tests are what
-- prove it here: if any of these four stopped firing, the join, message,
-- storage and trek-email caps would all fail their suites.
--
-- No data touched: this migration grants and revokes only.

revoke execute on function public.enforce_join_rate_limit() from authenticated;
revoke execute on function public.enforce_message_rate_limit() from authenticated;
revoke execute on function public.enforce_storage_rate_limit() from authenticated;
revoke execute on function public.enforce_trek_email_rate_limit() from authenticated;

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0016', 'revoke-authenticated-execute-on-trigger-functions')
on conflict (version) do nothing;
