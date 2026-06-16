-- ============================================================================
-- HARDENING — 2026-06-16 (advisor: *_security_definer_function_executable)
-- Trigger-only SECURITY DEFINER functions are auto-exposed as PostgREST RPC
-- endpoints (/rest/v1/rpc/<name>) callable by anon/authenticated. They are only
-- meant to fire as triggers, so revoke direct EXECUTE.
--
-- NOTE: CREATE FUNCTION grants EXECUTE to the PUBLIC role by default, and
-- anon/authenticated inherit it THROUGH public — so you MUST revoke from
-- `public`, not just from anon/authenticated (revoking only the latter is a
-- no-op while the PUBLIC grant remains). Triggers still fire regardless of these
-- grants; the owner (postgres) retains EXECUTE.
--
-- Leave join_trek_and_chat (app RPC), is_chat_participant (RLS policies), and
-- increment_participants (src/lib/database.ts) callable — they are used.
-- ============================================================================
revoke execute on function public.handle_new_user()           from public, anon, authenticated;
revoke execute on function public.notify_trek_participation() from public, anon, authenticated;
revoke execute on function public.update_participants_count() from public, anon, authenticated;