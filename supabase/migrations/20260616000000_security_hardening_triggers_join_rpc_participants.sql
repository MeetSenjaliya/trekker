-- ============================================================================
-- SECURITY HARDENING — 2026-06-16
-- Fixes three findings on the live database (project dtjmyqogeozrzzbdjokr):
--   #1 CRITICAL  service_role JWT hard-coded in the trek_participants
--                join/leave notification triggers  -> source token from Vault.
--   #2 MEDIUM    join_trek_and_chat lets any user mass-create trek_batches /
--                conversations over unbounded future dates (write-amp DoS)
--                and allows the NULL p_user_id bypass -> require caller +
--                validate p_batch_date.
--   #3 MEDIUM    trek_participants UPDATE policy lets a user rewrite their
--                row's batch_id (review join-gate bypass) -> drop the policy.
--
-- Idempotent: safe to run top-to-bottom in the Supabase SQL editor.
-- ORDER OF OPERATIONS for #1 (see SECURITY_AUDIT_ISSUE.md) — NEW-KEY model:
-- The new publishable/secret API keys are NOT JWTs, so they fail edge-function
-- verify_jwt and can't be sent as Authorization: Bearer. We therefore set the
-- two functions to verify_jwt=false, have them authorize on a shared WEBHOOK
-- SECRET (custom header), and use the secret key (sb_secret_, auto-injected as
-- SUPABASE_SECRET_KEYS) only inside the function for the admin client. The
-- powerful secret key never enters the database/Vault/pg_net.
--   1) Migrate the client to the publishable key; migrate + redeploy the two
--      edge functions (secret-key admin client + verify_jwt=false + webhook-
--      secret check).
--   2) Generate a webhook secret (e.g. `openssl rand -hex 32`); set it as the
--      TREK_WEBHOOK_SECRET env var on both edge functions.
--   3) Run this migration (triggers no-op until the Vault secret exists).
--   4) Store the SAME webhook secret in Vault:
--        select vault.create_secret('<WEBHOOK_SECRET>', 'edge_function_token',
--          'Webhook secret the trek_participants triggers send to the edge fns');
--   5) Verify join/leave -> email; then DEACTIVATE the legacy anon/service_role
--      keys in the dashboard. That is what finally kills the leaked key.
-- ============================================================================


-- ============================================================================
-- #3 — Drop the unsafe UPDATE policy on trek_participants.
-- A WITH CHECK clause cannot reference the OLD row, so there is no way to pin
-- batch_id while allowing UPDATE. Joining is INSERT, leaving is DELETE; no app
-- code updates this table. Removing the policy makes UPDATE default-denied.
-- ============================================================================
drop policy if exists "Users can update own participation" on public.trek_participants;


-- ============================================================================
-- #2 — Harden join_trek_and_chat.
--   * Require p_user_id = auth.uid() (no NULL bypass; never act for another).
--   * Validate p_batch_date: not null, not in the past (1-day tz grace), and
--     within a 1-year forward window — bounds the number of batches/chats a
--     single user can create (the unique (trek_id, batch_date) constraint then
--     collapses duplicates), neutralising the unbounded write-amplification.
--   * Pin search_path to public, pg_temp (SECURITY DEFINER hygiene).
-- NOTE (long-term): batch creation should be separated from joining (admin-
--   created batches; join only attaches to an existing batch). Left in the RPC
--   for now because the app has no other batch-creation path; the date window
--   is the mitigation.
-- ============================================================================
create or replace function public.join_trek_and_chat(
  p_user_id uuid,
  p_trek_id uuid,
  p_batch_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch_id uuid;
  v_convo_id uuid;
  v_participant_id uuid;
  v_trek_title text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Require the caller to act as themselves. Closes the NULL p_user_id bypass.
  if p_user_id is null or p_user_id <> v_uid then
    raise exception 'p_user_id must equal the authenticated user';
  end if;

  -- Validate the batch date to bound batch/conversation creation (DoS guard).
  if p_batch_date is null then
    raise exception 'Batch date is required';
  end if;
  if p_batch_date < current_date - interval '1 day' then
    raise exception 'Cannot join a trek batch in the past';
  end if;
  if p_batch_date > current_date + interval '1 year' then
    raise exception 'Batch date is too far in the future';
  end if;

  -- Trek must exist (also enforced by the trek_batches FK below).
  select title into v_trek_title from public.treks where id = p_trek_id;
  if v_trek_title is null then
    raise exception 'Trek not found';
  end if;

  insert into public.trek_batches (trek_id, batch_date)
  values (p_trek_id, p_batch_date)
  on conflict (trek_id, batch_date) do nothing
  returning id into v_batch_id;
  if v_batch_id is null then
    select id into v_batch_id from public.trek_batches
    where trek_id = p_trek_id and batch_date = p_batch_date limit 1;
  end if;

  insert into public.conversations (batch_id, name)
  values (v_batch_id, (v_trek_title || ' — ' || p_batch_date::text))
  on conflict (batch_id) do nothing
  returning id into v_convo_id;
  if v_convo_id is null then
    select id into v_convo_id from public.conversations
    where batch_id = v_batch_id limit 1;
  end if;

  insert into public.trek_participants (user_id, batch_id)
  values (v_uid, v_batch_id)
  on conflict (user_id, batch_id) do nothing
  returning id into v_participant_id;
  if v_participant_id is null then
    select id into v_participant_id from public.trek_participants
    where user_id = v_uid and batch_id = v_batch_id limit 1;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_convo_id, v_uid)
  on conflict (conversation_id, user_id) do nothing;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'participant_id', v_participant_id,
    'conversation_id', v_convo_id
  );
