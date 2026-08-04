-- =====================================================================
-- Fix: companies SELECT exposes audit UUID columns to the public
-- ---------------------------------------------------------------------
-- Problem: the "view companies" RLS policy is row-level only, and
-- anon/authenticated hold a table-wide SELECT grant (relacl arwdDxtm).
-- Because PostgREST column selection is client-controlled, any client
-- could `select=created_by,approved_by` on approved companies and cross-
-- reference those UUIDs against the world-readable public_profiles view
-- to deanonymize each company's owner and every approving platform admin.
-- The app-side COMPANY_COLUMNS allowlist gives no protection (it's just
-- the default select, not a server-enforced boundary).
--
-- Fix: replace the table-wide SELECT grant with a column-level SELECT
-- grant covering only the non-sensitive columns. created_by/approved_by/
-- approved_at are removed from every client role's SELECT surface. The
-- admin dashboard, which legitimately needs those columns, reads them via
-- the SECURITY DEFINER RPCs below (gated by is_platform_admin(); the
-- function owner bypasses the column grant). INSERT/UPDATE/DELETE grants
-- are untouched — those paths are governed by RLS + RPCs as before, and
-- the client update path uses return=minimal so it needs no SELECT.
-- =====================================================================

revoke select on public.companies from anon, authenticated;
grant select (
  id, name, slug, description, logo_url, cover_image_url, website,
  contact_email, contact_phone, status, rejection_reason, created_at
) on public.companies to anon, authenticated;

-- admin_list_companies — audit-column company list for the platform-admin
-- dashboard. Replaces the direct table read that selected created_by/
-- approved_by/approved_at (no longer client-selectable). Admin-gated.
create or replace function public.admin_list_companies(p_status text default 'all')
returns setof public.companies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can list companies';
  end if;
  return query
    select *
    from public.companies c
    where p_status = 'all' or c.status = p_status::public.company_status
    order by c.created_at desc;
end;
$$;
revoke execute on function public.admin_list_companies(text) from public, anon;
grant execute on function public.admin_list_companies(text) to authenticated;

-- admin_get_company — single company with audit columns for the admin
-- detail view. Admin-gated; returns 0 or 1 row.
create or replace function public.admin_get_company(p_company_id uuid)
returns setof public.companies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform admins can view company audit details';
  end if;
  return query
    select * from public.companies c where c.id = p_company_id;
end;
$$;
revoke execute on function public.admin_get_company(uuid) from public, anon;
grant execute on function public.admin_get_company(uuid) to authenticated;
