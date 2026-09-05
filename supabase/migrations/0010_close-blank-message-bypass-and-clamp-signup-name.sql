-- ============================================================================
-- 0010 — finish the message bypass 0009 half-closed, and stop a long signup
--        name from failing the signup outright
-- ============================================================================
-- Two follow-ons from 0009, found by re-reading it against the live database on
-- 2026-09-02 rather than against the finding list it was written from.
--
-- ---------------------------------------------------------------------------
-- 1. `conversation_messages.message` had a ceiling and no floor
-- ---------------------------------------------------------------------------
-- `0009` added `length(message) <= 2000` and stopped there, so a direct
-- PostgREST insert could still write `''` or `'   '`. `messageSchema` requires
-- at least one character after trimming; the database did not. That is the same
-- skip-the-form bypass `0009` set out to close, left open on the other side.
--
-- The floor cannot be unconditional. Soft-delete is an UPDATE setting
-- `is_deleted = true, message = ''` (`src/app/(trekker)/messages/page.tsx:444`),
-- so the empty string is load-bearing for exactly one row shape. The constraint
-- therefore allows blank only on a row that is marked deleted — which is why
-- `0009` deliberately shipped no floor at all rather than a wrong one.
--
-- The constraint alone would be close to decorative. Nothing pinned
-- `is_deleted` on insert: the `Send messages` policy checks `user_id`, chat
-- participation and `is_announcement = false`, so a client could insert a blank
-- row with `is_deleted = true` and satisfy the new CHECK on the way past. The
-- policy is replaced here to pin `is_deleted` the same way it already pins
-- `is_announcement`. A message can only be *born* live and non-blank; deletion
-- stays an UPDATE, which is the only thing that could ever have blanked it.
--
-- `coalesce(is_deleted, false)` in both, not a bare `= false`: the column is
-- nullable, and an explicit null would otherwise make the policy's comparison
-- null and reject a write the app never intended to send. The app's insert
-- (`page.tsx:398`) omits the column entirely and takes the `false` default, so
-- this changes nothing for it either way — it is the unknown client that the
-- coalesce protects.
--
-- `Edit own messages` (UPDATE) is deliberately untouched. It is the delete
-- path: pinning `is_deleted` there would make deletion impossible. Blanking a
-- message *without* deleting it is already refused by the new CHECK.
--
-- ---------------------------------------------------------------------------
-- 2. `handle_new_user()` had no clamp, so `0009` made it a failure path
-- ---------------------------------------------------------------------------
-- The trigger copies `raw_user_meta_data->>'full_name'` into `profiles`
-- unbounded. Before `0009` a long name was simply stored. Since `0009` it hits
-- `profiles_full_name_len` and raises.
--
-- The blast radius is smaller than it first looks and worth stating precisely,
-- because the earlier note on this was wrong: `on_auth_user_created` is an
-- AFTER INSERT trigger with no exception handler, running in the same
-- transaction as the `auth.users` insert. A CHECK violation therefore aborts
-- the whole transaction and the `auth.users` row rolls back with it. There is
-- no half-created account — the signup fails cleanly, with an opaque 500.
--
-- Today that is reachable only by calling the GoTrue signup API directly, since
-- `signUpSchema.fullName` gained a matching `.max(100)` in `0009`'s change. It
-- becomes reachable by ordinary users the day a social provider is added:
-- provider display names are unbounded and not ours to validate. `email` is the
-- only provider on the project right now (5 identities, longest metadata name
-- 15 chars), so this is pre-emptive.
--
-- Clamping rather than raising is the right trade for a cosmetic field. A name
-- that is too long is not a reason to refuse someone an account, and a 500 from
-- inside a trigger is the least debuggable way to tell them. `left()` is
-- null-safe and runs after the existing `nullif(trim(...), '')`, so the "unset"
-- null is unchanged.
--
-- Everything else about the function is carried over verbatim: SECURITY
-- DEFINER, the pinned search_path, the account_type branch and its
-- anything-but-'company' fallback, and `on conflict (id) do nothing`.
--
-- ---------------------------------------------------------------------------
-- Existing data: checked over the read-only MCP on 2026-09-02 immediately
-- before writing. 76 messages, 0 blank, 0 blank-and-not-deleted, 0 deleted rows
-- carrying text. No backfill.

-- ---- 1a. the floor -----------------------------------------------------------
alter table public.conversation_messages
  drop constraint if exists conversation_messages_message_not_blank;
alter table public.conversation_messages
  add constraint conversation_messages_message_not_blank
  check (coalesce(is_deleted, false) or length(btrim(message)) > 0);

-- ---- 1b. pin is_deleted on insert -------------------------------------------
-- Reproduces the `0001` policy verbatim plus the final clause. Roles
-- (`authenticated`) and permissiveness are unchanged.
drop policy if exists "Send messages" on public.conversation_messages;
create policy "Send messages" on public.conversation_messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and is_chat_participant(conversation_id)
    and is_announcement = false
    and coalesce(is_deleted, false) = false
  );

-- ---- 2. clamp the signup name -----------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, account_type)
  values (
    new.id,
    new.email,
    -- Clamped, not validated: profiles_full_name_len (0009) would otherwise
    -- raise here and abort the enclosing auth.users insert.
    left(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 100),
    case
      when new.raw_user_meta_data->>'account_type' = 'company'
        then 'company'::public.account_type
      else 'trekker'::public.account_type
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- `create or replace` preserves the ACL, and the function is reached only as a
-- trigger, so there is nothing to re-grant. `on_auth_user_created` on
-- auth.users is untouched and picks up the new body on its next fire.

-- ============================================================================
-- SUPERSEDES the 0009 note on the message floor
-- ============================================================================
-- `0009`'s "Only upper bounds on the two text columns" explained why an
-- unconditional `length(message) >= 1` was wrong. That reasoning stands; the
-- conditional floor added here is what it was missing. The `0009` text is
-- history and stays as written.

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0010', 'close-blank-message-bypass-and-clamp-signup-name')
on conflict (version) do nothing;
