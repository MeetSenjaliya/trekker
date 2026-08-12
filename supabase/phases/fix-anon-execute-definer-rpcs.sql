-- Close the anon_security_definer_function_executable advisor WARNs.
-- FEATURES.md §1.0 item 5 / §1.2 "optional hardening".
--
-- `create or replace function` preserves the original ACL, so every function that
-- was first created without an explicit grant still carries the default PUBLIC
-- EXECUTE. That is what the lint reports. All of these already fail safely via an
-- internal auth.uid()/is_company_*/is_platform_admin() check, so this is hardening,
-- not a fix — but the grant should not be there.
--
-- ⚠️ REVOKING FROM PUBLIC ALSO REMOVES IT FROM authenticated. Almost none of these
-- carry a direct grant to authenticated — they inherit it through PUBLIC. Every
-- revoke below is therefore paired with an explicit `grant execute to authenticated`.
-- Dropping that pairing breaks the dashboard, the admin panel and chat.
--
-- ⚠️ THREE OF THE 21 ARE DELIBERATELY NOT REVOKED — see §C. They are called from
-- PUBLIC-role SELECT policies on treks / trek_batches / companies, which is what an
-- anonymous visitor hits on /explore, /trek/[id] and /company/[slug]. They are not
-- inert for anon; they are load-bearing for it.
--
-- This mirrors the shape already used for is_trekker() and is_chat_participant():
-- revoked from public + anon, granted to authenticated.


-- ===== A. app RPCs — only ever called by a signed-in user ===================
revoke execute on function public.apply_for_company(text, text, text, text, text, text) from public, anon;
grant  execute on function public.apply_for_company(text, text, text, text, text, text) to authenticated;

revoke execute on function public.approve_company(uuid) from public, anon;
grant  execute on function public.approve_company(uuid) to authenticated;

revoke execute on function public.reject_company(uuid, text) from public, anon;
grant  execute on function public.reject_company(uuid, text) to authenticated;

revoke execute on function public.suspend_company(uuid, text) from public, anon;
grant  execute on function public.suspend_company(uuid, text) to authenticated;

revoke execute on function public.invite_company_member(uuid, text) from public, anon;
grant  execute on function public.invite_company_member(uuid, text) to authenticated;

revoke execute on function public.get_company_members(uuid) from public, anon;
grant  execute on function public.get_company_members(uuid) to authenticated;

revoke execute on function public.get_company_batch_participants(uuid) from public, anon;
grant  execute on function public.get_company_batch_participants(uuid) to authenticated;

revoke execute on function public.get_trek_batch_confirmed_counts(uuid) from public, anon;
grant  execute on function public.get_trek_batch_confirmed_counts(uuid) to authenticated;

revoke execute on function public.get_unread_counts() from public, anon;
grant  execute on function public.get_unread_counts() to authenticated;

revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant  execute on function public.mark_conversation_read(uuid) to authenticated;


-- ===== B. RLS helpers used only by authenticated-role policies =============
-- Verified against pg_policy: every policy referencing these is `to authenticated`.
revoke execute on function public.is_company_admin(uuid) from public, anon;
grant  execute on function public.is_company_admin(uuid) to authenticated;

revoke execute on function public.is_approved_company_member(uuid) from public, anon;
grant  execute on function public.is_approved_company_member(uuid) to authenticated;

revoke execute on function public.is_company_writable(uuid) from public, anon;
grant  execute on function public.is_company_writable(uuid) to authenticated;

revoke execute on function public.batch_has_conversation(uuid) from public, anon;
grant  execute on function public.batch_has_conversation(uuid) to authenticated;

revoke execute on function public.batch_has_participants(uuid) from public, anon;
grant  execute on function public.batch_has_participants(uuid) to authenticated;


-- ===== C. trigger functions — no caller ever needs EXECUTE =================
-- Postgres checks EXECUTE on a trigger function at CREATE TRIGGER time, not when
-- the trigger fires, so nothing needs the grant. Called directly they already
-- raise "can only be called as triggers". authenticated keeps its inherited grant
-- for now; only the anon lint is in scope here.
revoke execute on function public.enforce_join_rate_limit() from public, anon;
revoke execute on function public.enforce_message_rate_limit() from public, anon;
revoke execute on function public.enforce_storage_rate_limit() from public, anon;


-- ===== D. NOT REVOKED — anon genuinely needs these ==========================
-- Leaving three WARNs on the advisor by design. Do not "finish the job" here.
--
--   is_trek_visible(uuid)     treks "view treks"                 to PUBLIC
--                             trek_batches "view visible ..."    to PUBLIC
--   is_company_member(uuid)   companies "view companies"         to PUBLIC
--   is_platform_admin()       companies "view companies"         to PUBLIC
--
-- RLS quals are evaluated as the querying role, so an anonymous read of treks /
-- trek_batches / companies calls these. Note the companies qual is
-- `status='approved' OR is_company_member(id) OR is_platform_admin()` — OR does not
-- guarantee short-circuit evaluation order, so the second and third arms can be
-- reached even for a plainly approved company.
--
-- Revoking any of the three logs out the public site: /explore, /trek/[id] and
-- /company/[slug] are all server-rendered for anonymous visitors.


-- ===== VERIFY ==============================================================
-- Expect exactly 3 rows — is_company_member, is_platform_admin, is_trek_visible.
-- select p.proname
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prosecdef
--    and has_function_privilege('anon', p.oid, 'execute')
--  order by p.proname;
--
-- And confirm nothing lost its authenticated grant (expect no rows):
-- select p.proname
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prosecdef
--    and p.proname in ('apply_for_company','approve_company','reject_company',
--                      'suspend_company','invite_company_member','get_company_members',
--                      'get_company_batch_participants','get_trek_batch_confirmed_counts',
--                      'get_unread_counts','mark_conversation_read','is_company_admin',
--                      'is_approved_company_member','is_company_writable',
--                      'batch_has_conversation','batch_has_participants')
--    and not has_function_privilege('authenticated', p.oid, 'execute');
--
-- Then smoke-test as a signed-in company user: /dashboard (roster + batch counts),
-- /admin (company list), /messages (unread badge). Those cover A and B.
