-- ============================================================================
-- 0005 — cap trek-profile: close the last bucket that can serve a sniffable
--        Content-Type (STORAGE-002, 2026-08-24 pentest)
-- ============================================================================
-- STORAGE-002: public storage objects are served without
-- `X-Content-Type-Options: nosniff`. Confirmed live 2026-08-25 —
-- `curl -D - .../storage/v1/object/public/avatars/<uid>/<file>.jpeg` returns
-- `content-type: image/jpeg`, `cache-control`, and nothing else. The app's own
-- nosniff header is set in next.config.mjs and covers only the Next.js origin;
-- every image the app renders resolves on dtjmyqogeozrzzbdjokr.supabase.co,
-- which is storage-api behind Cloudflare. There is no header configuration for
-- it, so nosniff CANNOT be added from this repo at all — not from
-- next.config.mjs, not from a migration.
--
-- What IS controllable is what nosniff would be protecting: the Content-Type
-- itself. A browser only sniffs when the declared type is absent, generic
-- (application/octet-stream, text/plain) or unknown; a concrete `image/*` is
-- taken at its word by every current engine, HTML bytes or not. So a bucket
-- with `allowed_mime_types` restricted to real image types can never produce a
-- sniffable response, which is the same end state nosniff would buy.
--
-- §9/§12.7 already set that on avatars, trek-reviews, company-logos and
-- trek-images. trek-profile was deliberately left uncapped (14 legacy objects,
-- no object policies, no client write path — see 0001 §9). That reasoning held
-- for the rate-limit work it was written for, where the question was abuse
-- volume. It does not hold here: an uncapped bucket is the one place a
-- non-image Content-Type could ever be stored, and the exemption also means
-- "every public bucket is capped" is not an invariant anyone can assert. Cap it
-- to match the other four. Its 14 existing objects are already image/jpeg and
-- image/png (verified live over MCP), so nothing in flight breaks; the cap
-- applies to writes, and this bucket has no write path to break.
--
-- Residual risk after this, stated plainly: an authenticated user can still
-- upload HTML bytes while DECLARING image/png, since storage-api validates the
-- declared type and does not inspect the bytes. That object is then served as
-- image/png, which Chrome, Firefox and Safari render as a broken image rather
-- than a document. The remaining exposure is legacy engines that sniff anyway,
-- and it lands on the supabase.co origin, not the app's — no app session
-- cookie is reachable from there. Accepted; see FEATURES.md.

update storage.buckets
set file_size_limit    = 3145728,  -- 3 MiB, same ceiling and rationale as §9
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'trek-profile';

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0005', 'cap-trek-profile-bucket-mime')
on conflict (version) do nothing;
