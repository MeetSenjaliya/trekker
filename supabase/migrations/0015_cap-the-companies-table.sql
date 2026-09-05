-- ============================================================================
-- 0015 — the companies table, which 0009/0011 never reached
-- ============================================================================
-- `0009` took the six columns the Day 7 pentest pass named and `0011` swept up
-- the rest — except that neither of them touched `public.companies` at all.
-- `0014` noticed it while pinning `website` to an http(s) scheme and said so
-- rather than widening itself. This is that follow-up, and it is the same class
-- as `0011`: no abuse story, just a rule that exists in `src/lib/schemas.ts`
-- and nowhere else, on a table any signed-up user can write to over PostgREST
-- with the publishable key by calling `apply_for_company()` and then updating
-- their own row.
--
-- Every bound below is the existing Zod value, not a new judgement:
--
--   companies.name           100   companyApplicationSchema/companyProfileSchema.name
--   companies.description   1000   optionalText(1000)
--   companies.contact_phone   20   .max(20) on both schemas
--
-- and the phone *format* is the same character class `0013` put on
-- `profiles.phone_no` / `profiles.emergency_no`, for the same reason: both
-- company schemas have carried `.regex(/^[\d\s+()-]*$/)` since Zod validation
-- landed, and a length cap on its own still lets a paragraph through. `*` and
-- not `+`, so `''` passes here exactly as it does in Zod.
--
-- ---- contact_email ----------------------------------------------------------
-- The one column whose rule had to be finished before it could be mirrored.
-- `z.email()` validates shape and imposes no length whatsoever — a 300-character
-- local part parses — so there was no number to copy, and inventing one would
-- have made the database stricter than the form and bounced a value the user
-- had just been told was fine.
--
-- So the cap lands in both places at once, the way `0014` introduced the scheme
-- rule in both places at once: `contactEmailField` in `src/lib/schemas.ts` now
-- carries `.max(254)`, and this migration mirrors it. 254 is RFC 5321's limit on
-- a forward path, so it rejects nothing a mail server would deliver to.
--
-- The format check is deliberately coarser than Zod's: one `@`, no whitespace,
-- something on each side. Zod already refuses a bare `a@localhost`, a quoted
-- local part and a unicode address, so everything the form accepts passes this
-- and the constraint can only fire on a value that never went near the form —
-- a sentence, a URL, a script tag. Writing Zod's own email regex into a CHECK
-- would be re-implementing a validity spec in a second language, which is how
-- the two quietly stop agreeing.
--
-- `''` passes both the email and the phone check, as it does in Zod. That is a
-- deliberate difference from `companies_website_scheme` in `0014`, which rejects
-- `''`: that column is an `href` sink and its rule is about what a browser would
-- execute, so "not a URL at all" is the whole point. These two are size and
-- shape rules on values nothing renders as a link, and Zod's own answer for a
-- blank optional field is to accept it.
--
-- ---- deliberately not here --------------------------------------------------
--   rejection_reason  Free text with no Zod counterpart, and no untrusted
--                     writer: `protect_company_admin_fields()` pins it to OLD
--                     for anyone who is not a platform admin, so the only
--                     callers are `reject_company()` / `suspend_company()`.
--                     `0011`'s rule applies — nothing to mirror, so nothing to
--                     invent.
--   logo_url,         Written by the app from a storage upload path, never
--   cover_image_url   typed into a form, so again no Zod rule to mirror. They
--                     are directly writable and worth their own look, but a cap
--                     picked here would be a guess about a path format.
--   slug              Already bounded — `companies_slug_check`, 60 chars plus
--                     the pattern, since the baseline.
--
-- Existing data: checked over the read-only MCP immediately before writing.
-- 5 companies; longest name 17, description 31, contact_email 27, contact_phone
-- 13; `rejection_reason` null on every row; 0 rows failing any of the five
-- rules. No backfill, no NOT VALID staging.
--
-- `drop constraint if exists` before each `add constraint`, as in `0009`/`0011`.

alter table public.companies drop constraint if exists companies_name_len;
alter table public.companies
  add constraint companies_name_len check (length(name) <= 100);

alter table public.companies drop constraint if exists companies_description_len;
alter table public.companies
  add constraint companies_description_len check (length(description) <= 1000);

alter table public.companies drop constraint if exists companies_contact_phone_len;
alter table public.companies
  add constraint companies_contact_phone_len check (length(contact_phone) <= 20);

alter table public.companies drop constraint if exists companies_contact_phone_format;
alter table public.companies
  add constraint companies_contact_phone_format check (contact_phone ~ '^[\d\s+()-]*$');

alter table public.companies drop constraint if exists companies_contact_email_len;
alter table public.companies
  add constraint companies_contact_email_len check (length(contact_email) <= 254);

alter table public.companies drop constraint if exists companies_contact_email_format;
alter table public.companies
  add constraint companies_contact_email_format
  check (contact_email = '' or contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+$');

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0015', 'cap-the-companies-table')
on conflict (version) do nothing;
