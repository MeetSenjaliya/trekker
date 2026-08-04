-- ============================================================================
-- PHASE C — Company admin dashboard (/dashboard)  (app layer)
-- ============================================================================
-- Most of the dashboard needs NO new SQL — it shipped in Phase A
-- (supabase/migration-multi-tenant.sql):
--
--   treks insert/update RLS (company-scoped)     → trek create/edit/archive
--   trek_batches insert/update/delete RLS        → batch management
--   get_company_batch_participants() RPC         → participant roster (PII path)
--   company-logos / trek-images storage buckets  → logo + cover uploads
--   companies UPDATE RLS + admin-field trigger   → /dashboard/settings
--   company_members UPDATE/DELETE RLS            → /dashboard/team role change + remove
--
-- ONE thing DOES need new SQL. The /dashboard/team page must (a) list members
-- with their name/email/avatar and (b) invite by email. Both read profiles the
-- caller doesn't own, and public.profiles is self-only under RLS
-- (SELECT policy = auth.uid() = id), so neither is reachable from the client.
-- These two SECURITY DEFINER RPCs are the mediated path — same pattern as
-- get_company_batch_participants(): re-check membership/adminship inside the
-- function, pin search_path, expose only what the team page needs.
-- ============================================================================


-- get_company_members — team roster (identity) for a company the caller belongs
-- to. Returns an empty set (not an error) for non-members, so it can't be used
-- to probe whether a company id exists. Exposes teammate name/email/avatar only
-- within the same company — the scoped team-directory analogue of the roster RPC.
create or replace function public.get_company_members(p_company_id uuid)
returns table (
  member_id  uuid,
  user_id    uuid,
  role       public.company_role,
  full_name  text,
  email      text,
  avatar_url text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_company_member(p_company_id) then
    return;
  end if;

  return query
  select cm.id, p.id, cm.role, p.full_name, p.email, p.avatar_url, cm.created_at
  from public.company_members cm
  join public.profiles p on p.id = cm.user_id
  where cm.company_id = p_company_id
  order by cm.role, p.full_name nulls last, cm.created_at;
end;
$$;
grant execute on function public.get_company_members(uuid) to authenticated;


-- invite_company_member — owner/admin-only. Resolves an existing Trekker
-- account by email and adds them as STAFF (never admin/owner — role escalation
-- stays impossible from the client). Authorization is checked inside the
-- function (defense-in-depth, like approve_company()), so the broad EXECUTE
-- grant to `authenticated` is still safe.
create or replace function public.invite_company_member(p_company_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_count   int;
begin
  if not public.is_company_admin(p_company_id) then
    raise exception 'Only company owners/admins can invite members';
  end if;

  select id into v_user_id
  from public.profiles
  where lower(email) = lower(trim(p_email));

  if v_user_id is null then
    raise exception 'No Trekker account found with that email';
  end if;

  insert into public.company_members (company_id, user_id, role)
  values (p_company_id, v_user_id, 'staff')
  on conflict (company_id, user_id) do nothing;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    return jsonb_build_object('already_member', true);
  end if;
  return jsonb_build_object('user_id', v_user_id);
end;
$$;
grant execute on function public.invite_company_member(uuid, text) to authenticated;


-- ============================================================================
-- Smoke test (safe, read-only) — run after applying the above.
-- ============================================================================

-- The two team RPCs now exist (expect 2 rows):
select proname from pg_proc
where proname in ('get_company_members', 'invite_company_member')
  and pronamespace = 'public'::regnamespace;

-- Phase A objects the rest of the dashboard leans on (expect 1 row + 2 rows):
select proname from pg_proc
where proname = 'get_company_batch_participants'
  and pronamespace = 'public'::regnamespace;

select id, public from storage.buckets
where id in ('company-logos', 'trek-images');
