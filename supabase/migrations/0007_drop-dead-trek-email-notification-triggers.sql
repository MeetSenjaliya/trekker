-- ============================================================================
-- 0007 — drop the dead notify_trek_join / notify_trek_remove path
-- ============================================================================
-- `0001` §"notify_trek_join / notify_trek_remove" installed two AFTER triggers
-- on `trek_participants` that `net.http_post` to
-- `/functions/v1/trek-email-notification`. That edge function has never
-- existed: `list_edge_functions` over the read-only MCP (2026-08-25, EDGE-001)
-- returns only `send-trek-notification` and `send-trek-leave-notification`.
-- The pentest's `404` on that slug was an unmatched route, not a broken
-- deployment.
--
-- So every join and every leave has been queuing a pg_net request to a URL that
-- 404s, holding the response in `net._http_response` until pg_net's retention
-- sweeps it. The emails users actually receive come from a different pair of
-- triggers on the same table — `trek-join-notification` /
-- `trek-leave-notification` → `notify_trek_participation()` → the two functions
-- that do exist — which are untouched here.
--
-- Two reasons not to leave this in place as merely inert:
--   * The live function bodies hard-code a legacy anon key (`0001` replaced it
--     with a placeholder rather than reproducing it). That key class is now
--     DISABLED on the project, so the header is a dead credential sitting in a
--     function body — nothing to rotate, but nothing that should stay either.
--   * `notify_trek_join()` has no exception handler, unlike
--     `notify_trek_participation()`, whose `exception when others` comment
--     spells out why a notification must not roll back the transaction. A
--     `net.http_post` that raises here — pg_net absent after a restore, its
--     queue table unavailable — aborts the enclosing INSERT, i.e. fails the
--     join itself. It has not fired, but the shape is wrong.
--
-- Triggers first, then the functions they reference.
drop trigger if exists trek_join_email_trigger on public.trek_participants;
drop trigger if exists trek_remove_email_trigger on public.trek_participants;

drop function if exists public.notify_trek_join();
drop function if exists public.notify_trek_remove();

-- ============================================================================
-- SUPERSEDES the 0001 note on these two functions
-- ============================================================================
-- `0001`'s "these are effectively redundant/dead" is resolved rather than
-- restated: the path is gone. `notify_trek_participation()` and its
-- `trek-join-notification` / `trek-leave-notification` triggers remain the only
-- notification path on `trek_participants`. The `0001` text is history and
-- stays as written.

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0007', 'drop-dead-trek-email-notification-triggers')
on conflict (version) do nothing;
