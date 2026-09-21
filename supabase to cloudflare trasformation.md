# Move all file storage from Supabase Storage to Cloudflare R2

## Context

Decision already made (this conversation): uploads go through **a Next.js route handler on Vercel** (option A), not a Supabase Edge Function or a Cloudflare Worker — one platform, one deploy, one place to debug. Scope confirmed by the user: **replace every Supabase Storage upload with R2**, and keep the *current* permission and rate-limit rules, which today live in `storage.objects` RLS policies and a trigger. R2 client: **`aws4fetch`**. The trek-reviews rule is kept even though nothing uploads to it yet.

also remember keep current photos, profile pics ,as it is we will manually transfer it later
and we will have same architecture for trek image profile rest change everything to cloudfare r2

**Starting point: no Cloudflare account artifacts exist yet.** No bucket, no API token, no env vars — Part 1 below creates all of it from scratch.

What exists today (from exploration):

- **3 write sites**, all browser-side `supabase.storage.from(bucket).upload(path, file, {upsert:true})` then `getPublicUrl()` → stored as an absolute URL in `profiles.avatar_url`, `treks.cover_image_url`, `companies.logo_url` / `cover_image_url` (`trek_reviews.photo_urls` holds the same shape, no writer):
  - `src/app/(trekker)/profile/edit/page.tsx:145-162` → `avatars/{uid}/{ts}.{ext}`
  - `src/components/admin/TrekForm.tsx:77-87` → `trek-images/{companyId}/{trekId}/{ts}-{name}`
  - `src/app/dashboard/settings/page.tsx:87-101` → `company-logos/{companyId}/[cover-]{ts}-{name}`
- **Rules to preserve** (`supabase/schema.sql`, live versions): avatars/trek-reviews → first folder = `auth.uid()`; company-logos → `is_company_member(c) AND is_company_writable(c)` (status pending|approved); trek-images → `is_approved_company_member(c)` (status approved). All buckets are `public = true` (anyone with the URL can read; SELECT policies only gate API *listing*). Caps: 3 MiB, `image/jpeg|png|webp`. Rate: **6/hour** action `upload` shared across avatars+company-logos+trek-images, **20/hour** action `upload:review` — via trigger `storage_objects_rate_limit` → `enforce_storage_rate_limit()`, rule table `storage_rate_rule(bucket)`, client probe `upload_rate_limited(bucket)`, all counting in `rate_events` (0 policies, 0 client grants).
- **Host coupling**: `next.config.mjs:20-33` remotePatterns (3 `<Image>` sites), `src/utils/csp.ts:65` img-src, and 5 hard-coded `…supabase.co/storage/v1/object/public/…` default-image literals (`src/lib/site.ts:18`, `TrekDetailClient.tsx:54`, `ExploreClient.tsx:10`, `HeroSection.tsx:4`, `profile/edit/page.tsx:243`) pointing at the 14 legacy `trek-profile` objects.
- **Middleware** (`src/utils/supabase/middleware.ts:86-91`) redirects any unauthenticated non-public path — including a future `/api/*` — to `/auth/login`; a `fetch()` would follow that and receive HTML with status 200.
- **Tests that pin the old world**: `tests/db/storage-writes.test.ts` (30), `storage-listing.test.ts` (12), `storage-content-type.test.ts` (2); `tests/db/acl.test.ts:63-108` has an exact list of definer functions that includes `enforce_storage_rate_limit`.

Outcome: one route handler owns upload authorization, validation and rate limiting; images are served from R2's public URL; Supabase Storage is emptied of responsibilities and can be deleted after cutover.

---

## Design (the parts that matter)

**Bytes go through the route, not a presigned URL.** Files are already compressed client-side to ~1 MB and hard-capped at 3 MiB; Vercel's function body limit is 4.5 MB. Proxying lets the server verify the real file type from magic bytes (Supabase never could — see the nosniff note in `tests/db/storage-content-type.test.ts`) and keeps R2 credentials and CORS entirely server-side.

**R2 key = `{bucket}/{path}` — same layout as today.** So the existing URL `https://dtjmyqogeozrzzbdjokr.supabase.co/storage/v1/object/public/avatars/x/y.jpg` becomes `https://<R2_PUBLIC>/avatars/x/y.jpg`: the data migration is a prefix `replace()` per column, and the copy script is a 1:1 key copy.

