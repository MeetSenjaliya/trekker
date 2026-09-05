-- ============================================================================
-- 0014 — companies.website must carry an http(s) scheme
-- ============================================================================
-- The same shape as `0009`/`0011`/`0013` — a rule that lived only in
-- `src/lib/schemas.ts` gets its twin in the database — but this one is a live
-- XSS sink rather than storage sloppiness, and the Zod rule it mirrors did not
-- exist until now either.
--
-- `companyApplicationSchema.website` and `companyProfileSchema.website` were
-- `z.url()`, which validates *URL syntax* and says nothing about the scheme:
-- `javascript:alert(1)`, `data:text/html,…` and `vbscript:…` all parse and all
-- passed. Both values are rendered straight into an `href` that React does not
-- sanitize —
--
--   src/app/company/[slug]/page.tsx        public storefront, target=_blank
--   src/app/admin/companies/[id]/page.tsx  platform-admin review page, same tab
--
-- so the reachable chain is: anyone signs up, applies for a company with a
-- `javascript:` website, and the platform admin runs it in their own session by
-- clicking the link on the page where they decide whether to approve. Approval
-- then ships it to every visitor of the storefront.
--
-- Nothing in the database stopped it: before this migration `public.companies`
-- carried `companies_name_check` and `companies_slug_check` and no bound on
-- `website` at all, so the value reached the column whether it came through the
-- form or straight over PostgREST with the publishable key.
--
-- The scheme is the whole rule. `^https?://` is not a URL validity check — the
-- Zod side does that, and this is deliberately the coarser twin, in the spirit
-- of `0013`: it rejects the class of value that cannot be a website link at
-- all, which here means anything the browser would execute rather than fetch.
-- `~*` and not `~` because `new URL()` lowercases the scheme before Zod's
-- `protocol` regex sees it, so `HTTPS://example.com` passes the form and has to
-- pass here too.
--
-- The empty string fails this check, and that is intentional: both writers
-- (`applyForCompany`, `updateCompanyProfile` in `src/lib/company.ts`) already
-- send `website || null`, so a blank field is NULL and NULL passes any CHECK.
-- Only a caller bypassing the app can produce `''`, and `''` is not a website.
--
-- Deliberately not here: a length cap. `0009`/`0011` never reached this table —
-- `companies.name`, `description`, `contact_email` and `contact_phone` are all
-- still Zod-only — and `website` has no Zod cap to mirror, so a number picked
-- here would be invented (`0011`'s stated reason for leaving `phone_no` alone).
-- Capping the table is its own migration, not a thing this one does by halves.
--
-- Existing data: checked over the read-only MCP immediately before writing.
-- 5 companies, `website` set on 4, longest 18 chars, 0 rows failing the regex.
-- No backfill, no NOT VALID staging.
--
-- `drop constraint if exists` before the `add constraint`, as in `0009`/`0011`.

alter table public.companies drop constraint if exists companies_website_scheme;
alter table public.companies
  add constraint companies_website_scheme check (website ~* '^https?://');

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0014', 'pin-company-website-to-an-http-scheme')
on conflict (version) do nothing;
