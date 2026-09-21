-- 0029 — apply_for_company() refuses trekker accounts, in the migration too
--
-- Production has enforced this since phase F (2026-08-06): the live function
-- body raises 'Only company accounts can apply. Sign up as a trek company
-- instead.' before touching a row, and `phases/phase-f-account-types.sql`
-- carries the same block. When phase F was folded into `0001_baseline.sql`
-- the gate survived only as a commented-out fragment (§14.7, "see §12.4"),
-- and the §12.4 body it points at never gained it. So a database built from
-- the migrations — which is what `npx vitest run --project db` proves against
-- — let a trekker create a company, while production did not. Found by the
-- 2026-09-18 FEATURES.md audit (E26), read back over the MCP server on
-- 2026-09-19: `pg_get_functiondef` of the live function is the body below.
--
-- Restates the whole body so committed = live. Grants are untouched:
-- `create or replace` keeps them, and the live set (authenticated yes,
-- anon no) is what 0001 §17.3 already installs.
create or replace function public.apply_for_company(
  p_name          text,
  p_slug          text,
  p_description   text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_website       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_company_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.account_type = 'company'
  ) then
    raise exception 'Only company accounts can apply. Sign up as a trek company instead.';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Company name is required';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Slug must be lowercase letters, numbers and hyphens only';
  end if;

  insert into public.companies
    (name, slug, description, contact_email, contact_phone, website, created_by, status)
  values
    (trim(p_name), p_slug, p_description, p_contact_email, p_contact_phone, p_website, v_uid, 'pending')
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, role)
  values (v_company_id, v_uid, 'owner');

  return jsonb_build_object('company_id', v_company_id, 'status', 'pending');
exception
  when unique_violation then
    raise exception 'You already have a pending application, or that URL slug is taken';
end;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('0029', 'gate-apply-for-company-on-a-company-account')
on conflict (version) do nothing;