**The route runs as the signed-in user.** It uses `createClient()` from `src/utils/supabase/server.ts` (cookie session), so the company checks are the *same RPCs the policies call today* (`is_company_member`, `is_company_writable`, `is_approved_company_member` — all granted to `authenticated`), and the new rate-limit RPC sees `auth.uid()`. No service key anywhere.

**Rate limiting moves from a storage trigger to one SECURITY DEFINER RPC** `record_upload(p_bucket)` that atomically counts-then-inserts in `rate_events` (advisory lock like `enforce_trek_email_rate_limit`) and returns `true`/`false`. Called *before* the R2 write. Because the route returns a real 429 with a message, the `upload_rate_limited` probe — which existed only because storage-api swallowed the trigger's error — is no longer needed.

**Server-generated object names.** The client's filename is never used (only the sniffed type picks the extension): `{ts}-{6 random hex}.{ext}`. Path ids (`companyId`, `trekId`) are validated as UUIDs with zod. This closes the `sanitizeFileName` `..`/empty-string gap noted in exploration and satisfies "never store PII in file names".

---

## Part 1 — Cloudflare setup + application code (Supabase Storage still live, nothing user-facing changes)

> **Status 2026-09-21: code side (1b, 1c, verification except the live-bucket e2e) DONE and green** — build, lint 0 errors, 429 tests. Two deviations from the text below: the default-image constants live in a new client-safe `src/lib/defaultImages.ts` rather than `site.ts` (whose header forbids client imports); and the Cloudflare MCP token can list R2 but not write (`10000: Authentication error` on create), so **1a is still yours to do in the dashboard** — the bucket, its r2.dev public access and the bucket-scoped token. Once the five vars are in `.env.local`, run the local end-to-end list at the bottom of Part 1, then Part 2.


Goal: everything R2-related exists and passes CI locally, but production still serves 100% from Supabase Storage. Safe to do at any pace; no cutover risk yet.

### 1a. Cloudflare (user, dashboard) — from scratch

1. Create the R2 bucket (e.g. `trekker-media`).
2. Enable public access — either the bucket's `r2.dev` subdomain or a custom domain. Either way the plan only needs the resulting base URL.
3. Create an API token scoped to that one bucket with Object Read & Write.
4. Put the 5 resulting env vars in `.env.local` and in Vercel (Production + Preview) — see table below.

### 1b. New files

