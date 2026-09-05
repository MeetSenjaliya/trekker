-- ============================================================================
-- 0011 — cap the text columns still bounded only by Zod
-- ============================================================================
-- The tail of `0009`. That migration took the six columns the Day 7 pentest
-- pass named; these eight are the rest of the same class — a cap that exists in
-- `src/lib/schemas.ts` and nowhere else, so a caller who skips the form skips
-- the cap. No abuse story attached to any of them, which is why they were not
-- in the finding list: unlike `conversation_messages.message`, nothing here
-- fans out to other users' render cost. They are storage-side sloppiness rather
-- than a lever, and the reason to close them is that a rule enforced in one
-- place is a rule that quietly stops being true in the other.
--
-- Every bound below is the existing Zod value, not a new judgement:
--
--   treks.title             150   trekFormSchema.title
--   treks.description      2000   optionalText(2000)
--   treks.location          200   optionalText(200)
--   treks.meeting_point     300   optionalText(300)
--   treks.meeting_point2    300   optionalText(300)
--   treks.gear_checklist   2000   see below
--   profiles.emergency_contact 100   profileUpdateSchema.emergencyContactName
--   profiles.emergency_no       20   profileUpdateSchema.emergencyContactPhone
--
-- `gear_checklist` is text[], and its Zod cap is on the raw textarea before the
-- split: 2000 characters including the newlines. `array_to_string(..., E'\n')`
-- reconstructs exactly that string, so the constraint is the same bound on the
-- same value rather than an approximation of it (a per-element or array-length
-- cap would be a different rule wearing the same number).
--
-- Deliberately not capped:
--
--   profiles.phone_no   No Zod counterpart — profileUpdateSchema carries the
--                       emergency contact's phone, not the user's own. Capping
--                       it would be inventing a limit rather than mirroring
--                       one. It is also unclear anything still writes it; the
--                       profile editor writes emergency_contact/emergency_no
--                       only.
--   treks.plan          Not on the trek form at all.
--   treks.rating        Legacy static column, no longer surfaced.
--
-- Also noticed while mapping these, and NOT addressed here because it is a
-- client bug rather than a schema one: `emergencyContactRelationship` is
-- collected and validated at 60 chars and then written to no column —
-- `src/app/(trekker)/profile/edit/page.tsx:176-177` persists the name and phone
-- and drops it. There is no column to constrain.
--
-- NULL passes every one of these, as in `0009`. `treks.title` is NOT NULL and
-- keeps its own constraint for that.
--
-- Existing data: checked over the read-only MCP on 2026-09-02 immediately
-- before writing. 0 rows exceed any bound; widest values were title 27/150,
-- description 93/2000, location 23/200, both meeting points 89/300,
-- gear_checklist 46/2000 across at most 3 items, emergency_contact 7/100 and
-- emergency_no 10/20. No backfill, no NOT VALID staging.
--
-- `drop constraint if exists` before each `add constraint`, as in `0009` — the
-- file has to survive a second run in the SQL Editor.

-- ---- treks -----------------------------------------------------------------
alter table public.treks drop constraint if exists treks_title_len;
alter table public.treks
  add constraint treks_title_len check (length(title) <= 150);

alter table public.treks drop constraint if exists treks_description_len;
alter table public.treks
  add constraint treks_description_len check (length(description) <= 2000);

alter table public.treks drop constraint if exists treks_location_len;
alter table public.treks
  add constraint treks_location_len check (length(location) <= 200);

alter table public.treks drop constraint if exists treks_meeting_point_len;
alter table public.treks
  add constraint treks_meeting_point_len check (length(meeting_point) <= 300);

alter table public.treks drop constraint if exists treks_meeting_point2_len;
alter table public.treks
  add constraint treks_meeting_point2_len check (length(meeting_point2) <= 300);

alter table public.treks drop constraint if exists treks_gear_checklist_len;
alter table public.treks
  add constraint treks_gear_checklist_len
  check (length(array_to_string(gear_checklist, E'\n')) <= 2000);

-- ---- profiles --------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_emergency_contact_len;
alter table public.profiles
  add constraint profiles_emergency_contact_len check (length(emergency_contact) <= 100);

alter table public.profiles drop constraint if exists profiles_emergency_no_len;
alter table public.profiles
  add constraint profiles_emergency_no_len check (length(emergency_no) <= 20);

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0011', 'cap-remaining-zod-only-text-columns')
on conflict (version) do nothing;
