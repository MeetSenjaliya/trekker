-- ============================================================================
-- 0013 — phone columns must look like phone numbers
-- ============================================================================
-- `0009`/`0011` mirrored the Zod *length* caps into the database. This mirrors
-- the other half of the same rule: `profileUpdateSchema.emergencyContactPhone`
-- has carried `.regex(/^[\d\s+()-]*$/, 'Enter a valid phone number')` since Zod
-- validation landed, and like every other browser-side rule it is advisory —
-- the app writes through PostgREST with the publishable key, so a caller who
-- skips the form writes a paragraph into `emergency_no`.
--
-- The character class is the Zod one, unchanged: digits, whitespace, `+`, `(`,
-- `)`, `-`. `\d` and `\s` mean the same thing in a Postgres ARE as in the JS
-- regex, so this is the same rule and not a re-interpretation of it. `*` and
-- not `+`: the empty string passes in Zod (the field is optional), and NULL
-- passes any CHECK, so "unset" stays unset in both spellings.
--
-- Deliberately not a validity rule. `+91 (987) 654-3210`, `9876543210` and
-- `((((` all pass; the constraint rejects the class of value that is not a
-- phone number *at all* — an email, a URL, a sentence, a script tag — which is
-- what an unconstrained free-text column collects. Anything narrower would be
-- inventing a national format the form has never asked for.
--
-- ---- phone_no ---------------------------------------------------------------
-- `0011` left this column alone, reasoning that a cap with no Zod counterpart
-- would be invented rather than mirrored. That still holds for the *length*
-- taken on its own, but it stops holding once the column has a format: every
-- other phone field in the app (`emergencyContactPhone`, `contactPhone` on both
-- company schemas) is capped at 20, and a format rule with no bound still
-- accepts a megabyte of digits — the storage-amplification shape the length
-- caps exist to close. So the two land together, and 20 is the app's own
-- number rather than a new judgement.
--
-- `phone_no` has no writer in the app today (the profile editor persists
-- `emergency_contact`/`emergency_no` only; `get_company_batch_participants`
-- reads it into the roster). It is still directly writable over PostgREST by
-- the profile's owner, which is the only reason to constrain it.
--
-- Existing data: checked over the read-only MCP immediately before writing.
-- 5 profiles; `phone_no` set on 1, `emergency_no` on 3, longest value 10 chars
-- on both, 0 rows failing either regex. No backfill, no NOT VALID staging.
--
-- `drop constraint if exists` before each `add constraint`, as in `0009`/`0011`.

alter table public.profiles drop constraint if exists profiles_phone_no_len;
alter table public.profiles
  add constraint profiles_phone_no_len check (length(phone_no) <= 20);

alter table public.profiles drop constraint if exists profiles_phone_no_format;
alter table public.profiles
  add constraint profiles_phone_no_format check (phone_no ~ '^[\d\s+()-]*$');

alter table public.profiles drop constraint if exists profiles_emergency_no_format;
alter table public.profiles
  add constraint profiles_emergency_no_format check (emergency_no ~ '^[\d\s+()-]*$');

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0013', 'format-checks-on-profile-phone-columns')
on conflict (version) do nothing;