| File | Purpose |
|---|---|
| `src/app/api/upload/route.ts` | `POST` only. Node runtime. Steps: `getUser()` → 401; parse `formData` (`file`, `kind`, `companyId?`, `trekId?`) with a zod schema → 400 `invalid`; size > 3 MiB → 413 `too_large`; sniff magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF….WEBP`) → 415 `unsupported_type`; `authorizeUpload()` → 403 `forbidden`; `rpc('record_upload', {p_bucket})` false → 429 `rate_limited`; `AwsClient.fetch(PUT …)` with `Content-Type` + `Cache-Control: public, max-age=31536000, immutable` (keys are unique, so this is free) → 500 `failed` (logged with `logError`); respond `{ url }`. |
| `src/lib/uploadRules.ts` | Pure, testable: `UPLOAD_KINDS` (`avatar`, `review`, `company-logo`, `company-cover`, `trek-cover`) → bucket + key builder; `sniffImageType(bytes): 'jpeg'\|'png'\|'webp'\|null`; `authorizeUpload(kind, ids, uid, rpc)` where `rpc` is an injected `(fn, args) => Promise<boolean>` so the rule table is unit-tested without Supabase (matches the policy in `src/lib/company.test.ts:10-19`). Rules: avatar/review → owner (`uid` is the folder, nothing to check); company-logo/company-cover → `is_company_member && is_company_writable`; trek-cover → `is_approved_company_member`. |
| `src/lib/uploadRules.test.ts` | Unit tests: each kind's key layout; each rule's allow/deny per RPC answer; sniff accepts the 3 formats and rejects SVG/HTML/GIF/truncated buffers. |
| `src/lib/upload.ts` | Browser helper `uploadImage(file, { kind, companyId?, trekId? }): Promise<string>` — `fetch('/api/upload', { method:'POST', body: FormData })`, throws `UploadError(uploadErrorMessage(code))` on non-2xx. Replaces the three inline upload blocks. |
| `src/lib/r2.ts` | `r2Client()` — builds `new AwsClient({ accessKeyId, secretAccessKey, service:'s3', region:'auto' })` from `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`; exports `r2ObjectUrl(key)` = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}` and `publicUrl(key)` = `${NEXT_PUBLIC_R2_PUBLIC_URL}/${key}`. Throws a plain Error if an env var is missing (a 500 + `logError`, not silent). |
| `supabase/migrations/0030_record-upload-rpc-for-the-r2-upload-route.sql` | `create or replace function public.record_upload(p_bucket text) returns boolean` — plpgsql, `security definer`, `set search_path = public, pg_temp`; `v_uid := auth.uid()` (null → `false`); rule from existing `storage_rate_rule(p_bucket)` (null action → `false`); `pg_advisory_xact_lock(hashtextended(v_action || ':' || v_uid::text, 0))`; count last hour ≥ limit → `false`; else insert `rate_events(actor, action)` and `true`. `revoke all … from public, anon; grant execute … to authenticated;` + ledger insert. Header comment in the 0029 style explaining why. **Additive only — old trigger stays, nothing breaks if this never gets called yet.** |
| `tests/db/upload-rate.test.ts` | Replaces the three storage test files: `record_upload` as trekkerA allows 6 then refuses the 7th for `avatars`; `company-logos`/`trek-images` share the same counter; `trek-reviews` has its own 20; `trek-profile`/unknown bucket → `false` with no row written; anon → permission denied. (The "after 0031 no policies remain" assertions move to Part 3.) |
| `scripts/migrate-storage-to-r2.mjs` | One-off, idempotent copy script — written now, **run in Part 2**. Uses the Supabase **secret** key (`SUPABASE_SECRET_KEY`, run locally, never committed) to `storage.list()` every bucket recursively, downloads each object, `PUT`s it to R2 at the identical key with its `Content-Type` and the immutable cache header, skips keys that already exist (HEAD), prints a count per bucket. Uses `aws4fetch` directly, no Supabase client needed for R2. |
| `scripts/rewrite-storage-urls.sql` | The one-off data update — written now, **run in Part 3** after the copy is verified: `update public.profiles set avatar_url = replace(avatar_url, '<old prefix>', '<new prefix>') where avatar_url like '<old prefix>%';` and the same for `treks.cover_image_url`, `companies.logo_url`, `companies.cover_image_url`, and `trek_reviews.photo_urls` (`array(select replace(u, …) from unnest(photo_urls) u)`). Ends with a `select count(*)` per column proving zero old-prefix URLs remain. Not a migration: it's environment data, and it would otherwise land in the generated `schema.sql`. |

### 1c. Modified files

