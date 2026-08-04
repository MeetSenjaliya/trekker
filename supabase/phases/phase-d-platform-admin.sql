-- ============================================================================
-- PHASE D — Platform admin panel (/admin)
-- ============================================================================
-- ONE REQUIRED MANUAL STEP. The moderation RPCs (approve_company /
-- reject_company / suspend_company) shipped in Phase A, but they all refuse
-- to run unless the caller is in platform_admins — and that table has zero
-- client-facing policies by design. You must insert yourself here, in the
-- SQL Editor, before /admin works for anyone:

insert into public.platform_admins (user_id)
select id from auth.users where email = 'YOUR_EMAIL_HERE'   -- ← your app login email
on conflict (user_id) do nothing;

-- Verify (expect 1 row with your email):
select u.email, pa.created_at
from public.platform_admins pa
join auth.users u on u.id = pa.user_id;