end;
$$;


-- ============================================================================
-- #1 — Remove the hard-coded service_role JWT from the notification triggers.
-- The two edge functions (send-trek-notification / send-trek-leave-notification)
-- read SUPABASE_SECRET_KEYS from their OWN env for the admin client, and (after
-- migration) run verify_jwt=false, authorizing the caller on a shared WEBHOOK
-- SECRET. So no privileged key belongs in the trigger. This function reads the
-- webhook secret from Vault (never a DDL literal), sends it on a custom header,
-- and adds the PUBLIC publishable key on `apikey` purely for gateway routing.
-- The standard webhook payload (type/record/old_record) is preserved. Fail-safe:
-- any error (missing secret, vault denied, http queue) is swallowed so a
-- notification problem can NEVER roll back a trek join/leave.
-- ============================================================================
create or replace function public.notify_trek_participation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
  -- PUBLIC publishable key (safe in DDL — it ships in the browser bundle). Sent
  -- on `apikey` only so the gateway routes the request. If you rotate the
  -- publishable key, update this literal. Authorization is the webhook secret.
  v_apikey text := 'sb_publishable_9A0yuGlK1_9N_UH6-nVd2A_M2D8OMzM';
  v_base   text := 'https://dtjmyqogeozrzzbdjokr.supabase.co/functions/v1/';
  v_url    text;
  v_body   jsonb;
begin
  -- Webhook secret from Vault — the only credential the DB holds for this call.
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'edge_function_token'
  limit 1;

  -- No secret configured yet -> skip notification, never block join/leave.
  if v_secret is null or length(btrim(v_secret)) = 0 then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_url  := v_base || 'send-trek-notification';
    v_body := jsonb_build_object(
      'type', 'INSERT', 'table', 'trek_participants', 'schema', 'public',
      'record', to_jsonb(new), 'old_record', null
    );
  elsif tg_op = 'DELETE' then
    v_url  := v_base || 'send-trek-leave-notification';
    v_body := jsonb_build_object(
      'type', 'DELETE', 'table', 'trek_participants', 'schema', 'public',
      'record', null, 'old_record', to_jsonb(old)
    );
  else
    return coalesce(new, old);
  end if;

  perform net.http_post(
    url := v_url,
    body := v_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_apikey,                 -- public publishable key, routing only
      'x-trek-webhook-secret', v_secret   -- authorizes the call inside the fn
    ),
    timeout_milliseconds := 5000
  );

  return coalesce(new, old);
exception when others then
  -- A failed notification must never roll back the trek join/leave transaction.
  return coalesce(new, old);
end;
$$;

-- Repoint both triggers at the Vault-sourced function (drops the literal-key
-- supabase_functions.http_request definitions).
drop trigger if exists "trek-join-notification"  on public.trek_participants;
create trigger "trek-join-notification"
  after insert on public.trek_participants
  for each row execute function public.notify_trek_participation();

drop trigger if exists "trek-leave-notification" on public.trek_participants;
create trigger "trek-leave-notification"
  after delete on public.trek_participants
  for each row execute function public.notify_trek_participation();