- **`package.json`** — add `aws4fetch`.
- **`.env.local.example`** — add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `NEXT_PUBLIC_R2_PUBLIC_URL` (with a comment that the last is the bucket's public base URL — `https://pub-….r2.dev` or a custom domain — no trailing slash).
- **Three upload sites** → replace the `storage.from().upload()` + `getPublicUrl()` block with `const url = await uploadImage(compressed, { kind, companyId, trekId })`. `compressImage()` stays exactly where it is. Error handling stays (`UploadError` is still thrown).
  - `src/app/(trekker)/profile/edit/page.tsx` (`kind:'avatar'`)
  - `src/components/admin/TrekForm.tsx` (`kind:'trek-cover'`)
  - `src/app/dashboard/settings/page.tsx` (`kind:'company-logo'` / `'company-cover'`)
- **`src/lib/uploadErrors.ts`** — `uploadErrorMessage(code: string): string` — synchronous map of the route's error codes to the existing user-facing strings; the `upload_rate_limited` RPC round-trip and the Supabase status/message matching are deleted (the header comment explaining the storage-api `500 {}` problem goes with them). `UploadError` class unchanged.
- **`src/utils/supabase/middleware.ts`** — before the redirect at line 86: if `pathname.startsWith('/api/')` and no user → `NextResponse.json({ error: 'unauthenticated' }, { status: 401 })`. One `if`.
- **`next.config.mjs`** — `remotePatterns`: add the R2 public host (parsed from `process.env.NEXT_PUBLIC_R2_PUBLIC_URL`; pathname `/**`). Keep the Supabase pattern until Part 3, step 8.
- **`src/utils/csp.ts:65`** — add `originOf(process.env.NEXT_PUBLIC_R2_PUBLIC_URL)` to `img-src` (keep `supabaseOrigin` there until Part 3, step 8; it stays in `connect-src` forever). `src/utils/csp.test.ts` doesn't assert `img-src`, so no test change.
- **Default-image literals** → `src/lib/site.ts` becomes the single owner: `DEFAULT_TREK_IMAGE = \`${NEXT_PUBLIC_R2_PUBLIC_URL}/trek-profile/defaulttrek.jpeg\`` plus `DEFAULT_HERO_IMAGE` and `DEFAULT_AVATAR_IMAGE`; `TrekDetailClient.tsx:54`, `ExploreClient.tsx:10`, `HeroSection.tsx:4`, `profile/edit/page.tsx:243` import from it (every one of those lines has to change anyway — consolidating is the same edit, not extra scope). **Note:** the underlying objects (`trek-profile/*`) aren't copied until Part 2's script runs, so these literals will 404 until then — fine, since Part 1 never deploys past `main` on its own if you want a clean gap (see Part 2 step order).
- **`tests/db/acl.test.ts:63-108`** — remove `'enforce_storage_rate_limit'` from the exact list only in Part 3 (it's still live until 0031 drops it). `record_upload` is `authenticated`-granted so it passes both list tests as-is, starting now.
- **Delete** `tests/db/storage-writes.test.ts`, `tests/db/storage-listing.test.ts`, `tests/db/storage-content-type.test.ts` — do this in Part 3, not now (they still assert real policies until 0031 removes them). `tests/db/harness/shim.sql` storage model **stays** (0001 still creates those policies during replay); `fixtures.ts:141-155` storage rows stay (harmless, superuser inserts).
- **Docs** (same change as the code, per CLAUDE.md):
  - `CLAUDE.md:60` — "no custom backend server" → "no custom backend except `src/app/api/upload/route.ts`, which owns file uploads to Cloudflare R2 (rules in `src/lib/uploadRules.ts`)". Also add R2 env vars to the Directory Structure note.
  - `FEATURES.md` — new §2 row "Storage on Cloudflare R2 (route + RPC live)" with evidence; bump "Last updated". Full row (rate-limit evidence moved, gotchas struck) finishes in Part 3.
  - `DATABASE.md` §6 — add `record_upload` row (old storage rows stay until Part 3).
  - `supabase/security-fixes.sql` — append rationale for 0030.
  - `supabase/schema.sql` — **regenerated** with `npm run db:schema`, never hand-edited.
  - `graphify --update` after the doc edits.

### Part 1 verification

- **Unit:** `npx vitest run --project unit` — `uploadRules.test.ts` covers keys, rules and sniffing.
- **DB:** `npx vitest run --project db` — `upload-rate.test.ts` proves the limits and grants (policies-removed assertions come in Part 3); `schema-is-generated.test.ts` proves `schema.sql` matches 0030; `acl.test.ts` still passes as-is.
- **Build + lint:** `npm run build && npm run lint` — TS strict, `no-explicit-any`, both React Compiler rules.
- **Local end-to-end (dev server, real R2 bucket, before 0030 is applied anywhere but locally):**
  - Upload an avatar → object appears in R2 under `avatars/{uid}/…`, `profiles.avatar_url` starts with the R2 host, image renders on `/profile`.
  - As the non-admin trekker account (see memory `test-account-platform-admin`), POST `kind:'company-cover'` with someone else's `companyId` → 403; a pending company can upload a logo but not a trek cover (403); an approved one can do both.
  - Rename a `.html` to `.jpg` and upload → 415. A 3.5 MB JPEG → 413.
  - 7 avatar uploads in an hour → 7th is 429 with "You have uploaded too many images in the last hour…", and `rate_events` (read over MCP) shows exactly 6 rows.
  - Signed out, `fetch('/api/upload')` → 401 JSON, not a redirect.
- **Do not merge to `main` yet** if you want Supabase Storage to keep serving everything untouched — see Part 2 for when 0030 actually goes live and code deploys.

---

## Part 2 — Go live: copy objects, activate R2 for new uploads (dual-host, zero downtime)

Goal: production starts writing new uploads to R2 while every existing image still renders from Supabase. Nothing is deleted or rewritten on the Supabase side yet — this step is reversible by reverting the deploy.

Steps (order is load-bearing):

1. **Copy objects:** `SUPABASE_SECRET_KEY=… node scripts/migrate-storage-to-r2.mjs`. Re-run until it reports 0 new copies. Spot-check three URLs (including a `trek-profile` default image) in a browser.
2. **Apply `0030`** in the SQL Editor (adds `record_upload`; nothing else changes yet — the old trigger is still in place too). Confirm via the ledger query.
3. **Deploy** `git push origin a1:main`. New uploads now go to R2 (route uses `record_upload`, not the old trigger — the old trigger keeps running harmlessly against `storage.objects` but nothing writes there anymore); existing images still render from Supabase (old URLs, both hosts allowed in `next.config.mjs` / CSP).

### Part 2 verification

- Upload a fresh avatar/trek-cover/company-logo in prod → new URL is the R2 host, image renders.
- An old profile/trek/company still renders its pre-existing Supabase-hosted image.
- Rate limit still enforced (6/hour shared, 20/hour review) via `record_upload`.
- Sentry shows no new `/api/upload` errors.

---

## Part 3 — Cutover: rewrite old URLs, retire Supabase Storage

Goal: every stored URL points at R2; Supabase Storage's policies/trigger/tests are removed; after a settle period, the Supabase buckets themselves are deleted.

Steps:

1. **Rewrite URLs:** paste `scripts/rewrite-storage-urls.sql` into the SQL Editor. Its final `select count(*)` per column must be zero.
2. **Apply `0031`** — new migration: `drop trigger if exists storage_objects_rate_limit on storage.objects; drop function if exists public.enforce_storage_rate_limit(); drop function if exists public.upload_rate_limited(text);` and `drop policy if exists "<each of the 14 storage.objects policies>" on storage.objects;`. Keeps `storage_rate_rule` (now used by `record_upload`) and the bucket rows (deleted from the dashboard after verification — buckets with objects can't be dropped by SQL anyway). + ledger insert. Confirm via ledger query; `npm run db:schema` committed matching it.
3. Finish the deferred edits from Part 1:
   - Remove `'enforce_storage_rate_limit'` from `tests/db/acl.test.ts:63-108`.
   - Delete `tests/db/storage-writes.test.ts`, `tests/db/storage-listing.test.ts`, `tests/db/storage-content-type.test.ts`.
   - Add the "after 0031 no policies remain on `storage.objects`" assertions to `tests/db/upload-rate.test.ts`.
   - `FEATURES.md` — move storage rate-limit rows' evidence to `record_upload`; strike the Supabase-storage Known Gotchas that no longer apply; bump "Last updated".
   - `DATABASE.md` §7 (drop trigger row), §8/§9 (storage section → "Storage is on R2; see route"), §11 (`public_bucket_allows_listing` advisor entry resolves once buckets are deleted).
   - `supabase/security-fixes.sql` — append rationale for 0031.
   - `supabase/schema.sql` — regenerate.
   - `graphify --update`.
4. **After a few days clean:** delete the five Supabase buckets in the dashboard; remove the Supabase pattern from `next.config.mjs` remotePatterns and `supabaseOrigin` from `img-src`; deploy. (Small follow-up commit, tracked as a §1 row in FEATURES.md until done.)

### Part 3 verification

- **DB:** `npx vitest run --project db` — `upload-rate.test.ts` proves no policies remain and old functions are gone; `acl.test.ts` passes with the trimmed list; `schema-is-generated.test.ts` proves `schema.sql` matches 0031.
- **Prod:** `select count(*) from profiles where avatar_url like '%supabase.co%'` = 0 (and the other four columns); trek detail, explore, company page and the OG image render; Sentry shows no new `/api/upload` errors.
- **Build + lint:** `npm run build && npm run lint` still green after test deletions.

---

## Out of scope (parity with today, noted for FEATURES.md §1)

- Deleting the previous avatar/logo/cover on re-upload (today's uploads orphan the old object too).
- Wiring `ReviewForm` to actually upload (`kind:'review'` is supported by the route; the form still never sends).
- Verifying `trekId` belongs to `companyId` on trek-cover uploads (today's policy checks only the company folder; the key is still server-built so nothing can escape the company prefix).
