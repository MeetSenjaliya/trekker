-- ============================================================================
-- 0009 — teach the database the length and range caps the forms already enforce
-- ============================================================================
-- Six columns are validated in `src/lib/schemas.ts` and nowhere else. Zod runs
-- in the browser, so every one of these caps is advisory: the app talks to
-- PostgREST with the publishable key, and a caller who skips the form — curl,
-- the browser console, any REST client — writes whatever it likes. The 2026-08
-- Day 7 pentest pass recorded all six (`strix-prompts/day 7 results.md`, and
-- `TEST.md` §7.2.1 for the message case, which is the one with a real abuse
-- story: an unbounded `message` is a storage and render-cost amplifier against
-- every other member of a batch chat).
--
-- `post_batch_announcement()` already restates the 2000-char cap, but only for
-- announcements, and only because that RPC happens to be the one write path
-- that goes through a function. A direct insert into `conversation_messages`
-- has never had a server-side bound. That is the bypass this closes.
--
-- Range, not just length: `estimated_cost` accepted negatives (a trek that pays
-- you to attend) and both `max_participants` columns accepted zero and negative
-- capacity. Zero is rejected rather than merely negatives — a departure with
-- zero seats is not a state the product has any meaning for, and NULL already
-- carries "no limit". `src/lib/schemas.ts` moves to a `>= 1` floor in the same
-- change so the form still answers with an inline message instead of letting a
-- constraint violation surface raw.
--
-- NULL is deliberately still accepted on all five nullable columns: a CHECK
-- evaluates to unknown on NULL and passes. `full_name` NULL is the intended
-- "unset" (`handle_new_user()` inserts `nullif(trim(...), '')`), and
-- `max_participants` NULL is "uncapped". Nothing about the unset case changes.
--
-- Only upper bounds on the two text columns. `length(message) >= 1` would look
-- symmetrical with `messageSchema` and would break message deletion: the client
-- soft-deletes by setting `is_deleted = true, message = ''`
-- (`src/app/(trekker)/messages/page.tsx:444`), so the empty string is a
-- load-bearing value, not a gap.
--
-- Safe to apply with no backfill and no NOT VALID staging. Checked against the
-- live project over the read-only MCP on 2026-09-02, immediately before writing
-- this: 0 rows violate any of the six. Widest values seen were an 811-char
-- message, an 18-char full_name and a 6-char bio, against caps of 2000/100/500.
--
-- `drop constraint if exists` before each `add constraint` because Postgres has
-- no `add constraint if not exists` and this file has to survive being run
-- twice in the SQL Editor. No earlier migration needed this — the idempotence
-- elsewhere comes free from `create or replace` / `if not exists`.

-- ---- conversation_messages -------------------------------------------------
alter table public.conversation_messages
  drop constraint if exists conversation_messages_message_len;
alter table public.conversation_messages
  add constraint conversation_messages_message_len check (length(message) <= 2000);

-- ---- treks -----------------------------------------------------------------
alter table public.treks
  drop constraint if exists treks_estimated_cost_nonneg;
alter table public.treks
  add constraint treks_estimated_cost_nonneg check (estimated_cost >= 0);

alter table public.treks
  drop constraint if exists treks_max_participants_positive;
alter table public.treks
  add constraint treks_max_participants_positive check (max_participants > 0);

-- ---- trek_batches ----------------------------------------------------------
alter table public.trek_batches
  drop constraint if exists trek_batches_max_participants_positive;
alter table public.trek_batches
  add constraint trek_batches_max_participants_positive check (max_participants > 0);

-- ---- profiles --------------------------------------------------------------
-- Mirrors profileUpdateSchema / accountNameSchema (100) and the bio cap (500).
-- signUpSchema.fullName had no cap at all until this change; without the
-- matching Zod `.max(100)` a long signup name would fail inside
-- handle_new_user(), after auth.users already had the row.
alter table public.profiles
  drop constraint if exists profiles_full_name_len;
alter table public.profiles
  add constraint profiles_full_name_len check (length(full_name) <= 100);

alter table public.profiles
  drop constraint if exists profiles_bio_len;
alter table public.profiles
  add constraint profiles_bio_len check (length(bio) <= 500);

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0009', 'add-input-validation-check-constraints')
on conflict (version) do nothing;
