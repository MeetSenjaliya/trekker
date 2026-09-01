-- ============================================================================
-- 0008 — drop the embedded publishable key from notify_trek_participation()
-- ============================================================================
-- `0001` §notify_trek_participation embeds the project's publishable key as a
-- literal in the function body and sends it on `apikey`, with an inline comment
-- telling whoever rotates the key to come back and edit the DDL. Nothing
-- enforces that. The key is public by design (it ships in the browser bundle),
-- so this was never a disclosure — it is a rotation trap: the day the key is
-- rotated the literal becomes a *wrong* key, and a wrong key is strictly worse
-- than none (see below). The trigger swallows every error, so the failure mode
-- is silent — joins and leaves keep working and the emails just stop.
--
-- The premise behind the header was wrong. `0001`'s comment says the key "rides
-- on `apikey` only for gateway routing"; measured against the live project
-- (2026-08-26), routing does not need it. Both notification functions run
-- `verify_jwt=false`, and the Supabase gateway only validates an `apikey` when
-- one is present:
--
--   no apikey     -> 401 from the FUNCTION (x-served-by: supabase-edge-runtime,
--                    x-deno-execution-id present) — the request reached the
--                    function and its own x-trek-webhook-secret check rejected it
--   valid apikey  -> same: reaches the function, same 401
--   invalid apikey-> 401 {"message":"Invalid API key"} from the GATEWAY, no
--                    execution-id header — the function never runs
--
-- So the header buys nothing and costs a silent outage on rotation. Dropping it
-- leaves no key material of any kind in DDL and nothing to keep in sync.
--
-- Authorization is unchanged and was never the `apikey`: it is the shared secret
-- read from Vault (`edge_function_token`) and sent on `x-trek-webhook-secret`,
-- which both functions compare in constant time. Everything else about the
-- function — SECURITY DEFINER (to read `vault.decrypted_secrets`), the pinned
-- search_path, the skip-when-no-secret branch, and the `exception when others`
-- that keeps a failed notification from rolling back a join or leave — is
-- carried over verbatim.
create or replace function public.notify_trek_participation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
  v_base   text := 'https://dtjmyqogeozrzzbdjokr.supabase.co/functions/v1/';
  v_url    text;
  v_body   jsonb;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'edge_function_token'
  limit 1;

  if v_secret is null or length(btrim(v_secret)) = 0 then
    return coalesce(new, old);   -- no secret yet -> skip, never block join/leave
  end if;

  if tg_op = 'INSERT' then
    v_url  := v_base || 'send-trek-notification';
    v_body := jsonb_build_object(
      'type','INSERT','table','trek_participants','schema','public',
      'record', to_jsonb(new), 'old_record', null
    );
  elsif tg_op = 'DELETE' then
    v_url  := v_base || 'send-trek-leave-notification';
    v_body := jsonb_build_object(
      'type','DELETE','table','trek_participants','schema','public',
      'record', null, 'old_record', to_jsonb(old)
    );
  else
    return coalesce(new, old);
  end if;

  -- No `apikey` header on purpose: the gateway routes verify_jwt=false
  -- functions without one, and a stale literal here would 401 at the gateway
  -- and be swallowed by the handler below. Do not re-add one.
  perform net.http_post(
    url := v_url,
    body := v_body,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-trek-webhook-secret', v_secret   -- the only credential; authorizes inside the fn
    ),
    timeout_milliseconds := 5000
  );

  return coalesce(new, old);
exception when others then
  return coalesce(new, old);     -- notification failure must not roll back the tx
end;
$$;

-- `create or replace` preserves the ACL, and this function is reached only as a
-- trigger (Postgres checks EXECUTE at CREATE TRIGGER time, not at fire time), so
-- there is nothing to re-grant. The `trek-join-notification` /
-- `trek-leave-notification` triggers on `trek_participants` are untouched and
-- pick up the new body on their next fire.

-- ============================================================================
-- SUPERSEDES the 0001 note on notify_trek_participation
-- ============================================================================
-- `0001`'s "the PUBLIC publishable key rides on `apikey` only for gateway
-- routing" and the two inline "routing only" comments no longer describe the
-- function. The `0001` text is history and stays as written.

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0008', 'drop-embedded-publishable-key-from-notification-trigger')
on conflict (version) do nothing;
