-- ============================================================================
-- 0017 — the two range rules 0009 missed, and the field with nowhere to land
-- ============================================================================
-- Two unrelated tails of the same audit, both on columns the Zod↔DB table in
-- `CODE_REVIEW.md` §2 never listed, so nothing has been chasing them.
--
-- ---- treks.distance_km / duration_hours -------------------------------------
-- `0009` wrote the range half of that pass and named three columns:
-- `estimated_cost >= 0` and `max_participants > 0` on both tables. But
-- `trekFormSchema` builds Distance, Duration and Cost from one helper —
--
--   const optionalNumber = (label: string) => … Number(v) >= 0 …
--
-- — so all three carry the same `>= 0` rule, and only Cost got it in the
-- database. There is no reasoning behind the split to preserve: unlike
-- `treks.plan` and `treks.rating`, which `0011` lists as deliberately skipped,
-- these two appear in no migration, no finding list and no doc. They were
-- missed, and `0011` was text-only so it did not sweep them up.
--
-- Same shape as the `estimated_cost` case it mirrors: a caller who skips the
-- form writes a trek that is -5 km long and takes -12 hours, and every consumer
-- that formats or sums those numbers renders it.
--
-- `>= 0` and not `> 0`, matching Zod and matching `estimated_cost`: zero is a
-- real answer for both (a viewpoint 0 km from the trailhead, a walk rounded to
-- under an hour), and NULL is the unset value the form writes for a blank
-- field — a CHECK passes NULL, so blank stays blank.
--
-- ---- profiles.emergency_contact_relationship --------------------------------
-- `0011` recorded this while mapping the same columns and left it, because it
-- was a client bug with no column to constrain:
--
--   `emergencyContactRelationship` is collected and validated at 60 chars and
--   then written to no column … There is no column to constrain.
--
-- The form asks who the contact is, `profileUpdateSchema` checks the answer,
-- and `src/app/(trekker)/profile/edit/page.tsx` builds an `updates` object with
-- `emergency_contact` and `emergency_no` and no third key. The value is parsed
-- and dropped on every save, and the loader compensates with a hardcoded
-- `relationship: ''` — so the field also reads back empty, and a user who fills
-- it in twice sees it vanish twice. An emergency contact whose relationship is
-- unknown is worth less than one that stores it, which is why this closes by
-- adding the column rather than by deleting the input.
--
-- 60 is `profileUpdateSchema.emergencyContactRelationship`'s existing
-- `optionalText(60)`, not a new judgement — the same rule the other two
-- emergency columns follow (`emergency_contact` 100, `emergency_no` 20 + the
-- `0013` format). No format rule: "Mother", "Brother-in-law" and "Team lead"
-- are all it collects, and there is no class of value to exclude the way a
-- phone column has one.
--
-- No grant needed. `profiles` carries table-wide `arwdDxtm` for `anon`,
-- `authenticated` and `service_role` with no column ACLs, so a new column
-- inherits the table's privileges and RLS stays the only gate — unlike
-- `companies`, where `0001`'s 12-column allowlist means a new column would need
-- an explicit grant. Checked over the read-only MCP before writing.
--
-- Existing data: 14 treks, 0 with a negative `distance_km` or `duration_hours`
-- (widest values 55 km and 35 h); the new column starts NULL on every profile.
-- No backfill, no NOT VALID staging.
--
-- `add column if not exists` / `drop constraint if exists` before each `add
-- constraint`, as in `0009`/`0011`/`0013` — the file has to survive a second
-- run in the SQL Editor.

-- ---- treks ------------------------------------------------------------------
alter table public.treks drop constraint if exists treks_distance_km_nonneg;
alter table public.treks
  add constraint treks_distance_km_nonneg check (distance_km >= 0);

alter table public.treks drop constraint if exists treks_duration_hours_nonneg;
alter table public.treks
  add constraint treks_duration_hours_nonneg check (duration_hours >= 0);

-- ---- profiles ---------------------------------------------------------------
alter table public.profiles
  add column if not exists emergency_contact_relationship text;

alter table public.profiles
  drop constraint if exists profiles_emergency_contact_relationship_len;
alter table public.profiles
  add constraint profiles_emergency_contact_relationship_len
  check (length(emergency_contact_relationship) <= 60);

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0017', 'trek-range-checks-and-emergency-relationship-column')
on conflict (version) do nothing;
