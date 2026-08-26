# Trekker — Feature Status

Single source of truth for what's built and what's pending.

> **Maintenance rule:** Whenever a feature is added, changed, or completed, update
> this file in the same change. See the "Feature Tracking" section in `CLAUDE.md`.
>
> **Layout:** **§1** is the working backlog — features to add and changes still to
> make; it opens with [1.0 Next actions](#10-next-actions-ordered--start-at-the-top).
> **§2** is the record of everything already shipped. **§3** is the dated changelog.
> Move an entry from §1 to §2 once it's done, and add a §3 entry describing it.

Legend: ✅ Done · 🟡 Partial / in progress · ❌ Not started

_Last updated: 2026-08-20 — full history in [§3 Changelog](#3--changelog-newest-first)._

## Contents

| Section | What lives there |
|---------|------------------|
| [§1 — To do](#1--to-do-add--change--fix) | The backlog. Start at [1.0 Next actions](#10-next-actions-ordered--start-at-the-top) |
| [§2 — Done](#2--done-shipped-features--changes) | What shipped, with evidence (source files + `schema.sql` sections) |
| [Known Gotchas](#known-gotchas) | Invariants, and intentional designs that look like bugs — read before "fixing" one |
| [§3 — Changelog](#3--changelog-newest-first) | Dated history, newest first (was the one giant `_Last updated:` paragraph) |

---

# §1 — To do (add / change / fix)

> ⚠️ DB changes are applied manually in the Supabase SQL editor (read-only MCP), but each one is
> now a numbered, append-only file in [`supabase/migrations/`](supabase/migrations/README.md);
> `supabase/schema.sql` is **generated** from them (`npm run db:schema`). Before treating a
> DB-backed feature as live, confirm the migration is recorded in
> `supabase_migrations.schema_migrations` — a file's own comment is not evidence (§1.3 of
> `CODE_REVIEW.md`).

## 1.0 Next actions (ordered — start at the top)

| # | Do this | Why it matters | Detail |
|---|---------|----------------|--------|
| 1 | **Push.** `a1` is 20 commits ahead of `main` | Everything below the line in §2 — multi-tenant, account split, batch announcements, both hardening applies, **the migrations, the 124-test suite, the chat indexes, the security headers and now the CVE bumps** — exists only on one branch. Prod deploys `main` (`git push origin a1:main`) | `CODE_REVIEW.md` §1.1 |
| 2 | Confirm `NEXT_PUBLIC_SITE_URL` is set in Vercel | Without it, canonical + OG URLs fall through to `VERCEL_PROJECT_PRODUCTION_URL` (the `*.vercel.app` domain), and to `localhost:3000` off-Vercel | [§1.3](#seo) |
| 3 | **After** #2 ships: re-scrape already-shared trek links so the generated OG card replaces the cached cover photo | Link scrapers cache the *page*, not the image — nothing in the app can force a refresh. Doing this before #2 just re-caches the `*.vercel.app` URL | [§1.3](#seo) |
| 4 | **After** the headers deploy: watch Sentry CSP reports for ~a week, then set `CSP_ENFORCE=1` in Vercel | The policy ships **report-only**, so today it blocks nothing. Until it is promoted, the `connect-src` exfiltration cap — the part that actually protects the browser-held Supabase session — is inert | [§1.5](#15-phase-0--security-tail-remaining) |
| 5 | Enable leaked-password protection **server-side** in the Supabase dashboard | `isPasswordPwned()` runs in the browser and gates a call the browser makes directly to GoTrue — anyone can `POST /auth/v1/signup` and skip it. Only the platform setting binds | [§1.5](#leaked-password-protection-is-client-side-only) |

> **The DB backlog is empty as of 2026-08-18.** Migration `0003_lock-platform-admins-grants`
> applied and **verified live** (10:08 UTC): `platform_admins.relacl` is now
> `{postgres, service_role}` only — `anon`/`authenticated` hold no privilege
> (`has_table_privilege` false for SELECT+INSERT), RLS still on with zero policies.
> Ledger shows `0003`. See §3 (2026-08-18) and `security-fixes.sql`.
>
> Before that, all applied as of 2026-08-14: both hardening SQL files,
> batch announcements built and applied, the chat hot-path indexes applied and
> verified, every behavioural control run (the smoke test, the forgery control, and
> the vacated-departure refusal + its positive control), and the migration ledger
> now matches production — `0001` and `0002`, both read back over MCP. See §3,
> [Account types → 5](#5--batch-announcements-company--its-bookers),
> [Chat hot-path indexes](#chat-hot-path-indexes-shipped) and
> [Real migrations](#real-migrations--schemasql-demoted-to-a-build-artifact-shipped-2026-08-13).

Everything below is the same backlog, grouped by area, with the full reasoning kept.

> **Verification debt is cleared (2026-08-08) — the numbering jumps from 1.0 to 1.2 on purpose.**
> §1.1 held the two guard families that were live and structurally verified but had never been
> exercised as real writes. Both have now been run block by block from a write-capable SQL Editor
> session against non-admin accounts, controls included, all results as expected, so the section
> is gone rather than renumbered — every other section keeps its anchor. Results moved to §2:
> [Account types → 1 — database enforcement](#1--database-enforcement) and
> [H — behavioural verification](#h--behavioural-verification). The reusable lessons are in
> [Known Gotchas](#known-gotchas).

## 1.2 Features to add

### Notifications

**Status:** ❌

Edge functions exist (`supabase/functions/trek-email-notification`, `send-trek-notification`) but not wired; no in-app bell, no web push.

> **Multi-tenant / company admin UI** and **Trekker/company account split** both
> closed on 2026-08-08 and moved to §2 ("Multi-tenant platform → F" and "Account
> types → 5"). The account split's step 5 ships with one **unapplied** SQL file —
> item 1 in [§1.0](#10-next-actions-ordered--start-at-the-top).

### Maps

**Status:** ❌

`meeting_point` is text-only; no Mapbox.

### Payments

**Status:** ❌

`estimated_cost` is display-only; no Stripe, no server endpoint.

## 1.3 Partials to finish

### TanStack Query migration

**Status:** 🟡

Follow-up #6 done (optimistic favorites). Trek detail's initial read moved to the server instead (see SEO row in §2). **Remaining:** profile still on manual `fetch`/`useEffect`.

### SEO

**Status:** 🟡

Server rendering + per-page metadata shipped (§2). JSON-LD and `/about` metadata shipped 2026-08-08 (§2). Generated per-trek OG images shipped 2026-08-12 (§2). **Remaining:**

- `/company/[slug]` still shares its cover/logo as the OG image — no generated card. The trek card in [src/app/trek/[id]/opengraph-image.tsx](src/app/trek/[id]/opengraph-image.tsx) is the template; the fonts are colocated there, so a company card either moves them somewhere shared or keeps its own copy.
- **Re-scrape links shared before the generated card shipped.** WhatsApp/Facebook cache the *scraped page*, not the image, so they hold the old `og:image` URL and will not re-read the HTML until their own TTL expires (~7–30 days). No app-side change reaches them — not a new image URL, not a cache header (the route already answers `cache-control: public, max-age=0, must-revalidate`, so a trek edited today shows its new title on the very next scrape). The only fix is triggering a re-scrape: [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug) → "Scrape Again" (covers WhatsApp too), LinkedIn Post Inspector; X has no manual refresh and re-fetches per post. **Do this only after `NEXT_PUBLIC_SITE_URL` is set (§1.0 #2)** or the re-scrape just re-caches the `*.vercel.app` URL. 13 treks as of 2026-08-12 — manual is faster than wiring up the Graph API `?id=<url>&scrape=true` batch call, which needs an FB app ID + secret.
- ⚠️ `NEXT_PUBLIC_SITE_URL` should be set in Vercel. `src/lib/site.ts` falls through to `VERCEL_PROJECT_PRODUCTION_URL` first, so production without it yields the `*.vercel.app` domain in canonical/OG URLs — wrong, but not `localhost:3000`. Only an off-Vercel deploy hits the `localhost` fallback.

## 1.4 Phase 1 — Engineering foundation (remaining)

### Server layer (Route Handlers / Server Actions + service-role server-side)

**Status:** 🟡

Read path done — server components + `src/lib/server-queries.ts` (see SEO row in §2). **Remaining:** **write** endpoints for notifications/admin/payments. No longer needed for rate limiting — that moved into Postgres (shipped, §2), which a Route Handler could not enforce anyway since the publishable key lets a client skip it.

### Test coverage gaps

**Status:** 🟡 — the harness shipped (§2); these are the boundaries it does not yet cover.

The PGlite suite in [tests/db/](tests/db/) is the right place for almost all of this: security here lives in Postgres, so a React test cannot reach the parts that can actually leak. Ordered by *what escapes if it breaks*.

As of 2026-08-14 the suite covers table-level RLS well — 81 DB tests across chat isolation, catalogue/profile writes, tenant boundaries and EXECUTE grants. **What is left is almost entirely the RPC bodies**, which RLS tests cannot reach: a `SECURITY DEFINER` function bypasses every policy the other tests assert, so its `if not …` guard is the only thing standing there.

1. **`join_trek_and_chat` abuse paths.** Three threats, none pinned: `p_user_id ≠ auth.uid()` forgery; `p_batch_date` in the past or beyond the +1-year cap (the batch/conversation spam DoS); and `enforce_join_rate_limit`. `catalogue-writes.test.ts:281` and `chat.test.ts:158` both note in comments that this RPC is the real guard for booking and chat membership — and neither calls it. It is the single largest untested write path in the app: it is the *only* sanctioned way rows enter `trek_participants` and `conversation_participants`, and the table tests deliberately assert that direct inserts fail, so nothing else exercises the path that is supposed to succeed. All three were verified by hand once (§2 "H — behavioural verification"); hand-verification does not survive the next refactor.
2. **`trek_reviews` join-gate.** Posting a review for a trek the user never joined. The policy exists (NEW-3), is the anti-rating-manipulation control, and has no test.
3. **Storage policies.** Overwriting another user's avatar (the M1 fix). **Not expressible in PGlite** — the harness has no `storage` schema — so this needs a small integration script against a throwaway Supabase project, or it stays a documented manual check. Pick one explicitly: a gap that is written down is fine, a gap that is assumed covered is not.
4. **Auth flow e2e.** `signInAs()`'s mismatch path — the probe client, the wrong-account-type rejection, and the guarantee that **no session is persisted** on rejection — has no end-to-end coverage. `e2e/smoke.spec.ts` is two specs: the homepage title and `/explore` returning <400.

**Closed 2026-08-14 while this section was being written:** chat ACL (now [tests/db/chat.test.ts](tests/db/chat.test.ts), 14 tests — reads, writes, forged announcements, self-add, cross-user edits) and the anon EXECUTE grant surface (now [tests/db/acl.test.ts](tests/db/acl.test.ts), including an assertion that the load-bearing trio stays anon-executable).

Also worth pinning while in here: CI runs `npm run test` and `npm run build` but **not** `npm run lint` ([.github/workflows/ci.yml](.github/workflows/ci.yml)). Lint errors reach `main` unless the build happens to surface them.

## 1.5 Phase 0 — Security tail (remaining)

> Everything from here to "Promote CSP" was found in the 2026-08-14 audit pass (§3).

### Leaked-password protection is client-side only

**Status:** 🟡 — the app-side half shipped; the half that binds has not.

`isPasswordPwned()` ([src/lib/auth.ts:32](src/lib/auth.ts#L32)) is a genuine k-anonymity HIBP check and a good free-plan substitute — but it runs **in the browser**, gating a call the browser then makes *directly* to GoTrue with the publishable key. A `POST /auth/v1/signup` skips it entirely. It raises the floor for honest users and enforces nothing against anyone who doesn't want it enforced.

The advisor still reports `auth_leaked_password_protection` **disabled** (re-checked 2026-08-14). Enable it in Auth → Password settings; raise the minimum length there at the same time (the app currently allows 6 — see the Zod follow-up in §1.3).

### Postgres has outstanding security patches

**Status:** ❌ — advisor `vulnerable_postgres_version`, re-confirmed 2026-08-14: `supabase-postgres-17.4.1.069`. Upgrade via Project Settings → Infrastructure. Brief downtime; back up first. Carried over from `SECURITY_AUDIT_ISSUE.md`.

### `/company/apply` is reachable logged-out

**Status:** ✅ **fixed 2026-08-18** — see the gotcha-audit entry in §3.

`publicRoutes` listed `/company` and matched on prefix, so `/company/apply` passed
the guard with no session. `/company` is gone from the list; the storefront is
admitted explicitly as *one* segment under `/company` that isn't `apply`
([src/utils/supabase/middleware.ts](src/utils/supabase/middleware.ts)), so
`/company/[slug]` stays public (SEO-indexed) and the bare `/company` 404 is
unchanged. The write was always refused (`apply_for_company` is
`authenticated`-only and derives the owner from `auth.uid()`), so this was
defence-in-depth, not a leak.

### Delete the dead `.eslintrc.json`

**Status:** ❌ — hygiene, but it actively misleads.

[.eslintrc.json](.eslintrc.json) turns off `@typescript-eslint/no-explicit-any`, `no-unused-vars`, `no-unused-expressions` and `react-hooks/exhaustive-deps`. **ESLint 9 uses [eslint.config.mjs](eslint.config.mjs) and ignores this file completely**, so every one of those rules is live at error severity — as `CLAUDE.md` documents. No behaviour changes when it goes.

The risk is purely that a human (or an agent) reads it and concludes `catch (e: any)` will pass lint, when it fails the build. Note `CLAUDE.md` states there is **no** `.eslintrc.json`; there is one, so either delete the file or correct that line — the two must not disagree.

### Promote CSP from report-only to enforcing

**Status:** 🟡 — shipped half is in §2 [Security headers](#security-headers).

The policy is served as `Content-Security-Policy-Report-Only`, which reports violations and blocks nothing. Flipping it is an env change only: set `CSP_ENFORCE=1` in Vercel and redeploy; unset it to roll back without touching code.

- **Watch the reports first.** They land in Sentry via `report-uri` (endpoint derived from `NEXT_PUBLIC_SENTRY_DSN` at build). Expect noise from browser extensions injecting into the page — those are not app bugs and do not block promotion. What *would* block it is any report naming a directive with a real origin behind it, especially `connect-src` or `worker-src`.
- **The likely breakage is photo upload, not script.** `compressImage()` runs `browser-image-compression` with `useWebWorker: true`, which spawns its worker from a blob URL, so `worker-src 'self' blob:` is load-bearing. It also fails *silently* — the `catch` in [`src/utils/imageCompression.ts`](src/utils/imageCompression.ts) falls back to the uncompressed original, so a CSP break shows up as bloated uploads, not an error. Exercise an avatar/review/trek-cover upload before and after enforcing.
- **Enforcing does not stop XSS here** — see the `'unsafe-inline'` note in §2. Treat this as exfiltration containment, not injection defence.

**NEW-5 and everything before it are applied** — see §2 "Phase 0 — Security tail (shipped)".

**Doc debt cleared 2026-08-12:** both dropped `increment_participants` blocks removed from `supabase/schema.sql` (the `create` and the `revoke`), leaving a tombstone comment in place of the definition so the next reader doesn't re-add it or confuse it with the live `update_participants_count()`. `DATABASE.md` needed no change — it already described the RPC as non-existent.

## 1.7 `createTrek()` RETURNING bug

**Status:** ✅ **applied + verified live 2026-08-13** — now
[`migrations/0002_trek-returning-and-chat-policy-roles.sql`](supabase/migrations/0002_trek-returning-and-chat-policy-roles.sql) §A
(applied as `phases/fix-trek-returning-and-chat-policy-roles.sql`; split into its
own migration 2026-08-14 — see the `0002` note in
[`migrations/README.md`](supabase/migrations/README.md)).
Found by `tests/db/catalogue-writes.test.ts`. Post-apply `pg_policies` read back
from production: `treks` carries two SELECT policies, `view treks` `{public}`
and `company members view own treks` `{authenticated}`, and `is_trek_visible`
still holds its `anon` EXECUTE grant.

`INSERT … RETURNING` applies the table's SELECT policy to the returned row.
`view treks` is `using (public.is_trek_visible(id))`, and `is_trek_visible` is
declared `stable` with a body of
`select 1 from public.treks t join public.companies c … where t.id = p_trek_id`.
A STABLE function sees the snapshot taken at the start of the calling statement,
so the row the INSERT is creating is not visible to it. The predicate returns
false, the returned row fails the SELECT check, and the statement is rejected
with `new row violates row-level security policy for table "treks"` — an error
that reads like a `with_check` failure and sends you looking at the wrong policy.

`src/lib/company.ts` does `.insert({...}).select('id').single()`, which PostgREST
compiles to exactly that, so **no company can publish a trek**. It fails for
platform admins too: the `or is_platform_admin()` arm sits inside the same
unsatisfiable `FROM`. `createBatch()` is unaffected — it inserts without
`.select()`.

Confirmed the same statement **without** `RETURNING` succeeds for the same user,
isolating the cause to the SELECT policy rather than `company members create
treks`. `pg_policies` for `treks` was read from production on 2026-08-13 and
matched `schema.sql` exactly, so it reproduces live.

### The fix, and the wrong version of it

⚠️ **The obvious fix would take the public site down.** Folding the arm into
`view treks` itself —

```sql
using (public.is_trek_visible(id) or public.is_approved_company_member(company_id))
```

— fails because `view treks` is `to public`, which includes `anon`, and
`is_approved_company_member` is revoked from `anon` (§17.3 of `schema.sql`).
Every anonymous `/explore` and `/trek/[id]` read would raise
`permission denied for function is_approved_company_member`. This is the same
trap as the load-bearing trio in [Known Gotchas](#known-gotchas).

The applied fix is a **second permissive policy scoped `to authenticated`**.
Postgres only applies policies whose roles include the current role, so `anon`
never evaluates it, and permissive policies on the same command are OR'd:

```sql
create policy "company members view own treks" on public.treks for select to authenticated
using (public.is_approved_company_member(company_id));
```

It grants **no new visibility**: `is_trek_visible` already carries
`or is_company_member(t.company_id)` with no status gate, and this is the
strictly narrower approved-only form. It exists only to be evaluable during
`INSERT … RETURNING`, since it reads `company_members`/`companies` and never
`treks`.

Three tests in `tests/db/catalogue-writes.test.ts` cover it: that
`insert … returning` now works, that `anon` still sees exactly the public
catalogue, and that no cross-tenant visibility was opened.

## 1.8 Chat policies: `to public` → `to authenticated`

**Status:** ✅ **applied + verified live 2026-08-13** — now
[`migrations/0002_trek-returning-and-chat-policy-roles.sql`](supabase/migrations/0002_trek-returning-and-chat-policy-roles.sql) §B
(see §1.7 for the file move).
Post-apply read-back confirms the four `is_chat_participant()` policies are
`{authenticated}` with quals intact (`is_announcement = false` still pinned on
`"Send messages"`), and the four left as `{public}` are unchanged.

The chat policies were declared `to public`, which includes `anon`, but their
quals call `is_chat_participant()` — which `anon` does not hold EXECUTE on
(§17.5 of `schema.sql`). An anonymous read of `conversation_messages` therefore
raised `permission denied for function is_chat_participant` rather than
returning an empty set. It failed closed and nothing in the app reads chat
anonymously, so this is tidiness, not exposure.

Note this is the **opposite** resolution to the load-bearing trio in
[Known Gotchas](#known-gotchas) — same definer-called-from-a-`to public`-policy
shape, different answer, because chat genuinely has no anonymous read path while
`/explore` does. That is exactly why both are written down.

Only the four policies that actually call `is_chat_participant()` are re-scoped.
Left as `to public` on purpose: `"System adds participants"` (its `with_check` is
`auth.role() = 'service_role'`, so re-scoping to `authenticated` would exclude
the only role it admits), and `"Users can leave conversation"` /
`"Edit own messages"` / `"Delete own messages"` (they test
`user_id = auth.uid()`, already NULL for anon, and call no revoked function).

`tests/db/chat.test.ts` now asserts anon gets an empty set across all three
tables, so re-scoping these back to `to public` fails the test.

## 1.6 Decided: leave as-is

### `/dashboard/account` is unreachable for a company account with no company yet

**Decided 2026-08-06: leave it, document it.** The page sits under the `/dashboard` layout, which
redirects members-without-a-company to `/company/apply` — so a brand-new company account can't
reach its own password form until it has registered a company. **Not a lockout:**
`/auth/forgot-password` still changes the password and the gap closes the moment they apply, so
the cost of carrying it is low. If it's ever fixed, lift the page to a top-level `/account` route
rather than special-casing the guard — an exception inside `dashboard/layout.tsx` is something
every future dashboard page then has to reason about. Also in Known Gotchas and `CONTEXT.md` §10.

---

# §2 — Done (shipped features & changes)

## Real migrations — `schema.sql` demoted to a build artifact (shipped 2026-08-13)

**Status:** ✅ — closes [`CODE_REVIEW.md` §2.4](CODE_REVIEW.md). Workflow in
[`supabase/migrations/README.md`](supabase/migrations/README.md).

Every DB change is now `supabase/migrations/NNNN_description.sql`, append-only.
[`0001_baseline.sql`](supabase/migrations/0001_baseline.sql) is the live database
as of 2026-08-13 — the original schema, the multi-tenant migration, phases A–I,
the security fixes and the rate-limit work folded into one end state.
[`0002`](supabase/migrations/0002_trek-returning-and-chat-policy-roles.sql) is the
§1.7/§1.8 policy pair that followed hours later the same day. `phases/` and
`security-fixes.sql` stay as the historical record of *why*; nothing new goes in
them.

**Correction, 2026-08-14 — `0002` was briefly folded back into `0001` by editing
it.** That is precisely what append-only forbids, and the damage is subtle rather
than functional: nothing broke, but the ledger could no longer tell a database
built from the edited `0001` apart from one built by the `0001` that actually ran,
which is the single guarantee this whole mechanism exists to provide. Split back
out, so `0001` is again the file that ran. **`0002` recorded on production
2026-08-14 09:36:11+00** and read back over the read-only MCP server — ledger
returns both rows, all five re-scoped policies `{authenticated}` with quals intact,
the four that must stay `{public}` unchanged, and `treks` carrying both SELECT
policies. Its `applied_at` is when it was *recorded*, not when it took effect (the
SQL went live 2026-08-13). The lesson generalises: "the end state is the same" is
not a reason to edit an applied migration, because the end state was never the
thing being protected.

**Three things now enforce what used to be discipline:**

1. **`schema.sql` is generated** by [`scripts/build-schema.mjs`](scripts/build-schema.mjs)
   (`npm run db:schema`) — the migrations concatenated in order.
   `tests/db/schema-is-generated.test.ts` fails on drift and on a gap in the
   version sequence, so a hand edit to `schema.sql` can no longer be silently
   reverted by the next build. The script also rejects a malformed name or a
   duplicate version number.
2. **The DB suite replays the migrations** rather than loading `schema.sql`, so
   every `npm test` re-proves that they rebuild a database from nothing. A
   migration that only works against the author's already-populated DB fails in
   CI, not in the SQL Editor.
3. **`supabase_migrations.schema_migrations` is the deployment record.** Each
   migration ends by inserting its own row, so "is it applied?" is a query, not a
   comment. That is the direct fix for the failure in §1.3: a
   `⚠️ NOT YET APPLIED` header outlived its truth and produced a false 🔴
   critical. The schema name and column shape match what the Supabase CLI
   creates, so adopting `supabase db push` later finds a ledger it understands;
   it lives outside `public` because PostgREST exposes `public` and a table there
   would be anon-readable.

**Ledger bootstrapped on production 2026-08-13, verified live** over the
read-only MCP server: row `0001 / baseline / 13:20:53+00` reads back, joined by
`0002 / trek-returning-and-chat-policy-roles / 2026-08-14 09:36:11+00`;
`relrowsecurity = true` with 0 policies and `relforcerowsecurity = false` (so
the owner still writes); `anon` and `authenticated` have neither USAGE on the
schema nor SELECT on the table, and the ACL is `{postgres=arwdDxtm/postgres}`.
Security advisors re-run: no new lint — the `rls_enabled_no_policy` INFO checks
`public` only, and the pre-existing findings (`platform_admins`, `rate_events`,
`public_profiles`, the definer-RPC WARNs) are unchanged and documented in
`DATABASE.md` §11.

## Automated RLS + tenant-isolation tests (shipped 2026-08-13)

**Status:** ✅ — `tests/db/`, 77 assertions, ~9s, runs in `npm test` and therefore
already in CI (the workflow calls `npm run test`; no workflow change was needed).

Previously the security model — RLS policies, SECURITY DEFINER RPCs, EXECUTE
grants — had **zero** automated coverage. Everything was proven by hand-running
SQL blocks that were then rolled back, so nothing re-checked it on each change.
The 26 pre-existing tests covered Zod schemas and two presentational components.

**How it runs without Docker.** [PGlite](https://github.com/electric-sql/pglite)
(`@electric-sql/pglite`, devDependency) is real Postgres 18 compiled to WASM,
running in-process under Vitest. `tests/db/harness/load.ts` replays
`supabase/migrations/*.sql` in version order, verbatim (it applied `schema.sql`
until migrations landed 2026-08-13); `tests/db/harness/shim.sql` supplies the pieces
the Supabase platform normally provides (`auth.users`, `auth.uid()` reading
`request.jwt.claims`, `storage.objects`/`buckets`/`foldername()`, `net.http_post`
recorded rather than sent, `cron.schedule`, the `anon`/`authenticated` roles and
Supabase's default grants). `asUser()` / `asAnon()` set the same
`request.jwt.claims` GUC PostgREST sets from a verified JWT, then `SET LOCAL ROLE`
— which is what makes the tests real, since PGlite connects as a superuser and
superusers bypass RLS unconditionally. Everything runs in a rolled-back
transaction, so tests are order-independent.

**What it covers.** The five originally requested boundaries (cross-user
`trek_participants` reads; `anon` vs pending/rejected/suspended companies;
suspended companies disappearing from `search_treks`; the `companies.slug` /
`status` pin; `get_company_batch_participants` returning an empty set to
non-members), plus chat isolation including announcement forgery, catalogue
write scoping and the publishing tier, `account_type` pinning, favourites,
invites, and an EXECUTE-grant invariant file.

**Vitest now has two projects** (`vitest.config.ts`): `unit` (jsdom, `src/**`)
and `db` (node, `tests/db/**`). PGlite needs node, not jsdom.

**⚠️ What a green run does and does not prove.** It replays the migrations, which
are what we *intend* production to be — the live database is still the source of
truth, since changes are pasted into the SQL Editor by hand. Green proves the
policies **as committed** are sound; it does not prove production matches them.
`supabase_migrations.schema_migrations` is what you read to check that. See
[§17 of `schema.sql`](supabase/schema.sql) and the drift entry below.

### Drift found and fixed on the first run

`schema.sql` could not reproduce production's EXECUTE grants for **20**
functions. Each was verified against the live database with
`has_function_privilege` on 2026-08-13 before being written down; **nothing was
changed in production** — the file was brought up to match it, as a new §17.

- **18** were the revokes from `phases/fix-anon-execute-definer-rpcs.sql`,
  applied live 2026-08-08 but never folded back into `schema.sql`. A fresh
  replay of the file produced a database where 18 definer RPCs — including
  `get_company_batch_participants`, which returns participant phone numbers and
  emergency contacts — were callable by `anon`. Each still refuses to return
  rows without an `auth.uid()`, so this was defence-in-depth, not a live hole.
- **2** — `is_chat_participant` and `join_trek_and_chat` — had **no grant or
  revoke in any file in `supabase/`**, yet production already denies `anon`.
  That state existed only in the live database.

`tests/db/acl.test.ts` now pins the invariant in both directions: no definer
function is anon-executable except the documented load-bearing trio, *and* the
trio keeps its grant (so a future "get the advisor to zero" pass fails the test
instead of taking the public site down).

### Also found — both fixed, applied and verified live 2026-08-13

Both shipped in [`phases/fix-trek-returning-and-chat-policy-roles.sql`](supabase/phases/fix-trek-returning-and-chat-policy-roles.sql);
`schema.sql`, `tests/db/` and production are back in sync.

- **`createTrek()` is broken in production** — `insert … returning` cannot
  satisfy a SELECT policy whose predicate is a STABLE function reading the same
  table. See [§1.7](#17-createtrek-returning-bug), including why the obvious
  one-line fix would have taken `/explore` down for anonymous visitors.
- Chat policies were `to public` but called a function `anon` cannot execute —
  see [§1.8](#18-chat-policies-to-public--to-authenticated).

### `src/lib/company.ts`

~1,100 lines, previously untested. Almost all of it is Supabase I/O whose real
behaviour is the RLS policy on the other end, so mocking the client would only
assert that the mock was called — that surface is covered by `tests/db/` against
a real Postgres instead. The genuinely local logic is unit-tested in
`src/lib/company.test.ts` (17 tests): `isCompanyFrozen` (must agree with
`is_company_writable()` in the DB, or the dashboard offers buttons RLS refuses),
`trekRow` (the omitted-vs-explicit-null `cover_image_url` distinction, which
decides whether an edit preserves or wipes the cover image), and
`inviteErrorMessage` (which raw Postgres error text is allowed to reach a user's
screen). `trekRow` and `inviteErrorMessage` were changed from module-private to
exported for this; no behaviour changed.

## Core (pre-existing)

| Feature | Status | Notes |
|---------|--------|-------|
| Auth (signup / login / forgot / reset) | ✅ | `token_hash` recovery flow (not PKCE) — see Known Gotchas below. Login + signup share one sliding `src/components/auth/AuthPanel.tsx` (login/signup/inline-forgot), rendered by both `/auth/login` & `/auth/signup`; `/auth/reset-password` stays standalone for email links. Fonts via `src/app/auth/fonts.ts` (next/font). Cover photo: drop `public/auth-cover.jpg` (degrades to gradient if absent) |
| Trek discovery / Explore | ✅ | See "Search & filters" below for the upgraded version |
| Trek detail (reviews, join/leave, favorite) | ✅ | `src/app/trek/[id]/page.tsx` |
| Join / leave trek | ✅ | Always via `joinTrekBatchAndChat()` / `leaveTrek()` → `join_trek_and_chat` RPC |
| Group chat | ✅ | Upgraded to realtime — see below |
| Reviews (submit + showcase) | ✅ | `src/app/review/`, photo uploads compressed |
| Favorites | ✅ | `src/app/favorites/` |
| Profile view + edit | ✅ | `src/app/profile/` |
| Seasonal theme (rain / snow) | ✅ | Switchable cosmetic theme. `src/components/ui/WeatherEffect.tsx` picks one effect from a single `WEATHER` const in `src/lib/weather.ts` (`'rain' \| 'snow' \| 'none'`); currently `'rain'`. **Rain**/**snow** (`RainEffect`/`SnowEffect`) are `z-50` pointer-events-none foreground particle overlays (CSS keyframes; falling rain lines / falling snowflakes). Flip the const to switch. Mounted once globally in `src/app/layout.tsx` (after `<Providers>`), so it overlays every route site-wide. (The earlier `'summit'` glassmorphism-droplet theme was removed.) |

## Phase 2 — Features (shipped)

| Feature | Status | Evidence |
|---------|--------|----------|
| 🔥 Realtime chat | ✅ | commit `696c385`; `src/app/messages/page.tsx` — `postgres_changes`, presence, typing, unread badges; `src/lib/chat.ts`. DB deps verified live 2026-06-20: `mark_conversation_read()` + `get_unread_counts()` RPCs, `conversation_participants.last_read_at`, and `conversation_messages` in the `supabase_realtime` publication all present |
| Real ratings rollup | ✅ | DB: `get_trek_avg_rating()` in `supabase/schema.sql`; wired via `src/lib/utils.ts`, `src/components/ui/TrekCard.tsx` |
| Search & filters on Explore | ✅ | DB: `search_treks()` + `fts` tsvector/GIN in `supabase/schema.sql` (filters/sort/pagination + total_count in one RPC); wired at `src/app/explore/page.tsx`, `src/components/ui/FilterSection.tsx`. Empty / punctuation-only search returns no matches (follow-up #3, applied 2026-06-22). `FilterSection` is now a controlled component (single source of truth in the page); applied filters **and** the current page persist across navigation via `sessionStorage` (`explore-filters`, shape `{ filters, page }`) so leaving and returning to Explore keeps the same results. Writes happen on user actions (filter/page change), not via a `filters` effect — an effect would write the default state back over the saved value on the first render after remount and reset everything. The key is cleared on `SIGNED_OUT` in `src/contexts/AuthContext.tsx` (shared constant in `src/lib/exploreFilters.ts`) — `sessionStorage` is keyed to the tab, not the session, so without that a search survived the sign-out and greeted the next sign-in |
| Capacity + waitlist | ✅ | DB: `trek_participants.status` + `promote_waitlist_on_leave()` in `supabase/schema.sql` (per-batch capacity, FIFO promotion trigger); wired into `src/lib/joinTrek.ts`. `participants_joined` counts confirmed only (#1); `waitlist_position` tie-breaks by id (#5); trek-detail button no longer asserts a misleading trek-wide full state (#4) — all applied 2026-06-22 |
| Trekker profiles & gamification | ✅ | DB: `award_user_achievements()` + `get_user_profile()` in `supabase/schema.sql`; `src/lib/achievements.ts` (15 badges); wired at `src/app/profile/page.tsx`. Includes `src/components/ui/ItineraryView.tsx`. Stats + badges count confirmed participations only (follow-up #2, applied 2026-06-22) |

## Multi-tenant platform (phases; remaining work tracked in §1)

### A — database foundation

**Status:** ✅

- [supabase/migration-multi-tenant.sql](supabase/migration-multi-tenant.sql) **applied 2026-07-02, verified live** (read-only MCP): `companies`/`company_members`/`platform_admins` with RLS, `treks.company_id` NOT NULL + `is_active`, 9 new functions/RPCs, `trg_protect_company_admin_fields`, single 12-arg `search_treks` overload, `company-logos`/`trek-images` buckets (8 policies), backfill (0 ownerless treks; "Trekker Originals" approved, 1 owner), broken `trg_initial_trek_message` dropped (trek creation works now). Folded into `supabase/schema.sql` (§12 + in-place edits), `DATABASE.md`, `CONTEXT.md`. Advisors re-run: no ERRORs beyond the known-intentional `public_profiles`; new WARNs documented in `DATABASE.md` §11 (anon-executable RPCs — fail safely; bucket listing — deliberate pattern; `platform_admins` no-policy INFO — by design)

### B — company application flow + role plumbing

**Status:** ✅

`companyApplicationSchema` in `src/lib/schemas.ts` (slug regex/60-char cap mirror the DB CHECKs); `src/lib/company.ts` — `applyForCompany()` → `apply_for_company` RPC (only known user-facing RPC messages surface to the UI), `getMyCompanies()`, `getCompany(slug)`; `useMyCompanies`/`useCompany` hooks + query keys in `src/lib/queries.ts`; public `/company/apply` form (`src/app/company/apply/page.tsx`, Zod-validated, `useAuth()` login prompt); `/company` added to `publicRoutes` in `src/utils/supabase/middleware.ts`; guard layouts — `src/app/dashboard/layout.tsx` (server component: no membership → redirect `/company/apply`, non-approved → pending banner) and `src/app/admin/layout.tsx` (server component: `is_platform_admin()` RPC else redirect `/`)

### C — company admin dashboard (`/dashboard`)

**Status:** ✅

- App layer shipped, `npm run build` clean, all 8 routes present.
- **Data** (`src/lib/company.ts`): `getMyCompanyById`, `getCompanyOverview`, trek CRUD (`getCompanyTreks`/`getTrek`/`createTrek`/`updateTrek`/`setTrekActive`), batches (`getTrekBatches` — confirmed counts via dedicated PII-free `get_trek_batch_confirmed_counts` RPC, one call per trek instead of the per-batch roster fan-out, `createBatch`, `deleteBatch`), `getBatchParticipants`, `updateCompany`, team (`getCompanyMembers`/`inviteMember`/`updateMemberRole`/`removeMember`).
- **Schemas**: `trekFormSchema`/`batchSchema`/`companyProfileSchema`/`inviteMemberSchema` in `src/lib/schemas.ts`.
- **Hooks**: `useCompanyOverview`/`useCompanyTreks`/`useTrek`/`useTrekBatches`/`useBatchParticipants`/`useCompanyMembers` in `src/lib/queries.ts`.
- **Chrome**: `src/components/admin/DashboardShell.tsx` (active-company context + sidebar + switcher when >1) + `src/hooks/useRequireCompanyRole.ts`.
- **Pages**: overview, treks list (archive toggle + archive/restore), new/edit (shared `src/components/admin/TrekForm.tsx`, cover upload → `trek-images/{company_id}/{trek_id}/`), batches (add/remove, delete blocked when it has participants or a chat conversation), participants roster (PII via `get_company_batch_participants`, batch selector), settings (owner/admin only, profile + logo → `company-logos/{company_id}/`), team (list + invite-by-email + role change + remove).
- **Logo/cover Remove persists** (fixed 2026-07-03): both forms send `null` on removal vs `undefined` when untouched, so `logo_url`/`cover_image_url` are actually nulled in the DB. **Team RPCs `get_company_members` + `invite_company_member` ([`supabase/phases/phase-c-company-dashboard.sql`](supabase/phases/phase-c-company-dashboard.sql)) applied + verified live 2026-07-02** (roster returns member identity to members / empty set to anon; invite raises for non-admins — verified via MCP). Folded into `supabase/schema.sql` §12, `DATABASE.md`.

### D — platform admin panel (`/admin`)

**Status:** ✅

- App layer shipped, `npm run build` clean, 3 routes present. `platform_admins` insert ([`supabase/phases/phase-d-platform-admin.sql`](supabase/phases/phase-d-platform-admin.sql)) applied by user 2026-07-02 — no new schema, reuses Phase A's `approve_company`/`reject_company`/`suspend_company` RPCs + platform-admin RLS reach.
- **Data** (`src/lib/company.ts`): `getAdminOverview` (companies/pending/treks counted via admin RLS, users via `public_profiles`), `getAllCompanies(status)`, `getAdminCompany(id)` (adds `created_by`/`approved_by`/`approved_at` audit cols), `approveCompany`/`rejectCompany`/`suspendCompany` wrappers.
- **Hooks**: `useAdminOverview`/`useAdminCompanies`/`useAdminCompany` + `['admin', …]` query keys in `src/lib/queries.ts`.
- **Chrome**: `src/components/admin/AdminShell.tsx` (sidebar nav) + `src/components/admin/CompanyActions.tsx` (approve/reject/suspend with inline reason, invalidates `['admin']`).
- **Pages**: `/admin` overview (4 stat cards + pending-review CTA), `/admin/companies` (status filter tabs, per-row actions, `?status=` deep-link from overview), `/admin/companies/[id]` (profile, owner contact, audit trail, its treks). Guard already in `src/app/admin/layout.tsx` (server `is_platform_admin()` check), now wraps children in `AdminShell`. Owner contact uses the company's own `contact_*` fields — `get_company_members` gates on membership so it returns nothing to a non-member platform admin.

### E — public-facing surface

**Status:** ✅

- App layer shipped, `npm run build` clean, no schema change (Phase A's `search_treks` already returns `company_id`/`company_name`/`company_slug`, and the `treks.company_id → companies` FK plus the `to public` "view companies" RLS policy let anon read approved companies).
- **Storefront** `src/app/company/[slug]/page.tsx` (public, under existing `/company` `publicRoutes` entry): cover + logo, name, Verified badge derived from `status='approved'`, website, description, and the company's active treks via new `useStorefrontTreks(companyId)` hook (calls `search_treks` with `p_company_id`, `p_limit: 100`).
- **Trek attribution**: `/trek/[id]` now embeds `companies(name, slug)` in both fetch + refresh selects and renders "Organized by {name}" linking to `/company/[slug]`.
- **Card label**: `TrekCard` gained optional `companyName`/`companySlug` props (small "By {company}" link), wired from `search_treks` fields in `/explore`.
- **Data/types**: `company_id`/`company_name`/`company_slug` added to `SearchTrek` in `src/lib/queries.ts`; `storefrontTreks` query key.

### H — frozen companies (rejected/suspended → read-only)

**Status:** ✅

- [`supabase/phases/phase-h-frozen-companies.sql`](supabase/phases/phase-h-frozen-companies.sql) **applied + verified live 2026-08-08**, folded into [`supabase/schema.sql`](supabase/schema.sql) §16 (DDL in place at §12.4/12.6/12.7, 15.3, 15.5) + `DATABASE.md` + `CONTEXT.md` + `security-fixes.sql`. `npm run build` clean, lint unchanged (3 pre-existing errors). **The hole**: company status gated **reads** only — `is_trek_visible()` hid an unapproved catalogue, so rejecting/suspending *looked* like it worked (treks vanished from Explore) while every write policy asked merely "is the caller a member?". A rejected or suspended company kept full write access to its own tenant: invite staff, change roles, remove members, rewrite its public storefront copy, archive/restore treks, add and delete departures. Two consequences reached beyond the tenant: (a) `accept_company_invite()` converts a trekker account irreversibly (platform-admin-only to undo), and invites issued while approved stay live rows after a rejection — so a stale invite offered someone an irreversible account change for a seat on a tenant that could do nothing, which is why the check lives at **accept** time and not only at invite time; (b) `company-logos`/`trek-images` are **public** buckets, so a frozen company could overwrite its logo and cover at the exact CDN paths the storefront links to, with no `companies` row changing — table gates alone would have left that open. Also closed: `/dashboard/treks/new` hid the create form behind `status === 'approved'` and its comment claimed the treks INSERT policy enforced it; the policy was `is_company_member(company_id)` with no status test, and the publishable key ships in the client bundle, so a direct `POST /rest/v1/treks` from a pending or suspended company's admin succeeded. **The fix — two tiers**: `is_company_writable()` = `pending`+`approved` (settings, team, `company-logos`) and `is_approved_company_member()` = `approved` only (treks, `trek_batches`, `trek-images`); the latter already existed, orphaned since the multi-tenant migration, and finally has callers. Bare `is_company_member`/`is_company_admin` in a **write** policy is now a bug — see Known Gotchas.
- **Deliberately not gated**: SELECT anywhere (`is_trek_visible` handles read visibility; staff and existing bookers must keep reading a hidden trek), the `is_platform_admin()` arms (freezing must not lock out the role that un-freezes), `revoke_company_invite`/`decline_company_invite` (de-escalating), and all participant flows (`join_trek_and_chat` + the waitlist/count triggers are SECURITY DEFINER, so no existing booking or chat on a suspended company's trek is touched). Non-destructive and reversible: no data deleted or rewritten, re-approving restores everything with no backfill.

### H — behavioural verification

**Status:** ✅ **2026-08-08** — [`supabase/phases/verify-phase-h.sql`](supabase/phases/verify-phase-h.sql), run block by block from a write-capable SQL Editor session, every block rolled back, all results as expected.

Closes the "the freeze was never exercised as real DML" gap. Each negative is paired with the same statement run while the company is writable, because a refused write is equally consistent with a missing grant or an unrelated policy.

- **B0 / B1** — approved: `is_company_writable` `t`, company UPDATE 1, trek INSERT 1. Rejected: status `rejected`, writable `f`, company UPDATE **0**, trek UPDATE **0**. UPDATE refusals are silent, not errors — a row that fails `USING` simply doesn't match — which is why the counts are returned rather than assumed.
- **B2** — `trek_batches` INSERT raised `42501`. INSERT is the one that errors, because it fails `WITH CHECK`.
- **B3** — `invite_company_member()` returned `{"error":"company_frozen"}` rather than raising; the app renders it as a message, not a crash.
- **C** — `suspended` behaves identically to `rejected`. Both tiers, not just the one that was easy to test.
- **D0 / D / D2** — the invite stays visible and pending after the freeze (so the failure is about company status, not a revoked or expired invite); `accept_company_invite()` then raised *That company is no longer active on Trekker*; and the same invite **accepted cleanly** with no freeze, converting `account_type` to `company` and creating the membership row. Without D2 the D error could equally have been a broken invite or a stale email match.
- **F / F2** — a platform admin writes to a suspended company's trek and to the company row (UPDATE 1 each), and `approve_company()` unfreezes. Freezing must never lock out the role that un-freezes.
- **G / G2 / G3** — storage: both buckets accept the owner's write while approved; both refuse it while frozen. This is the half that table gates alone would have missed — `company-logos` and `trek-images` are **public** buckets, so a frozen company overwriting its logo at the same CDN path changes what the public sees without touching a `companies` row.
- **POST-CHECK** — status back to `approved`, description unchanged, no fixture trek or batch, trekker still `trekker`, 1 member, 0 invites, 0 storage rows. Nothing leaked past a ROLLBACK.

⚠️ **Two bugs in the phase file's own VERIFY template, both found by trying to run it.** Kept here because the template is still in `phase-h-frozen-companies.sql` and reads plausibly. **(1)** Its freeze step, `update companies set status='rejected'` "as owner of the DB", is **inert**: `trg_protect_company_admin_fields` does `new.status := old.status` whenever `is_platform_admin()` is false, and `auth.uid()` is null in the SQL Editor. The company would have stayed approved, every "expect UPDATE 0" would have *succeeded*, and a working guard would have been reported as broken. **(2)** Its `<trek_id>` had nothing to resolve to — the non-admin company owner has no treks, and the only company with treks belongs to the platform admin, who cannot test a non-admin guard. The companion freezes through `reject_company()`/`suspend_company()` under the admin's JWT and creates its own trek in-transaction. *A template is not a run.*
- **Verified live via read-only MCP**: 4/4 structural checks; all **14** non-SELECT policies across `companies`/`company_members`/`treks`/`trek_batches`/`storage.objects` gated at the intended tier; both RPC branches present with the frozen check ordered *before* the `rate_events` insert. Behaviourally, impersonating a real company **owner who is not a platform admin** (`is_platform_admin()` = false confirmed in the same query, so no false PASS via the admin arm) who happens to own **both** an approved and a rejected company — a matched control pair on one identity: approved → `is_company_admin` t / `is_company_writable` t / `is_approved_company_member` t; rejected → `is_company_admin` **t** (membership is not what differs) / writable f / approved f; `invite_company_member(rejected)` → `{"error":"company_frozen"}` returning before any write; `invite_company_member(approved)` → reached the `rate_events` INSERT and was stopped only by the read-only connection (line 25), which is the **over-blocking control** — the gate lets an approved company through rather than refusing everyone. **The DML half is now run too — see the next bullet.** **App**: `isCompanyFrozen()` in [`src/lib/company.ts`](src/lib/company.ts) mirrors the DB predicate (+ `company_frozen` in `INVITE_ERRORS`); [`/dashboard/team`](src/app/dashboard/team/page.tsx) gates invite/promote/remove on `isAdmin && !frozen` with a read-only note; [`/dashboard/settings`](src/app/dashboard/settings/page.tsx) wraps the **form** in a `disabled` `<fieldset>` (wrapping the form rather than its contents disables every control inside — file pickers and Save included — without reshaping 180 lines of JSX); [treks list](src/app/dashboard/treks/page.tsx), [edit](src/app/dashboard/treks/[id]/edit/page.tsx) and [departures](src/app/dashboard/treks/[id]/batches/page.tsx) gate their write controls on `approved` with status-aware notes


### F — anon execute hardening on definer functions

**Status:** ✅ **applied 2026-08-08** — [`supabase/phases/fix-anon-execute-definer-rpcs.sql`](supabase/phases/fix-anon-execute-definer-rpcs.sql).

`create or replace function` preserves the original ACL, so every function first created without an explicit grant still carried the default PUBLIC EXECUTE — 21 of them under the `anon_security_definer_function_executable` lint. The script revokes `public, anon` on 18 and pairs **every** revoke with `grant execute … to authenticated`. All of them already fail safely via an internal `auth.uid()`/`is_company_*`/`is_platform_admin()` check, so this is hardening, not a fix.

**Verified live after the apply:** anon-executable definer functions 21 → **3**, and zero functions in the revoke list lost their `authenticated` grant.

- **The count was 21, not the 20 an earlier draft said.** `is_company_writable` joined when phase H shipped and inherited the default PUBLIC grant. A revoke list copied from the older version silently misses it.
- ⚠️ **Three are deliberately left executable by `anon` — revoking them takes the public site down.** `is_trek_visible`, `is_company_member` and `is_platform_admin` are called from **PUBLIC-role SELECT policies** on `treks`, `trek_batches` and `companies`; RLS quals evaluate as the querying role, so every anonymous read on `/explore`, `/trek/[id]` and `/company/[slug]` calls them. (The `companies` qual is `status='approved' OR is_company_member(id) OR is_platform_admin()`; `OR` does not guarantee short-circuit order, so arms two and three are reachable even for a plainly approved company.) The advisor flags them anyway — **3 WARNs stay open by design.** Also in Known Gotchas.
- ⚠️ **`revoke … from public` also removes `authenticated`.** Almost none of these carry a direct `authenticated` grant; they inherit it through PUBLIC. An unpaired revoke breaks the dashboard, admin panel and chat. Any *new* definer RPC must ship with the same revoke+regrant pair or it re-opens the lint — [`phase-i-batch-announcements.sql`](supabase/phases/phase-i-batch-announcements.sql) §5 does this.

Earlier in this row's history: it claimed the `is_trek_visible()` participant arm still needed applying. It was stale both times — the arm was applied + verified 2026-08-04 and is folded into `migration-multi-tenant.sql` §3 and `supabase/schema.sql`. The first occurrence produced a false 🔴 critical in `CODE_REVIEW.md` §1.3. **A SQL file's own comment is not evidence of database state.**


## Account types — trekker vs company (steps 1–5)

### 1 — database enforcement

**Status:** ✅

- [`supabase/phases/phase-f-account-types.sql`](supabase/phases/phase-f-account-types.sql) **applied 2026-08-06**, folded into [`supabase/schema.sql`](supabase/schema.sql) §14 + `DATABASE.md` + `security-fixes.sql`. `profiles.account_type` enum (`trekker`/`company`, NOT NULL default `trekker`), set at signup from `raw_user_meta_data` in `handle_new_user()` and pinned by `trg_protect_profile_account_type` — without that pin the own-row UPDATE policy lets any company account demote itself with one PATCH and bypass everything below. All restrictions route through one predicate, `is_trekker() := account_type='trekker' OR is_platform_admin()`: `join_trek_and_chat()` raises `'Company accounts cannot join treks'`; `trek_participants` + `favorites` INSERT policies require it; `apply_for_company()` requires `account_type='company'`. Reviews needed no rule (reviewing already requires having joined); `conversation_participants` INSERT is service_role-only. Backfill: everyone in `company_members` → `company` (2 company / 2 trekker profiles, 0 stragglers).
- **✅ Behaviourally verified 2026-08-08** via [`supabase/phases/verify-phase-f.sql`](supabase/phases/verify-phase-f.sql), run block by block from the SQL Editor, every block rolled back, all results as expected. This closes the last structural-only gap in the account split. What the run proved, and why each half was needed:
  - **A** — `is_trekker()` returns `f` for the non-admin company account and `t` for the trekker. The predicate itself, not a policy that happens to mention it.
  - **B / B2** — `favorites` INSERT refused the company account with `42501`, **and the identical insert as a trekker succeeded**. Only the pair is evidence: a rejection alone is equally consistent with a missing grant, a unique violation or an unrelated policy.
  - **C / C2** — `join_trek_and_chat()` raised `Company accounts cannot join treks` for the company account and returned a normal jsonb payload for the trekker. Both blocks `disable trigger user` on `trek_participants` first — the three live notification triggers there send real email, and if the guard had been inert the mail would have left before the ROLLBACK could matter.
  - **POST-CHECK** — no favourite, no batch, no disabled trigger, both `account_type` values unchanged.
- Read-only MCP could never have done this: it cannot `SET ROLE` and cannot execute `is_trekker()` (permission denied — itself evidence the revoke works). Per the storage rate-limit lesson, structural checks cannot tell a working guard from an inert one.

### 2 — route separation + UI

**Status:** ✅

- `npm run build` clean; all URLs unchanged (route groups don't affect paths).
- **Route group** `src/app/(trekker)/` now holds `profile`, `favorites`, `messages`, `edits`, `review` behind [`src/app/(trekker)/layout.tsx`](src/app/(trekker)/layout.tsx) — server guard calling the same `is_trekker()` RPC the RLS policies use, so the UI can never disagree with what the DB allows; company accounts are redirected to `/dashboard`. Middleware deliberately untouched: it runs on every request and this matters on 6 routes.
- **Reverse guard**: [`src/app/dashboard/layout.tsx`](src/app/dashboard/layout.tsx) no longer dead-ends trekkers at `/company/apply` (which now rejects them) — no membership + trekker → `/`, no membership + company → `/company/apply`.
- **Data**: `isTrekker()` in `src/lib/company.ts`, `useIsTrekker` + `isTrekker` query key in `src/lib/queries.ts`. **Nav**: `Header` renders Favorites/Profile/Messages only for trekkers (desktop + mobile); avatar link points at `/dashboard/settings` for company accounts.
- **Booking controls**: `TrekCard` drops the Join button (View Details spans full width) and `TrekDetailClient` replaces Book This Trek with an explanatory note and hides the favourite heart — all gated on `canJoin`/`canBook`, which stay true for signed-out visitors so the login prompt survives. Company accounts still browse `/explore` and `/trek/[id]`. (The one page this missed, `src/app/test/trek/[id]`, was deleted with the rest of `src/app/test/*` on 2026-08-08 — L4.)

### 3 — company signup path + operator account

**Status:** ✅

- `npm run build` clean, `/dashboard/account` route present, lint unchanged (3 pre-existing errors).
- **Signup**: `AuthPanel` gained a permanent trekker/company segmented control (the type is pinned after `handle_new_user()` stamps it, so there is no switch-later path); `signUp()` in `src/lib/auth.ts` takes `accountType` and passes `account_type` in `options.data` → `raw_user_meta_data`. Company signup deliberately does **not** collect company name/slug: email confirmation is on, so `signUp` returns no session and `apply_for_company()` could not be called in the same step — the details are collected at `/company/apply` after first sign-in instead, which the step-2 dashboard guard already routes to.
- **Post-login routing**: the login form carries the same segmented control ("I'm signing in as"); `handleLogin` routes on the pick — trekker → `/`, company → `/dashboard` (→ `/company/apply` when they have no company yet) — and rejects a mismatch rather than landing someone where they can't act.
- **`/company/apply`**: renders a "this is a trekker account" explainer instead of the form for trekkers, gated on the new `getMyAccountType()`/`useAccountType` — **not** `isTrekker()`, because platform admins read `true` there but `'company'` from the column, and the RPC gates on the column. `'Only company accounts can apply…'` added to `KNOWN_APPLY_ERRORS`.
- **Operator account**: new `/dashboard/account` (name + password change, email read-only) with `accountNameSchema` in `src/lib/schemas.ts`, plus a "My account" nav entry in `DashboardShell`. Put on its own route rather than a tab on `/dashboard/settings` because that page is `useRequireCompanyRole(['owner','admin'])`-gated and redirects staff away — staff need a password form too

### 4 — invite → accept (consent before conversion)

**Status:** ✅

- [`supabase/phases/phase-g-invite-accept.sql`](supabase/phases/phase-g-invite-accept.sql) **applied 2026-08-06**, folded into [`supabase/schema.sql`](supabase/schema.sql) §15 (+ §14.3 updated in place for the hatch) + `DATABASE.md` + `security-fixes.sql` + `CONTEXT.md`. `npm run build` clean.
- **Structural verification live via read-only MCP**: `company_invites` present with RLS on and exactly one policy (SELECT), both partial indexes with the right predicates; `company_members` down to 3 policies (r/w/d) with **no INSERT policy** and `has_table_privilege('authenticated','company_members','insert')` = f; invites insert = f / select = t for `authenticated`, select = f for `anon`; all six functions SECURITY DEFINER with `search_path` pinned, the four new ones `authenticated`-only; pin trigger present with the GUC branch in its body.
- **Runtime behaviour verified 2026-08-06** — blocks A–F run from the SQL Editor against a **non-admin** company owner and a **non-admin** trekker ([`supabase/phases/verify-phase-g.sql`](supabase/phases/verify-phase-g.sql)), all rolled back, both post-checks clean and triggers restored. **A** invite creates an invite and no membership; **B** direct `company_members` insert → `42501 permission denied` — a *grant* denial, not an RLS violation, so re-adding a policy alone cannot reopen the path; **C** accept ran to completion (`status='accepted'` is the RPC's last statement, after the flip and the membership insert, so both succeeded); **D** a plain `update profiles set account_type='company'` is still pinned back — the GUC hatch did **not** leak, which also behaviourally proves step 1's pin; **E/E2** both confirmed **and waitlisted** upcoming bookings block conversion (E2 is the deviation from the original "confirmed only" plan, and it holds); **F** a third party cannot accept — though weakly, since it read the invite id through a subquery RLS hides from a non-member and may have passed NULL; **F2** settles it on the strong claim by capturing the id while impersonating the admin and holding it across the identity switch, so RLS never filters it and the ownership check is the only thing that can reject — it rejected.
- **Invite ids are not bearer tokens.** **Why a consent step at all**: `invite_company_member()` inserted straight into `company_members` and answered "Teammate added"; bolting conversion onto that would let any company admin end a trekker's account by typing their email. **DB**: new `company_invites` (company_id, lowercased email, invited_by, role, status pending | accepted | declined | revoked, expires_at default +14d) with a partial unique index on `(company_id, lower(email)) where status='pending'`; `invite_company_member()` rewritten to write a pending invite (keeps its `is_company_admin` gate, its 20/hr `rate_events` cap and the returned — not raised — `not_found`, and sweeps expired pendings to `revoked` first so a timed-out invite can't make someone permanently un-invitable); `accept_company_invite()` / `decline_company_invite()` / `revoke_company_invite()` / `get_my_invites()` all SECURITY DEFINER. **No token and no email delivery on purpose** — the invitee must already have a Trekker account (the RPC resolves them in `profiles` by email), so the invite is simply shown to them when they sign in; a hashed token + a mail step is what inviting people *without* accounts would need.
- **Deviations from the plan, deliberate**: (a) the invitee reads through `get_my_invites()` rather than an RLS policy matching their own `profiles.email` — they are not a member yet, so `companies` hides an unapproved company from them and `profiles` is self-only, i.e. the same reason `get_company_members()` exists; (b) accept branches on the raw `account_type` (**not** `is_trekker()`, which is true for platform admins whatever their column says) — an account that is *already* `company` just gains the membership, so dropping the INSERT policy doesn't silently remove the ability to add an existing company account to a second team; (c) the upcoming-trek refusal counts **waitlisted** rows too, not just confirmed — `promote_waitlist_on_leave()` promotes FIFO without consulting `account_type`, so a waitlisted row is a booking that can activate itself after the conversion. **The pin's escape hatch** is a transaction-local GUC (`set_config('app.account_type_change','allow',true)`) that `protect_profile_account_type()` honours: PostgREST exposes no way for a client to call `set_config`, so the branch is reachable only from inside a definer function that opts in, and the RPC hard-codes `'company'` inside the `account_type='trekker'` branch so there is no expression that could move an account back.
- **Bypass closed in the same phase**: the `company admins invite staff` INSERT policy on `company_members` had `with check (is_company_admin(company_id) and role='staff')` with **no `user_id` constraint** — the publishable key ships in the client bundle, so any company admin could POST `/rest/v1/company_members` with an arbitrary `user_id` and skip the RPC entirely; after step 4 that would convert a stranger's account with no invite and no consent, making the consent gate decorative. Policy dropped + `revoke insert … from anon, authenticated`, leaving `apply_for_company()` (owner row) and `accept_company_invite()` (invited member) as the only INSERT paths. Verified first that no app code inserts into `company_members` directly. **App**: `listCompanyInvites`/`revokeInvite`/`getMyInvites`/`acceptInvite`/`declineInvite` in [`src/lib/company.ts`](src/lib/company.ts) (+ `already_invited` code, invite copy now "Invite sent."); `useCompanyInvites`/`useMyInvites` + keys in [`src/lib/queries.ts`](src/lib/queries.ts); pending-invites list with Revoke on [`/dashboard/team`](src/app/dashboard/team/page.tsx); new [`/invites`](src/app/invites/page.tsx)
- **deliberately outside the `(trekker)` group** — the invitee is a trekker before accepting and a company account after, so the group guard would bounce them mid-flow — stating the cost (no more booking/favouriting, bookings + favourites + chats stay on record but unreachable, reviews stay published, admin-only to undo) above a two-step confirm; `Header` gains "Invitations (n)" for both navs, shown only when there is one, or the page is unreachable


### 5 — batch announcements (company → its bookers)

**Status:** ✅ — app code shipped + `npm run build` clean, and [`supabase/phases/phase-i-batch-announcements.sql`](supabase/phases/phase-i-batch-announcements.sql) **applied 2026-08-08**.

**Verified live via read-only MCP after the apply:** `is_announcement` is `boolean NOT NULL default false`; both `with check` clauses carry the new conjunct (`Send messages` = `user_id = auth.uid() AND is_chat_participant(...) AND is_announcement = false`, `Edit own messages` = `user_id = auth.uid() AND is_announcement = false`); all four pre-existing policies survived the drop/recreate (`Read messages`, `Delete own messages` untouched); both RPCs are SECURITY DEFINER with `search_path = public, pg_temp` pinned, `anon` = false / `authenticated` = true; and the anon-executable definer count is **still 3**, so the new pair didn't re-open the lint.

**Behaviourally verified 2026-08-12** — all six VERIFY blocks run as real writes, the forgery control through PostgREST as a signed-in trekker (not just from the SQL Editor):

- **The forgery pair (block 4), as trekker `d903dbb6…` against a chat they belong to.** `POST /rest/v1/conversation_messages` with `is_announcement:true` → **403 / `42501` new row violates row-level security policy**; the byte-identical request without the flag → **201**, row returned with `is_announcement:false`. Same user, same conversation, one field different — which is what makes the refusal attributable to the new conjunct rather than to a missing participant row or a role mixup. (Rolled-back SQL Editor equivalents give the same pair; the run that counts went through the client's own key and token.)
- **Post + read-back (block 5).** Announcement posted to batch `6ca0930b…` via `post_batch_announcement()` renders on the trekker's `/messages` as the amber notice with an unread badge, and comes back from `get_batch_announcements()` with `author_name` populated.
- **All four controls (block 6) refuse as specified:** non-member post → *You do not have permission…*; non-approved company → same refusal; batch with no conversation → *No one has booked this departure yet*; non-member read → 0 rows, silently.

⚠️ **Two setup steps the phase file's template doesn't mention, both of which make a control inert rather than fail loudly.** (1) The SQL Editor connects as `postgres`, which owns `conversation_messages` and has no `FORCE ROW LEVEL SECURITY` — so **both** halves of the forgery pair succeed unless the block does `set local role authenticated`, and the guard reads as broken-open when it is fine. (2) There is no longer a non-approved company anywhere in the DB (all four are `approved` as of 2026-08-12), so the frozen-company control needs a status flip inside a rolled-back transaction — and that flip needs `request.jwt.claims` set to a platform admin first, or `protect_company_admin_fields()` silently reverts it and the control passes for the wrong reason. Same trap as phase H, third occurrence; it is in [Known Gotchas](#known-gotchas).

**The gap it closes:** `/messages` lives under the `(trekker)` route group and its nav link is gated on `is_trekker()`, and `join_trek_and_chat()` refuses company accounts outright — so an operator had **no channel at all** to the people who booked their departure. Last remaining step of the account split.

- **Shape: a flagged row in the batch's existing conversation, not a new table.** `conversation_messages` gains `is_announcement boolean not null default false`. That reuses realtime delivery, `get_unread_counts()` and `mark_conversation_read()` **unchanged** — the announcement lands where trekkers already look and lights up the unread badge for free. A separate `batch_announcements` table would have needed its own RLS, its own trekker-facing surface and its own unread tracking for the same outcome.
- ⚠️ **The flag has to be forgeable-proof, and the default policies were not.** `conversation_messages` INSERT was `user_id = auth.uid() AND is_chat_participant(...)` — nothing about the new column — so any trekker could `POST /rest/v1/conversation_messages` with `is_announcement:true` (the publishable key ships in the client bundle) and render a **forged operator notice** in their own trek's chat. Both INSERT and UPDATE `with check` now carry `and is_announcement = false`. The RPC is unaffected: it is SECURITY DEFINER owned by `postgres`, which owns the table and has not set `FORCE ROW LEVEL SECURITY`, so it bypasses both policies. **Side effect, accepted:** an announcement is immutable through the table API, soft-delete included — the author isn't a chat participant, so the messages page never offers them edit/delete anyway, and a wrong announcement is corrected by posting again.
- **Two RPCs, because the author is never a `conversation_participant`.** `post_batch_announcement(batch_id, message)` resolves the company from the batch, requires `is_approved_company_member()` (the manage-departures bar, not the looser any-member roster bar), and refuses when no conversation exists yet. `get_batch_announcements(batch_id)` is the dashboard read-back — the author literally cannot `SELECT` the row they just wrote, since that policy is `is_chat_participant()`. Both ship with the `revoke public, anon` + `grant authenticated` pair from phase F.
- **Rate limiting came free.** `conversation_messages_rate_limit` is an AFTER STATEMENT trigger reading `auth.uid()`, which inside a definer function is still the *caller* — so announcements hit the same 30/min cap as chat with no extra code, and the P0001 message is surfaced verbatim.
- **No client-side "has bookings" gate, deliberately.** The rule is "a conversation exists", which `join_trek_and_chat()` creates only for a **confirmed** participant — so a waitlist-only departure has a non-empty roster and still nowhere to post. Checking `participants.length` client-side would have been wrong; the RPC owns the rule and says *No one has booked this departure yet*. ⚠️ **"A conversation exists" was not the same as "someone is listening"** — the conversation outlives everyone leaving (`leaveTrek` clears `conversation_participants`, never the `conversations` row — the same fact behind the undeletable-departure gotcha), so a vacated departure accepted an announcement into a chat with **zero** members and reported success. 10 of 17 batches were in that state on 2026-08-12. Fixed by [`fix-announcement-requires-listeners.sql`](supabase/phases/fix-announcement-requires-listeners.sql) (**applied + verified live 2026-08-12**), which adds a participant-existence check as a **second** branch with its own message: *"Everyone has left this departure — there is no one to announce to"*, because "no one has booked" is untrue of a departure five people booked and then left, and `postBatchAnnouncement` shows P0001 text verbatim. **Still no client-side gate** — the roster on the participants page includes waitlisted trekkers, who have no chat seat, so `participants.length` remains the wrong test. ✅ **Behaviourally verified 2026-08-12** (VERIFY blocks 2 + 3, write-capable session, both rolled back): the vacated departure raised *Everyone has left this departure…*, and **the same caller against a departure that still has a member returned normal jsonb**. The pair is the evidence — a refusal alone would have been equally consistent with a broken function or a lost grant.
- **App:** [`postBatchAnnouncement`/`getBatchAnnouncements`](src/lib/company.ts) (expected refusals all arrive as P0001 raises written to be shown as-is, same handling as the chat composer), `announcementSchema` in [`src/lib/schemas.ts`](src/lib/schemas.ts), `useBatchAnnouncements` + key in [`src/lib/queries.ts`](src/lib/queries.ts), composer + sent-history on [`/dashboard/treks/[id]/participants`](src/app/dashboard/treks/[id]/participants/page.tsx) (gated on `approved`, mirroring the departures page). **Trekker side:** [`/messages`](src/app/(trekker)/messages/page.tsx) renders an announcement as a distinct amber notice with a `Megaphone` badge instead of a peer bubble — no reply/react/edit affordances, since they'd point at someone who cannot read the thread.


## Phase 1 — Engineering foundation (shipped)

### Chat hot-path indexes (shipped)

**Status:** ✅ — **applied + verified live 2026-08-12**, [`supabase/phases/perf-chat-hot-path-indexes.sql`](supabase/phases/perf-chat-hot-path-indexes.sql). DDL mirrored into `supabase/schema.sql` §3 (beside each table) with the rationale in a new **§18**; `DATABASE.md` rows updated.

**The gap:** `conversation_messages` carried only its `(created_at, id)` pkey and `conversation_messages_user_created_idx (user_id, created_at desc)` (added by §13 for the flood trigger) — **nothing led with `conversation_id`**, which is exactly what `fetchMessagesPage()` filters on ([src/app/(trekker)/messages/page.tsx:169](src/app/(trekker)/messages/page.tsx#L169): `.eq('conversation_id').order('created_at', desc).limit(30)`, plus `.lt('created_at', cursor)` for older pages). Every conversation open and every scroll-back page was a sequential scan of the fastest-growing table in the schema. Harmless at 59 rows; a cliff around 50k. Same shape on `conversation_participants`, whose two indexes both led with `conversation_id`, leaving "which chats am I in?" unindexed.

Four indexes:
- **`conversation_messages (conversation_id, created_at desc)`** — the one that matters. Column order is the point: equality on `conversation_id` then a descending range on `created_at` is served by one index range scan that stops after 30 rows, sort included. Also the inner half of `get_unread_counts()`.
- **`conversation_participants (user_id, conversation_id)`** — serves the sidebar read ([page.tsx:125](src/app/(trekker)/messages/page.tsx#L125)) and the **driving** side of `get_unread_counts()`, which runs on every page load for the unread badge, not just on `/messages`. Covering for both (they select only `conversation_id`); also indexes the `user_id` FK.
- **`favorites (trek_id)`** and **`trek_reviews (user_id)`** — the other two unindexed FKs; each table's unique leads with the other column.

Plus a **duplicate dropped**: `conversation_participants` carried two byte-identical uniques on `(conversation_id, user_id)` — `…_conv_user_key` (declared in `schema.sql`) and `…_conversation_id_user_id_key` (Postgres default name, never documented). Both btrees were maintained on every chat join for one guarantee. Safe to drop either because every `on conflict (conversation_id, user_id)` in the codebase (`join_trek_and_chat`, `promote_waitlist_on_leave`) infers its arbiter from the **column list**, not a constraint name, and no FK targeted either; the documented name was kept. This supersedes [`fix-duplicate-participant-unique.sql`](supabase/phases/fix-duplicate-participant-unique.sql) (written 2026-08-05, never applied — folded in so the whole hot path was one paste; that file is now marked superseded and is a no-op).

**Deliberately skipped:** `trek_batches.trek_id` is already the leading column of `trek_batches_trekid_batchdate_key` and a prefix is usable, so a standalone index there is pure write overhead — `CODE_REVIEW.md` item 6's suggested SQL includes it; don't. `companies.approved_by` and `company_invites.invited_by` are genuinely unindexed FKs but 4 rows each on platform-admin-only paths; **they are the only two the unindexed-FK verify query still returns, which is expected, not debt.**

⚠️ **Not `CONCURRENTLY`, and don't "fix" that** — the SQL Editor submits a multi-statement script inside a transaction, and `CREATE INDEX CONCURRENTLY` cannot run in a transaction block. At these sizes a plain `CREATE INDEX` is milliseconds; the phase file says to split it and run each concurrently if `conversation_messages` is ever large.

**Verified via read-only MCP after apply:** all four indexes present with the intended definitions, exactly one unique left on `conversation_participants`, and the unindexed-FK query down to the two skipped admin ones. ⚠️ **A plain `explain` still shows `Seq Scan`** — at 59 rows in 2 heap pages that is the planner being correct, not the index being wrong, and reading it as a failure would be the obvious mistake here. Forcing the choice with `set local enable_seqscan = off` gives `Index Scan using conversation_messages_conv_created_idx`, `Index Cond: (conversation_id = …)`, and **no Sort node** — which is the real proof the column order is right, since a wrong order would still index-scan but then sort.

### One UI system (drop MUI / Emotion / Bootstrap)

**Status:** ✅

All four removed from `package.json`; only Tailwind remains. Last MUI use (`TrekPagination`) rewritten in Tailwind + `lucide-react` (`src/components/ui/TrekPagination.tsx`)

### Zod validation (shared client+server)

**Status:** ✅

Closes M4. Shared, framework-agnostic schemas in `src/lib/schemas.ts` (`zod ^4`): sign-up/in, forgot/reset password, profile update, chat message + `fieldErrors()` helper. Wired into all 4 auth pages (`src/app/auth/*`), both profile editors (`src/app/profile/edit/page.tsx`, `src/app/edits/page.tsx`), and chat send (`src/app/messages/page.tsx`). New-password min unified to 8 chars (was 6 on sign-up). Module is React/Next/Supabase-free so the future Server layer can reuse it server-side

### TanStack Query

**Status:** 🟡

Provider `src/app/providers.tsx` (wired in `layout.tsx`); shared query-keys + hooks in `src/lib/queries.ts`. Migrated: explore (`useSearchTreks` — debounced filters + cached pagination, now seeded with the server's page-1 rows via `initialData`), favorites (list + remove mutation), `FavCard` (status query + toggle mutation). Favorite mutations are optimistic with scoped (`exact`) invalidation (follow-up #6, 2026-06-22). Home/company storefront no longer use hooks at all — they read server-side, so `useFeaturedTreks`/`useStorefrontTreks`/`useCompany` (+ their query keys and the `FeaturedTrek` type) were removed as dead. Pending work tracked in §1 (profile still on manual `fetch`/`useEffect`)

### SEO — server rendering + metadata

**Status:** ✅

- Fixes the "every route reports the same title/description and ships an empty `<div>`" problem.
- **Server components:** `/` and `/company/[slug]` are now pure server components; `/trek/[id]` and `/explore` are server pages wrapping client islands (`src/app/trek/[id]/TrekDetailClient.tsx`, `src/app/explore/ExploreClient.tsx`) that keep join/favorite/checklist/filter/pagination interactivity. Shared server reads live in `src/lib/server-queries.ts` (session-aware `utils/supabase/server` factory, so RLS behaviour is unchanged — a company member still previews their own inactive trek — and each fetch is React `cache()`d so `generateMetadata()` and the page body share one round-trip).
- **Metadata:** `metadataBase` + title template + `og:site_name`/`twitter:card` defaults in `layout.tsx` (`src/lib/site.ts` resolves the origin from `NEXT_PUBLIC_SITE_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → localhost); `generateMetadata()` on `/trek/[id]` (title, `difficulty · location · ₹cost` + description, cover photo as OG/Twitter image, canonical) and `/company/[slug]` (name, description, cover/logo image, canonical, `noindex` while unapproved); static metadata on `/explore`.
- **Crawl:** `src/app/sitemap.ts` (static routes + active treks of approved companies + approved companies; filters explicitly rather than relying on RLS, since a signed-in platform admin would otherwise get pending rows) and `src/app/robots.ts` (disallows `/admin`, `/dashboard`, `/profile`, `/favorites`, `/messages`, `/review`, `/auth` — `/edits` went with the route on 2026-08-14).
- **JSON-LD + `/about` metadata (2026-08-08).** [src/components/ui/JsonLd.tsx](src/components/ui/JsonLd.tsx) renders the payload as inline `application/ld+json`, escaping `<` → `<`: descriptions are user-supplied and a literal `</script>` in one would close the tag early. `/trek/[id]` emits **one `Event` per upcoming departure** (`@graph` array — Google wants one item per date, not one Event with many), each with `location`, `organizer`, `offers` (INR), `aggregateRating` from the trek's reviews and `maximumAttendeeCapacity`; a trek with **no** upcoming batch is not an event, so it falls back to a single `Product` with the same offer/rating rather than emitting nothing. `/company/[slug]` emits `Organization` (logo, image, description, `sameAs: [website]`) **only when approved** — unapproved storefronts are `noindex`, so describing them to a crawler works against that. `/about` gained title/description/canonical/OG/Twitter metadata.
- **Generated per-trek OG image (2026-08-12).** [src/app/trek/[id]/opengraph-image.tsx](src/app/trek/[id]/opengraph-image.tsx) renders a 1200×630 branded gradient card (mountain mark + "Trek Buddies", difficulty pill, title, `difficulty · location · ₹cost`) via `ImageResponse`, replacing the raw cover photo that carried no title or branding. `generateMetadata()` no longer sets `openGraph.images`/`twitter.images` — an explicit `images` would override the file convention, and Next fills `twitter.images` from the resolved Open Graph ones. Title is cut to 60 chars (`truncate`), which is exactly two lines at 66px. The card reads through the **cookie-less** `@/lib/supabase` singleton (a link scraper is anonymous) and selects only the four fields it draws; a missing/invalid id falls back to a generic branded card rather than throwing. `factLine()` moved from the page to `src/lib/site.ts` so page metadata and the card can't drift. Inter 400/700 are colocated as `.ttf` — the built-in font draws ₹ and · as tofu — addressed via `new URL(…, import.meta.url)` so the bundler emits them next to the route, and read with `readFile`, **not `fetch`** (`fetch` cannot open a `file:` URL — it fails with a bare `TypeError: fetch failed`). Verified: `npm run build` clean; anonymous `curl` returns a 1200×630 PNG in dev, `next start`, and the `.next/standalone` server (fonts land in `.next/standalone/.next/server/assets/`), and the trek page's `og:image`/`twitter:image` both point at the route.
- **404s:** missing trek/company now `notFound()` → real HTTP 404 via new `src/app/not-found.tsx`, instead of a 200 with "not found" text (a soft 404).
- **Proxy fix:** `robots.txt`/`sitemap.xml` excluded from the `src/proxy.ts` matcher — they carry no session, so the auth guard was 307-ing every crawler to `/auth/login`. Verified: `npm run build` clean; `curl` shows real `<title>`/`og:image`/`<h1>` per trek, 18-URL sitemap, 404 status on a bogus id; Playwright shows 0 hydration errors and 0 redundant client fetches on `/` and `/explore`

### Tests + CI (Vitest/RTL + Playwright + GH Actions)

**Status:** ✅

- **Unit/component:** Vitest + jsdom + React Testing Library — `vitest.config.ts`, `vitest.setup.ts`; 26 tests across `src/lib/schemas.test.ts` (all Zod schemas + `fieldErrors`), `src/components/ui/TrekPagination.test.tsx`, `src/components/ui/ConfirmationModal.test.tsx`.
- **E2E:** Playwright — `playwright.config.ts` (webServer: dev locally / prod `npm run start` in CI), `e2e/smoke.spec.ts` (home + explore smoke). **CI:** `.github/workflows/ci.yml` — lint → unit tests → build, then a Playwright job; runs with dummy public Supabase env. Scripts: `npm run test` / `test:watch` / `test:e2e`. Test/config files excluded from the Next build type-check (`tsconfig.json`); test artifacts gitignored; Deno edge functions added to ESLint ignores (already excluded from the TS build)

### Rate limiting — core write paths

**Status:** ✅

- **Applied + verified live 2026-08-05** ([`supabase/phases/rate-limiting.sql`](supabase/phases/rate-limiting.sql), folded into `supabase/schema.sql` §13 + `supabase/security-fixes.sql` + `DATABASE.md`). Every limit is enforced **in Postgres, not a Route Handler** — the publishable key ships in the client bundle, so anything enforced in Next.js is skipped by calling PostgREST directly; and in **triggers, not RPC bodies**, because these tables carry a direct client INSERT policy alongside their RPC.
- **Chat flood** 30 msg/min — `AFTER INSERT … FOR EACH STATEMENT` on `conversation_messages` (a per-row `WITH CHECK` cannot see its own statement's siblings, so a PostgREST array insert would pass 1000 rows through a count of 0; a statement trigger also raises a real message where a failed check gives an opaque 42501). Counts real rows — messages are soft-deleted, never removed.
- **Join/leave email amplification** 10/hr — row trigger on `trek_participants`; `notify_trek_participation()` fires on INSERT *and* DELETE so a cycle mails real people twice, `UNIQUE (user_id, batch_id)` doesn't help because leaving frees the slot, and the guard can't live in `join_trek_and_chat()` since the "Users can join treks" policy permits a direct INSERT.
- **Invite enumeration** 20/hr — inline in `invite_company_member()`, whose "no account found" branch changed from `raise` to `return {error:'not_found'}`: a raised exception rolls back the `rate_events` row recording the attempt, so every failed probe erased its own evidence and the limit counted nothing (the distinct not-found answer is kept on purpose — it's how an admin learns they mistyped the address). New `rate_events` table is log-only, used *only* where evidence doesn't survive; RLS on with **zero policies + grants revoked**, so it's unreachable via PostgREST and a user can neither read their counter nor delete it to reset a limit; `pg_cron` job `prune-rate-events` (jobid 2, `17 * * * *`) keeps a day. Verified live that `favorites`/`trek_reviews`/`company_members`/`trek_batches`/`companies` are already bounded by unique indexes and need nothing. Client side: `src/lib/company.ts` reads the new `error` codes; `src/app/messages/page.tsx` rolls back the optimistic bubble and returns the text to the composer on rejection. `npm run build` clean. Storage-upload limits followed as Phase 2 — see the row below. ⚠️ First apply attempt failed with `42P01 relation "public.conversation_messages" does not exist` — the SQL Editor tab was open on a **different Supabase project**; the file was correct. Confirm `current_database()`/`to_regclass()` before concluding a phase file is broken

### Rate limiting — storage uploads

**Status:** ✅

- **Applied + verified live END TO END 2026-08-05** — a real avatar upload produced `rate_events(action='upload', actor=662d9204-…)` at 12:43:55. ⚠️ **It shipped broken first and every structural check passed anyway.** The original version keyed off `auth.uid()`, which returns **NULL inside a trigger on the storage-api path** even though RLS policies on the very same INSERT resolve it correctly — so the guard fired, hit its "service-role write" null guard, returned early, and recorded nothing while `pg_trigger`/`pg_proc` reported everything healthy (`tgenabled='O'`, `tgtype=21`, `SECURITY DEFINER`, `search_path` pinned). Found by instrumenting the trigger with an unconditional debug write ahead of the null guard ([`supabase/phases/diagnose-storage-rate-limit.sql`](supabase/phases/diagnose-storage-rate-limit.sql)): one upload returned `tg_op=INSERT bucket=avatars uid=NULL session_replication_role=origin`, proving it fired and the uid was the problem. Fixed in [`supabase/phases/fix-storage-rate-limit-owner.sql`](supabase/phases/fix-storage-rate-limit-owner.sql) by taking identity from `coalesce(new.owner, auth.uid())` — storage-api populates `owner` from the JWT sub on every upload (live: avatars 6/7 with owner, the 1 null being the seeded `image.jpg`; trek-reviews 11/11) and the client cannot forge it since the storage schema isn't exposed through PostgREST. **Process lesson: structural verification cannot distinguish a working trigger from an inert one, and the two Phase 1 triggers were not evidence for this one — they fire on PostgREST writes where the claims GUC IS present.** Original entry: **Applied 2026-08-05** ([`supabase/phases/rate-limiting-storage.sql`](supabase/phases/rate-limiting-storage.sql), folded into `supabase/schema.sql` §13.4 + the bucket caps in §9/§12.7, `supabase/security-fixes.sql`, `DATABASE.md`). Phase 2 of the rate-limiting work. Before this, **every bucket had `file_size_limit = null` and `allowed_mime_types = null`** — the only ceiling was Supabase's global 50MB, any content type was accepted, and there was no per-user cap at all; `compressImage()` runs in the browser and is skipped entirely by calling the Storage API directly with the publishable key. **Two layers, because they stop different things** — Layer A alone still allows 10,000 × 3MB, Layer B alone still allows 6 × 50MB. **A — per-upload ceiling:** `file_size_limit = 3 MiB` + `allowed_mime_types = image/jpeg,image/png,image/webp` on `avatars`/`trek-reviews`/`company-logos`/`trek-images`, enforced by storage-api at the edge before the bytes are stored; 3 MiB rather than tighter because `compressImage()` returns the **original** file when compression fails (`src/utils/imageCompression.ts:14`). `trek-profile` deliberately uncapped — 14 legacy objects, no policies, no client write path.
- **B — per-user rate:** `storage_objects_rate_limit`, an `AFTER INSERT OR UPDATE FOR EACH ROW` trigger on `storage.objects` running `enforce_storage_rate_limit()`, **6 uploads/hour/user** with **`trek-reviews` carved out at 20/hour** (the review form is `multiple` with no file-count cap and uploads every photo in one `Promise.all`, so at 6 a single legitimate 8-photo submission would fail partway through its own submit).
- **`INSERT OR UPDATE`, not `INSERT`, is load-bearing:** `avatars` writes the fixed path `{uid}.{ext}` with `upsert:true`, so after the first upload *every* avatar write is an UPDATE — an INSERT-only guard would have left the single worst path (no compression, fixed path, unbounded repeat) completely unguarded; a `version` check stops renames/metadata touches from consuming budget. Counted in `rate_events`, **not** from `storage.objects`, because avatars are one row forever and review photos are user-deletable — the object table isn't a truthful counter in exactly the two places that matter. A trigger rather than four RLS `WITH CHECK` predicates: a `WITH CHECK` can't record an attempt, the INSERT policies don't cover the UPDATE path, and a trigger raises a real message where a failed check gives an opaque 42501. The function lives in `public` because `postgres` holds `TRIGGER` on `storage.objects` (so the trigger is creatable despite `supabase_storage_admin` owning the table) but **not** `CREATE` on the `storage` schema.
- **Client side:** there turned out to be **four** upload call sites, not three — `src/app/profile/edit/page.tsx` was missed on the first pass because the grep for `storage.from(` was single-line and that call splits `supabase.storage` / `.from('avatars')` across two. It is the **real** profile editor (`/edits` is an unused duplicate, CODE_REVIEW.md §7) and it uploaded raw files, so it broke first under the 3 MiB cap while reporting `[object Object]` — its catch block ran `String(error)` on a Supabase error, which are plain objects rather than `Error` instances, hiding the cause. `compressImage()` added to both avatar paths; new `src/lib/uploadErrors.ts` maps 413 / 415 / rate-limit rejections to actionable text across all four call sites ("try again" is wrong advice for a rate limit); the object-shaped-error fallback fixed in `/profile/edit`. `npm run build` clean.
- **Live verification (MCP):** 4 buckets at `3145728` + 3 MIME types with `trek-profile` null; trigger `tgtype=21` (ROW + INSERT + UPDATE, AFTER) and enabled; `enforce_storage_rate_limit` `SECURITY DEFINER` owned by `postgres` with `search_path` pinned; `rate_events` still 0 policies and unreadable by `anon`+`authenticated`. ⚠️ **The cap works; the message did not reach the user (2026-08-08).** Seven avatar uploads in an hour produced exactly 6 `rate_events` rows and a rejected 7th — the Postgres log carries the raise verbatim and the storage log shows `POST /object/avatars/… → 500`. But **storage-api does not forward a database error message**: it answers 500 with a body of `{}`, so supabase-js builds its `StorageApiError` message from `JSON.stringify(body)` — literally `"{}"` (which is also why the console showed `Avatar upload error: {}`). `uploadErrors.ts` matched on `/too many images/i`, that never matched, and the user got the generic "please try again" — the one wrong answer, since retrying cannot succeed for another hour. No errcode fixes this: storage-api maps `42501` to its own hardcoded RLS text, `23505`/`23503` to key/bucket errors, everything else to an opaque 500.
- **Fix: stop parsing the error, ask the DB.** New `upload_rate_limited(p_bucket)` — read-only `SECURITY DEFINER` probe over the same counter, `authenticated`-only, returns one boolean about the caller's own row and nothing else (`rate_events` stays 0-policy/0-grant); `uploadErrorMessage()` is now `async` and calls it **only after an upload has already failed with an unrecognised error**, so the happy path costs no round trip. New `storage_rate_rule(p_bucket)` holds the bucket → (action, limit) mapping once, because the trigger and the probe would otherwise carry separate copies of "6" and drift on the first tuning pass. All four call sites now `await` (`profile/edit`, `edits`, `dashboard/settings`, `TrekForm`) and pass their own client + bucket — `settings`/`TrekForm` use the `@supabase/ssr` browser client, `profile/edit`/`edits` the singleton, so the client is a parameter rather than an import. `npm run build` clean. **Process lesson (second one from this trigger): a guard that fires correctly in Postgres can still be invisible to the user, and neither the SQL verify block nor the build catches that — only reading the actual toast does.** [`supabase/phases/fix-storage-rate-limit-message.sql`](supabase/phases/fix-storage-rate-limit-message.sql)
- **applied + verified live 2026-08-08** — `upload_rate_limited` `prosecdef=t`/`provolatile=s`, anon execute `f`, authenticated execute `t`; `storage_rate_rule` execute denied to anon + authenticated (the MCP role itself gets `42501` calling it); end-to-end, a rate-limited avatar upload now surfaces "You have uploaded too many images in the last hour. Please try again later." Folded into [`supabase/schema.sql`](supabase/schema.sql) §13.4 + new §13.5, [`supabase/security-fixes.sql`](supabase/security-fixes.sql), `DATABASE.md` §7/§9.
- **Follow-on cleanup:** the four call sites no longer `console.error` the raw `StorageError` — on this path it prints `{}` and repeats nothing the returned message doesn't, and Next 16's dev overlay turns every `console.error` into a red popup, so an expected rate-limit rejection looked like two crashes. `uploadErrorMessage()` now logs once, and only for the case it could **not** explain. `/profile/edit` also stopped re-logging + prefixing a handled `UploadError` (the toast read "Error updating profile: You have uploaded too many images…"), matching what `settings`/`TrekForm` already did, and its `finally` now clears `uploading` — a failed upload left the avatar spinner running forever

### Toasts + error boundaries + Sentry

**Status:** ✅

- **Toasts:** `sonner` `<Toaster>` in `src/app/providers.tsx`; all 38 app-side `alert()` calls replaced with `toast.success/error/info` across treks, messages, auth, profile, edits, reviews, cards (the 8 `alert()`s left in `src/app/test/*` went with the directory on 2026-08-08 — L4).
- **Error boundaries:** `src/app/error.tsx` + `src/app/global-error.tsx`, both report to Sentry via `captureException`.
- **Sentry:** `@sentry/nextjs` wired via `src/instrumentation.ts` (server/edge + `onRequestError`), `src/instrumentation-client.ts` (browser + router-transition tracing), and `withSentryConfig` in `next.config.js`. Inert until `NEXT_PUBLIC_SENTRY_DSN` is set; source-map upload gated on `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` (CI only). Env documented in `.env.local.example`


## Phase 0 — Security tail (shipped)

### Dependency CVEs patched — 6 high in production deps (shipped 2026-08-17)

**Status:** ✅ — closes the old `L5` item in `SECURITY_AUDIT_ISSUE.md` ("run `npm audit`"), found 2026-08-14 and fixed 2026-08-17 with `npm audit fix`.

| Package | Was | Now | Advisories closed |
|---|---|---|---|
| `next` | 16.2.9 | 16.3.1 | SSRF via attacker-controlled rewrite destination hostname; **unauthenticated disclosure of internal Server Function endpoints**; DoS in the Image Optimization API via SVG; cache confusion on request bodies; unbounded Server Action payload on Edge |
| `postcss` | 8.5.15 | 8.5.26 | Path traversal in source-map auto-loading → arbitrary `.map` file disclosure (`GHSA-r28c-9q8g-f849`, `GHSA-fxqj-rqcc-2cmp`) |
| `sharp` | 0.34.5 | ≥0.35.0 | 4 inherited libvips CVEs (`CVE-2026-33327`, `-33328`, `-35590`, `-35591`) — transitive via `next`, not a direct dependency |

The Server Function disclosure and the image-optimization DoS both applied directly — this app runs `output: 'standalone'` with `next/image` over two remote hosts. All three resolved inside the existing `^16` / `^8` ranges, so **`package.json` is unchanged**; only `package-lock.json` moved.

**Verified:** `npm run build` passes (all 31 routes emit, CSP still builds from `NEXT_PUBLIC_SUPABASE_URL` at config load) and `npm test` is green at 124/124.

**One low-severity finding is left and is deliberately not fixed:** `esbuild` 0.27.3–0.28.0 (`GHSA-g7r4-m6w7-qqqr`) — arbitrary file read *when running the dev server on Windows*. It arrives transitively and does not reach production or this repo's macOS/Linux workflow.

### Security headers

**Status:** 🟡 — headers enforced; CSP is report-only pending [§1.5](#promote-csp-from-report-only-to-enforcing).

[`next.config.mjs`](next.config.mjs) had **no `headers()` block at all** — every response shipped with zero browser-side policy. It now exports a `(phase) => config` function (phase, not `NODE_ENV`, because `NODE_ENV` is still `undefined` when Next loads the config — see Known Gotchas) serving six headers on `/:path*`.

Enforced immediately, none of which can break a working page:

| Header | Value | Why it matters *here* |
|---|---|---|
| `Referrer-Policy` | `strict-origin-when-cross-origin` | The only one fixing a live leak, not just hardening. Outbound clicks were sending the **full URL including query string** to third parties, and the password-reset flow carries `token_hash` in the URL ([auth recovery is token_hash-based, not PKCE](src/app/auth/reset-password)) |
| `X-Content-Type-Options` | `nosniff` | Users upload files to Supabase storage; without it a crafted "image" served with the wrong `Content-Type` can be sniffed as HTML/JS |
| `X-Frame-Options` + `frame-ancestors 'none'` | `DENY` | Clickjacking the join button / account settings. Free — the app has no `<iframe>` anywhere |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | **No `preload`** — preload is effectively irreversible and binds every future subdomain |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | Free — no code calls any of these APIs |

**CSP — what it does and does not buy.** Served report-only. `script-src` keeps `'unsafe-inline'`, because Next's App Router emits inline hydration/flight scripts and [`JsonLd.tsx`](src/components/ui/JsonLd.tsx) inlines JSON-LD; the nonce alternative must run in middleware, which forces **every page dynamic** and would undo the server-rendered SEO work. So it does **not** meaningfully stop XSS — injected inline script still runs. What it does buy: `connect-src` caps where data can be *sent*, so injected script cannot POST the browser-held Supabase session to an attacker origin, plus `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. `'unsafe-eval'` is added **only** in the dev phase (React Refresh); verified absent from the production policy.

**Allowed origins were enumerated from source, not guessed** — Supabase origin and the Sentry `report-uri` are both derived at build time from `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SENTRY_DSN` rather than hardcoded:

- `connect-src` — Supabase `https://` **and** `wss://` (realtime chat is a separate origin to CSP), `api.pwnedpasswords.com` ([`src/lib/auth.ts`](src/lib/auth.ts) HIBP check), Sentry ingest
- `img-src` — Supabase storage, `images.unsplash.com`, `www.transparenttextures.com` (chat background in [`messages/page.tsx`](src/app/(trekker)/messages/page.tsx)), plus `data:`/`blob:` for upload previews
- `worker-src 'self' blob:` — load-bearing; see §1.5
- `font-src 'self' data:` only — `next/font/google` self-hosts at build, so **no** Google Fonts origin is needed

**Verified** by curling a real `next start` server: all six headers present, `script-src` free of `'unsafe-eval'` in production and carrying it under `next dev`.

| Item | Status | Notes |
|------|--------|-------|
| M2 — re-enable middleware guard | ✅ | Active in `src/utils/supabase/middleware.ts` |
| L4 — delete `src/app/test/*` | ✅ 2026-08-08 | All 16 files removed: 8 routable pages (`/test`, `/test/batch`, `/test/fav`, `/test/profile`, `/test/profilet`, `/test/review`, `/test/storage-check`, `/test/trek/[id]`), one non-routable `editprofiletest.tsx`, and 6 `.html` design scratch files. Nothing imported from the directory. `/test` also removed from `publicRoutes` ([src/utils/supabase/middleware.ts](src/utils/supabase/middleware.ts)) and from the `robots.ts` disallow list (a rule for a route that no longer exists). Verified absent from the `npm run build` route table |
| Client-side logout / session guard | ✅ | Logout now navigates to `/` (`handleSignOut` in `src/components/layout/Header.tsx`) instead of leaving stale authenticated content on screen. New `useRequireAuth()` hook (`src/hooks/useRequireAuth.ts`) redirects to `/` when the session disappears in-place (logout, multi-tab sign-out, or expiry); applied to all protected pages: `profile`, `profile/edit`, `favorites`, `messages`, `edits`. Complements the middleware guard, which only fires on navigation/refresh |
| M3 — build error-checking on | ✅ | No `ignoreBuildErrors`/`ignoreDuringBuilds`; `noEmit: true` |
| NEW-5 — delete dead `increment_participants` | ✅ 2026-08-08 | [`supabase/phases/fix-drop-dead-increment-participants.sql`](supabase/phases/fix-drop-dead-increment-participants.sql) **applied**. Backed the legacy `src/lib/database.ts` join path, itself dead. Verified live after the apply: `increment_participants` absent, `update_participants_count` **present** with `trek_participants_count_trigger` still attached. ⚠️ `update_participants_count()` is **not** dead — it maintains the `participants_joined` counter Explore/Favorites read; the two names look interchangeable and are not. Doc debt: still present in `supabase/schema.sql` + `DATABASE.md` — see §1.5 |
| 3 open security advisors | ✅ | Resolved-by-design — no actionable dashboard toggle (`supabase/security-fixes.sql:376`). **(1)** `security_definer_view` on `public_profiles` is intentional (Known Gotcha — keep). **(2)** `auth_leaked_password_protection` toggle is Pro-only; enforced in app via `isPasswordPwned()` ([src/lib/auth.ts](src/lib/auth.ts), commit `65dfe82`). **(3)** `vulnerable_postgres_version` upgrade is Pro-only; acknowledged on free plan. Advisors keep flagging (1)+(2) since they only inspect the toggle, not the design/app-level mitigation. |

## Review follow-ups (resolved 2026-06-22)

Correctness/quality items surfaced by `/code-review` on the Phase 2 + TanStack Query work — all six closed. #1/#2/#3/#5 are schema changes (in `supabase/schema.sql`, applied + verified live on the DB via `supabase/apply-review-followups.sql`); #4/#6 shipped in code.

| # | Sev | Area | Fix | Evidence |
|---|-----|------|-----|----------|
| 1 | High | Capacity + waitlist | `update_participants_count()` filters `tp.status = 'confirmed'`, so `treks.participants_joined` excludes waitlisted joiners (verified: no counter drift on live DB). | `schema.sql` · `update_participants_count()` |
| 2 | Med | Gamification + stats | `award_user_achievements()` + `recompute_user_stats()` aggregate only `status = 'confirmed'` participations (badges, completions, distance, monthly joined/distance). | `schema.sql` · those two functions |
| 3 | Med | Search & filters | `search_treks()` tracks `v_has_search`; a non-empty search that sanitizes to empty returns no matches instead of the whole catalog (verified live: `'!!!'` → 0 rows). | `schema.sql` · `search_treks()` |
| 4 | Low | Trek detail | Misleading trek-wide `isFull` removed; button always reads "Book This Trek" — server + post-join toast report the true confirmed/waitlist status. | `src/app/trek/[id]/page.tsx` |
| 5 | Low | Waitlist position | `waitlist_position` tie-breaks by `(joined_at, id)`, so identical timestamps yield distinct positions. | `schema.sql` · `join_trek_and_chat()` |
| 6 | Low | TanStack Query | `useToggleFavorite`/`useRemoveFavorite` do optimistic updates with scoped (`exact`) invalidation; `useFeaturedTreks` is a single `search_treks` RPC (no N+1). | `src/lib/queries.ts` |

---

# Known Gotchas

Caveats, invariants, and "don't break this" notes. Some overlap with §1 backlog items (linked where they do); others document intentional designs that look like bugs — don't "fix" them.

- **Writing a behavioural verification script? Three traps that all produce a *confidently wrong* result, not an obvious failure.** Learned the hard way on phases F and H (2026-08-08); [`verify-phase-f.sql`](supabase/phases/verify-phase-f.sql) and [`verify-phase-h.sql`](supabase/phases/verify-phase-h.sql) are the worked examples. **(1) In the SQL Editor `auth.uid()` is null, so `is_platform_admin()` is false** — which means `trg_protect_company_admin_fields` silently reverts any direct `update companies set status=…`, and a script that freezes a company that way tests nothing while looking like it tested everything. Change status through `reject_company()`/`suspend_company()` under an admin's `request.jwt.claims`, or the setup step is inert. **(2) The editor shows only the last statement's result, and a deliberate error aborts everything after it** — so `-- expect: UPDATE 0` comments are invisible and a pasted multi-block file returns one error and no controls. End every block in exactly one row-returning statement and surface row counts with a data-modifying CTE (`with c as (update … returning 1) select count(*) from c`). **(3) A refusal alone is not evidence.** A missing grant, a unique violation or an unrelated policy all look identical to the guard firing. Pair every negative with the same statement run under conditions where it must succeed.
- **`explain` showing `Seq Scan` on a small table is not a missing index, and `set enable_seqscan = off` is how you tell the difference.** After adding `conversation_messages_conv_created_idx` (2026-08-12) the unforced plan still sequentially scanned — correctly, because 59 rows live in 2 heap pages and an index scan would cost more. The check that actually proves the index is *usable and correctly shaped* is to force it: look for `Index Cond` on the filter column **and the absence of a Sort node**. The missing Sort is the real signal — a wrongly-ordered composite index still index-scans and then sorts, which looks fine at 59 rows and falls over at 50k. **Corollary: don't add an index and conclude from a fast query that it worked; on a small table everything is fast.**

- **A phase file in `supabase/phases/` is a proposal, not an applied change — and this cuts both ways.** The established rule ("a SQL file's own comment is not evidence of database state") came from two files mislabeled *pending* that were actually live. The opposite happened on 2026-08-12: [`fix-duplicate-participant-unique.sql`](supabase/phases/fix-duplicate-participant-unique.sql) was written 2026-08-05, said nothing about its status, and sat **unapplied** for a week while the duplicate index it described kept costing writes on every chat join — caught only by querying `pg_indexes` directly. Verify against the catalog in both directions. Superseded files get a ⚠️ banner at the top rather than being deleted, so the reasoning stays readable — read the banner before running one.

- **Three SECURITY DEFINER functions must keep their `anon` EXECUTE grant. Revoking them takes the public site down.** `is_trek_visible`, `is_company_member` and `is_platform_admin` are called from **PUBLIC-role SELECT policies** on `treks`, `trek_batches` and `companies`. RLS quals evaluate as the *querying* role, so every anonymous read on `/explore`, `/trek/[id]` and `/company/[slug]` executes them — they are load-bearing for `anon`, not inert. The `anon_security_definer_function_executable` advisor flags them anyway: **3 WARNs stay open by design**, and a future "let's get that to zero" pass is a production outage. Everything else was revoked 2026-08-08 (§2 "Multi-tenant platform → F"). **Related:** `revoke … from public` also strips `authenticated`, which almost all of these inherit rather than hold directly — so any new definer RPC ships `revoke … from public, anon` **paired with** `grant execute … to authenticated`, or it breaks the dashboard while re-opening the lint.

- **A security check that runs in the browser, in front of a public API, raises the floor and enforces nothing.** The publishable key means every gate in `src/lib/` sits in front of an endpoint the attacker can call directly. `isPasswordPwned()` ([src/lib/auth.ts:32](src/lib/auth.ts#L32)) is the live example: a real HIBP k-anonymity check, genuinely useful against honest users picking a breached password, and skipped entirely by `POST /auth/v1/signup`. It is a UX feature that reads like a control — the control is the Supabase Auth platform setting, still disabled (§1.5). Same shape as the rate limiting note: that got moved *into Postgres* precisely because a Route Handler could not enforce it. **When reviewing, ask which role runs the check, not where the code lives.**
- **`grant execute … to authenticated` does not remove the default PUBLIC grant, so `schema.sql` can silently describe a more permissive database than production.** Postgres attaches `EXECUTE` to `PUBLIC` at `CREATE FUNCTION`; a later `grant` to `authenticated` adds nothing and revokes nothing. The 2026-08-08 revokes were applied live but never encoded in the generated schema, so from then until 2026-08-14 `schema.sql` said "anon may call all 15 multi-tenant RPCs" while production said otherwise — including a §10 comment asserting it as fact. Nothing was exposed, but the file that the DB suite builds its Postgres *from* was wrong, so the suite was testing a database that does not exist. Caught only when the roster test asserted `permission denied` and got an empty set; both the revokes and the test landed 2026-08-14. **Pair the revoke with the grant in the same migration** (as the note above already requires), and treat a green DB suite as evidence about `schema.sql`, **not** about production — the migration ledger and `has_function_privilege()` are what speak for production. The suite proves the two agree only if the revoke is written down.
- **A trekker could forge an operator announcement if `is_announcement` is ever left out of a `conversation_messages` write policy.** The publishable key ships in the client bundle, so `POST /rest/v1/conversation_messages` with `is_announcement:true` is one request away; the INSERT and UPDATE `with check` clauses both pin it to `false`, and `post_batch_announcement()` (SECURITY DEFINER, owned by `postgres`, table not `FORCE ROW LEVEL SECURITY`) is the only writer that can set it. If either policy is ever rewritten, carry the conjunct — the badge is a trust signal in a chat full of strangers. Consequence to expect, not a bug: announcements are immutable through the table API, soft-delete included.

- **`process.env.NODE_ENV` is `undefined` while `next.config.mjs` is being loaded — don't branch on it there.** A `NODE_ENV !== 'production'` check in the config reads as *dev in every phase*, so a dev-only relaxation silently ships to production. This bit the CSP on 2026-08-12: `'unsafe-eval'` landed in the production policy. Branch on the `phase` argument Next passes to a function-style config (`export default function config(phase)`, compared against `PHASE_DEVELOPMENT_SERVER` from `next/constants.js`) — `withSentryConfig` still wraps the returned object fine. **Related trap while verifying this:** `headers()` results are baked into `.next/routes-manifest.json` at **build** time, and `next start` silently exits with `EADDRINUSE` if a stale server holds the port — so `curl` cheerfully returns the *old* server's headers and the fix looks like it failed. Check `lsof -ti:3000` and read the manifest (`.next/routes-manifest.json`) before believing a header didn't change.

- **Don't set `output: 'standalone'` — this app deploys to Vercel, and it broke the deploy build (2026-08-26).** Vercel failed with `ENOENT … /vercel/path0/.next/next-server.js.nft.json`. That file is read in exactly one place — `copyTracedFiles()` ([node_modules/next/dist/build/utils.js:1106](node_modules/next/dist/build/utils.js#L1106)), reached only from `writeStandaloneDirectory()` under `if (config.output === 'standalone')` ([build/index.js:2815](node_modules/next/dist/build/index.js#L2815)) — so no standalone means no read and no ENOENT, whatever left the trace file absent in Vercel's builder. **It never bought anything here:** Vercel builds its own serverless output from the `.nft.json` traces directly, and CI's e2e job runs `npm run start` (`next start`), not `.next/standalone/server.js`, despite the artifact being named "standalone" in `.github/workflows/ci.yml` and the comment in `playwright.config.ts`. `standalone` is for self-hosting (Docker); there is no Dockerfile in this repo. **It does not reproduce locally** — a clean `next build` on macOS emits `next-server.js.nft.json` fine and writes `.next/standalone`, so a green local build is not evidence the Vercel build will pass.

- **The `src/proxy.ts` matcher is an allowlist by omission — anything it matches and that isn't in `publicRoutes` gets 307'd to `/auth/login`, including non-page routes.** `robots.txt` and `sitemap.xml` are excluded there for exactly this reason (crawlers send no session cookie). Any future public, session-less route (`.well-known/*`, a feed) needs the same treatment — test it with `curl`, not a logged-in browser, or the breakage is invisible. `/trek/[id]/opengraph-image` is already covered: `publicRoutes` matches on prefix, so `/trek` carries it.

- **`src/lib/site.ts` is server-only.** It reads `VERCEL_PROJECT_PRODUCTION_URL`, which is not `NEXT_PUBLIC_*`, so importing it into a client component silently bakes in the `localhost:3000` fallback. Client components keep their own local `DEFAULT_IMAGE_URL` constant instead of importing `DEFAULT_TREK_IMAGE`.

- **`/explore` passes `initialData` to `useSearchTreks` only for the exact query the server rendered** (default filters, page 1) — detected by *reference* equality against `DEFAULT_FILTERS`, which holds on first render and breaks as soon as the sessionStorage restore builds a new object. Don't switch that check to a deep compare: it would hand stale server rows to a restored filter set.

- **`auth.uid()` is NULL inside a trigger on `storage.objects`.** RLS policies on the same INSERT resolve it fine, so this is not a "the user isn't authenticated" problem — the claims GUC is available for policy evaluation but not in the trigger's execution context on the storage-api path. `enforce_storage_rate_limit()` therefore takes identity from `coalesce(new.owner, auth.uid())`; storage-api populates `owner` from the JWT sub on every upload and clients can't forge it (the `storage` schema isn't exposed through PostgREST). Don't "simplify" it back to `auth.uid()` for consistency with the other two rate-limit triggers — those fire on PostgREST writes, where the GUC *is* present. The failure mode is silent: the guard hits its null bail, records nothing, and every `pg_trigger`/`pg_proc` check still looks perfect. **Corollary: a guard on a path the app uses is not done until a real write through the app confirms it.**

- **A public storage bucket still needs a SELECT policy, or uploads break while reads keep working.** `.upload()` makes storage-api run `INSERT … RETURNING *`, and under RLS a `RETURNING` clause evaluates SELECT policies against the new row — so with no SELECT policy for `authenticated` on that bucket, the *write* fails with `new row violates row-level security policy for table "objects"` even though the INSERT policy is present and its predicate is true. Because the buckets are `public = true`, displaying an image is served by the CDN without consulting RLS, so nothing looks broken until someone uploads. This bit us on 2026-08-05: the `avatars` and `trek-reviews` SELECT policies were documented in `supabase/schema.sql` §9 but absent from the live DB (fixed by `supabase/phases/fix-missing-avatar-select-policies.sql`). Don't "clean up" a SELECT policy on a public bucket as redundant — and when an upload fails with an RLS error, check `pg_policies` for **all four** commands, not just INSERT.

- **`company_members` has no INSERT policy and no INSERT grant — memberships are created ONLY by `apply_for_company()` (owner) and `accept_company_invite()` (invited member).** The old `company admins invite staff` policy checked the company and the role but never `user_id`, so a company admin could add *any* account to their team by calling PostgREST directly with the publishable key. Once accepting an invite converts a trekker into a company account, that same request would destroy a stranger's account with no invite and no consent. Do not re-add a client INSERT path here; if a new flow needs to create a membership, put it in a SECURITY DEFINER RPC that re-checks who is asking. Applied by [`supabase/phases/phase-g-invite-accept.sql`](supabase/phases/phase-g-invite-accept.sql) §9.

- **`accept_company_invite()` opts out of the `account_type` pin with a transaction-local GUC, and that is the ONLY sanctioned way through it.** `protect_profile_account_type()` returns NEW unchanged when `app.account_type_change = 'allow'`; the RPC sets it with `set_config(..., is_local => true)` immediately before its UPDATE and clears it immediately after. This is safe only because PostgREST gives clients no way to call `set_config` — it is not in the exposed schema, and the only GUCs a request can influence are the `request.*` ones PostgREST sets itself. If a future change exposes an RPC that takes a GUC name, or moves this logic somewhere a client can reach, the pin from step 1 is gone and with it every rule that depends on `account_type`.

- **A trekker can book several departures of the same trek — never read `trek_participants` for a trek with `.maybeSingle()`.** The unique constraint is `(user_id, batch_id)`, not `(user_id, trek_id)`, and `join_trek_and_chat()` has no rule against a second date. `.maybeSingle()` **raises** on two rows and hands back `data: null`, which reads exactly like "not booked" — so the trek page offered "Book This Trek" to someone already booked, hid the Leave button, and told them to join before using the chat they were already in. Fixed 2026-08-18 in [`TrekDetailClient`](src/app/trek/[id]/TrekDetailClient.tsx) (both the status read and `handleChat`) by taking all rows and picking the earliest departure. **The failure mode is the trap**: one booking is the state you develop and test in, and the bug only appears on the second.

- **When a gate protects an irreversible action, "still loading" must resolve to the *safe* side, not to `false`.** `useAccountType` returns `undefined` while in flight, so `accountType === 'trekker'` is false for a trekker for as long as the query takes — and [`/invites`](src/app/invites/page.tsx) used that to decide whether to show the conversion warning and the two-step confirm. The Header's `showTrekkerNav` comment makes the opposite call on purpose (unknown ⇒ hide the trekker links, so nothing flashes), and copying that default here removed the consent gate on an account change only a platform admin can undo. Read the direction off the *consequence*: cosmetic nav ⇒ default to hiding; destructive action ⇒ default to asking, and disable the control until the answer arrives. Fixed 2026-08-18.

- **"Omit the key and the old value survives" is true of `.update()` and FALSE of `.upsert()` against a `not null` column.** PostgREST's upsert is `INSERT … ON CONFLICT DO UPDATE`, and **Postgres runs the `NOT NULL` check on the proposed tuple before it resolves the conflict** — so leaving a `not null` column out of an `.upsert()` payload raises `23502` even when the row already exists and only the UPDATE half would ever run. This is exactly how the first `/profile/edit` email fix broke every save with a cleared email (2026-08-18, replaced 2026-08-20). **Nothing catches it**: types pass, lint passes, the whole test suite passes, and the failure only appears at runtime against a real row. If you need "leave this column alone", use `.update(...).eq('id', …)` — a plain UPDATE genuinely ignores what it is not given. `profiles` is the only table this app upserted.

- **`is_trekker()` and `profiles.account_type` deliberately disagree for platform admins — pick the one that matches the rule you are mirroring, not the one that sounds right.** `is_trekker()` is `account_type = 'trekker' OR is_platform_admin()`, so a platform admin whose column reads `'company'` still gets `true`. That exemption is intentional (one rule instead of two half-rules), and it means the two are **not** interchangeable: use `is_trekker()` when gating something the *RLS policies* gate — `trek_participants`/`favorites` INSERT, `join_trek_and_chat()`, the `src/app/(trekker)/layout.tsx` guard — so the UI can never disagree with what the DB will allow; use the **raw `account_type`** when mirroring a rule the DB writes against the column itself — `apply_for_company()` requires `account_type = 'company'`, and `accept_company_invite()` branches on the raw value. Getting it backwards is not a type error and not a crash; it silently shows the wrong screen to exactly one class of user. This already bit `/company/apply`, which reads `getMyAccountType()` and **not** `useIsTrekker()` for that reason: gated on `is_trekker()` a platform admin would be shown the "this is a trekker account, you can't apply" explainer while `apply_for_company()` would have happily accepted them. **Testing corollary:** the main test account (`senjaliyameet8@gmail.com`) is both `account_type='company'` and a platform admin, so it passes every `is_trekker()` check and cannot detect this class of bug — verify account-type gating against a non-admin account, which is also why `verify-phase-f.sql` and `verify-phase-g.sql` both name non-admin UIDs explicitly.

- **`/dashboard/account` is unreachable for a company account that hasn't registered a company yet** — known, accepted, documented rather than fixed (decided 2026-08-06). The page sits under `src/app/dashboard/layout.tsx`, whose guard sends a member-less company account to `/company/apply`, so a brand-new company operator can't reach their own name/password form until their application exists. Not a lockout: `/auth/forgot-password` still changes the password, and the gap closes the moment they apply. Fixing it means either lifting the page to a top-level `/account` route or special-casing it inside the guard — don't do the latter casually, since every future `/dashboard` page then has to reason about the exception. (See [§1.6](#16-decided-leave-as-is).)

- **Rate limits are Postgres triggers, and `rate_events` is invisible to every client** (applied 2026-08-05, `supabase/schema.sql` §13). Three things not to break: (1) the chat guard is `AFTER INSERT … FOR EACH STATEMENT` — do **not** "simplify" it into an RLS `WITH CHECK` or a row trigger, because a per-row check reads a count of 0 for every row of a PostgREST array insert; (2) both trigger functions no-op when `auth.uid()` is null — that's what keeps waitlist promotion and service-role writes from being blocked, so keep the null guard if you edit them; (3) `invite_company_member` must **return** its "not found" answer, never `raise` — an exception rolls back the `rate_events` row that recorded the probe, and the limit silently counts nothing. `rate_events` has RLS on with zero policies *and* grants revoked, so it is unreachable from the client by design — don't add a policy to "let users see their limit". Testing note: 10 joins/hour/user is easy to trip while clicking around; the counter is only clearable from the SQL Editor.

- **`postcss.config.js` is the live PostCSS config — keep it.** The duplicate `postcss.config.mjs` was deleted 2026-08-12; it held Tailwind **v4** syntax (`@tailwindcss/postcss`) while this repo runs `tailwindcss ^3.4.17` + `autoprefixer`. `postcss-load-config` resolves `.js` first, which is the only reason styling ever worked. If a Tailwind v4 upgrade happens, the config must change in place — don't reintroduce a second file, since whichever one loses the resolution order is silently ignored.

- **`trg_initial_trek_message` was dropped 2026-07-02** (multi-tenant migration): it called `create_trek_initial_message()`, which inserts into a `trek_messages` table that doesn't exist, so every trek INSERT errored. Trek creation works now. The broken function is still in the DB (unused, kept per convention) — don't reattach it to a trigger.

- **`treks.participants_joined` is a denormalised counter** kept in sync by the `trek_participants_count_trigger`. As of follow-up #1 (2026-06-22) it counts **confirmed only** — matching `get_trek_participant_count()`. It's still trigger-maintained (recomputed on the next join/leave), so for guaranteed-fresh reads prefer the RPC.

- **No realtime subscriptions in chat.** ⚠️ *Outdated as of the realtime-chat work (commit `696c385`) — `src/app/messages/page.tsx` now uses `postgres_changes`/presence/typing. The trek-detail `Chat` component stub may still lack live updates; verify before relying on this note.*

- **`public_profiles` view is `security_definer`.** Supabase's advisor flags this as an error. It's intentional — it lets `full_name` and `avatar_url` be readable cross-user (for chat/reviews) without exposing PII from the `profiles` base table. Don't "fix" it by making the view `security_invoker`.

- **Storage buckets are `public: true` (CDN delivery) but object listing requires auth.** The SELECT RLS policies on `storage.objects` are scoped to `authenticated` to block anonymous enumeration of UUID-keyed paths. `getPublicUrl()` bypasses RLS entirely — it always works regardless of policy.

- **Two env vars only:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The `SUPABASE_SERVICE_ROLE_KEY` slot exists in `.env.local.example` but is unused in app code and must never reach the browser.

- **Password recovery uses the `token_hash` flow, not PKCE.** `resetPasswordForEmail()` (in `src/lib/auth.ts`) redirects to `/auth/reset-password`, whose page calls `supabase.auth.verifyOtp({ token_hash, type })`. This is deliberate — PKCE breaks when the reset email is opened on a different device than the one that requested it. It depends on two dashboard settings that are **not** in the repo: the Supabase "Reset Password" email template must link to `{{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery` (the default `{{ .ConfirmationURL }}` will NOT work), and `/auth/reset-password` must be in Authentication → URL Configuration → Redirect URLs. The old `src/auth/{callback,confirm}/route.ts` handlers were deleted (they sat outside `src/app/`, so App Router never registered them — dead code with a latent open-redirect).

- **`/admin` "owner contact" is the company's own `contact_*` fields, not the owner's account.** The detail page ([`src/app/admin/companies/[id]/page.tsx`](src/app/admin/companies/[id]/page.tsx)) shows `contact_email`/`contact_phone`/`website` from the `companies` row — the values entered at application time. It deliberately does **not** call `get_company_members`, because that RPC gates on `is_company_member(p_company_id)` and returns an empty set to a platform admin who isn't a member of that company. If you want the actual owner's account email/name in the admin view, that needs a new `is_platform_admin()`-gated RPC — don't try to reuse `get_company_members`.

- **`/admin` overview "Users" is counted from `public_profiles`, not `profiles`.** `getAdminOverview()` ([`src/lib/company.ts`](src/lib/company.ts)) counts users via the `public_profiles` view because `profiles` is own-row-only under RLS (a platform admin can't count rows they can't select), and there's no admin-count RPC. Same reason the audit trail on the company detail page renders `approved_by` as a **raw UUID** — it references `auth.users`, which isn't resolvable to an email/name without a new SECURITY DEFINER RPC. Both are intentional trade-offs to avoid adding schema; add an admin RPC if you later want real user totals or a human-readable "approved by".

- **A departure can't be deleted once anyone has ever joined it — including after everyone leaves.** `join_trek_and_chat` creates one `conversations` row per batch on the first join and nothing ever deletes it (`leaveTrek` clears only `conversation_participants` + `trek_participants`). The `company deletes empty batches` DELETE policy blocks a batch with participants *or* a chat conversation (`batch_has_participants` / `batch_has_conversation`, both SECURITY DEFINER — an inline subquery would be blind under the caller's RLS). `deleteBatch` ([`src/lib/company.ts`](src/lib/company.ts)) surfaces this as *"has bookings or chat history — archive the trek instead."* This is deliberate (no orphaned/lost chat); if you ever want owners to hard-delete a vacated departure, it needs a SECURITY DEFINER RPC that cascade-removes the conversation + messages transactionally — don't loosen the FK to `CASCADE` or the guard silently destroys chat history.

- **Company-scoped write policies have TWO status tiers — `is_company_member` alone in a write policy silently un-freezes a rejected tenant.** `is_company_writable()` = status `pending` OR `approved` (a pending applicant sets its company up while it waits); `is_approved_company_member()` = `approved` only, and it gates the **publishing** surfaces — treks, departures, `trek-images` storage. Plain `is_company_member` / `is_company_admin` now mean "is a member", *not* "may write": pair them with `is_company_writable()`, or use `is_approved_company_member()` for anything that reaches the public catalogue. The same split lives in the app as `isCompanyFrozen()` ([`src/lib/company.ts`](src/lib/company.ts)) — a rejected/suspended company sees the dashboard read-only. **SELECT is deliberately never gated by either** (`is_trek_visible` already handles read visibility, and staff plus existing bookers must keep reading a hidden trek), and neither are the `is_platform_admin()` arms — freezing must not lock out the role that un-freezes. Watch the storage half in particular: both company buckets are public, so a write policy left on bare membership lets a frozen company overwrite its logo/cover at the same CDN paths the storefront links to, with no `companies` row ever changing. Rules live in [`supabase/phases/phase-h-frozen-companies.sql`](supabase/phases/phase-h-frozen-companies.sql), folded into `schema.sql` §16; **applied + verified live 2026-08-08.**

- **The two Supabase browser clients do not share a session, and mixing them fails silently as "no rows".** `@supabase/ssr`'s `createBrowserClient` ([`src/utils/supabase/client.ts`](src/utils/supabase/client.ts)) keeps the session in **cookies** — that is what sign-in writes and what the proxy reads. The plain `createClient` singleton in [`src/lib/supabase.ts`](src/lib/supabase.ts) looks in **localStorage**, finds nothing, and runs every request as `anon`. Under RLS that is not an error: an own-rows-only SELECT just returns `[]`, so the UI renders its empty state and nothing reaches the console. This bit `useFavorites` ([`src/lib/queries.ts`](src/lib/queries.ts)) from 2026-06-20 (`33a202c`, which moved the page onto TanStack Query) to 2026-08-20 — `/favorites` showed "No Favorites Yet" while the rows sat in the table, because the hearts are written by `TrekDetailClient` on the *cookie* client and read back on the *localStorage* one. **Every client component uses the `utils/supabase` factory**; `src/lib/supabase.ts` is now only reachable from `opengraph-image.tsx` (server, anon reads by design) and its exported types. The tell for this class of bug is asymmetry — a write lands, the matching read comes back empty.

---

# §3 — Changelog (newest first)

Every entry below was previously crammed into a single `_Last updated:` paragraph.
Text is unchanged; only the structure is new. Most entries also have a row in §2.

## Two regressions: the card's Join skipped the date picker, `/favorites` read as anon  ·  2026-08-20

Both were long-standing regressions from unrelated refactors, and both were silent.

**Join Now bypassed the date modal.** `TrekCard` still rendered `ConfirmationModal`, but
`setIsModalOpen(true)` had no caller — `1138e55` (2025-11-29) replaced the modal-opening
handler with a direct `joinTrekBatchAndChat()` on `next_batch_date`, leaving
`handleConfirmJoin` unreachable dead code. Clicking Join booked the next departure outright,
with no date choice and no safety/rules consent, while `/trek/[id]` (identical modal, same
component) kept asking. `handleJoinTrek` now checks auth and fullness and opens the modal;
`handleConfirmJoin` does the join and owns the `joining` state. `next_batch_date` is not
dropped — it seeds the picker through a new optional `defaultDate` prop, so the common case
is still one extra click, not a date lookup. The prop ignores anything that isn't an ISO
date, because callers pass the literal string `'No upcoming dates'`.

**`/favorites` rendered "No Favorites Yet" with rows in the table.** `src/lib/queries.ts`
was the last client-side importer of the plain `src/lib/supabase.ts` singleton, whose session
lives in localStorage; sign-in writes the session to **cookies**, which only the
`@supabase/ssr` client reads. So every direct table query in that file ran as `anon`, and
`favorites` is `to authenticated using (auth.uid() = user_id)` — zero rows, no error. The
write path hid it: the hearts are toggled by `TrekDetailClient` on the cookie client, so
favouriting worked and only the read came back empty. (`FavCard`, which toggles through the
broken singleton, is not rendered anywhere — otherwise the insert would have failed loudly
and this would have been found in June.) `queries.ts` now builds its client from
`@/utils/supabase/client`. Verified over MCP first that the four favourited treks are
`is_active` under an `approved` company and pass `is_trek_visible()` — the RLS on `treks`
was never the cause. New Known Gotcha; `CLAUDE.md` no longer suggests the singleton for
client components.

## Explore's saved search no longer survives a sign-out  ·  2026-08-20

Searching "desert" on `/explore`, then signing out, left the term sitting in the search
box — and it was still there after the next sign-in. `sessionStorage` is scoped to the
**tab**, not the Supabase session, so the `explore-filters` key written for the
navigate-away-and-back case outlived the account that typed it.

`src/contexts/AuthContext.tsx` now removes the key on the `SIGNED_OUT` auth event; the key
itself moved to `src/lib/exploreFilters.ts` so both sides share one constant. Clearing on
the event rather than inside `signOut()` also covers a sign-out from another tab and a
session that simply expired. Restoring on return is untouched — leaving Explore for a trek
and coming back still lands on the same filters and page. Deliberately **not** cleared on
`SIGNED_IN`: that event also fires on token refresh and tab focus, which would wipe a
search mid-use. `npm run build` clean, `npm test` 124/124. No database change.

## Review of the gotcha audit — 5 follow-ups fixed  ·  2026-08-20

A review of the previous entry's diff before pushing it to `main` found that **one of its
eight fixes was itself broken**, plus four smaller things. All five are now fixed.
`npm run build` clean, `npm test` 124/124, `npm run lint` 0 errors (22-warning backlog
unchanged). No database change was needed.

1. **The `/profile/edit` fix would have failed every save with a cleared email.** Fix #5
   below stopped writing `''` by omitting the key from the payload — but the write was
   `.upsert()`, and **Postgres checks `NOT NULL` on the proposed tuple *before* it resolves
   `ON CONFLICT`**, so an omitted `not null` column raises `23502` even though the row
   exists and would only ever be UPDATEd. The whole save died — name, bio, avatar,
   emergency contact — behind the generic `Profile save error` toast. Confirmed against the
   real `profiles` DDL in PGlite: `.upsert()` without `email` errors, plain `update`
   succeeds with the stored address untouched.

   **The email field is now read-only** (decided 2026-08-20), which is what it should always
   have been: `profiles.email` is the identity anchor — `not null unique`, and what
   `invite_company_member()` resolves an invitee by — and writing it here never changed the
   real login address in `auth.users` anyway. The write is `.update(...).eq('id', user.id)`,
   `email` is gone from both the payload and `profileUpdateSchema`, and the now-vacuous
   `allows an empty email` test is repurposed as a happy-path parse. This was the only
   `.upsert()` in `src/`.

2. **The trek page reported on the wrong departure for repeat bookers.** Fix #2 below
   correctly stopped using `.maybeSingle()`, but took the earliest departure *overall* — so
   someone who walked this trek last year and has a new date booked saw the **completed**
   one, and **Leave** would have cancelled that instead of the upcoming trip. Now
   `pickCurrentBooking()` prefers the earliest departure on or after `localToday()`, falling
   back to the full set so a purely historic booking still shows as joined.

3. **`TEST.md` was one `git add -A` away from committing live production passwords.** It
   documents the three security-test accounts and states the password scheme in plain text;
   it was untracked but **not ignored**, and a history rewrite is the only undo. Added to
   `.gitignore`.

4. **Two dead branches removed.** The `P0001` check in `handleEditMessage` could never fire
   (`conversation_messages_rate_limit` is `after insert`, not `after insert or update`), and
   the ~30-line signed-out "Log in to apply" screen in `/company/apply` became unreachable
   the moment that route stopped being public — replaced with a bare `if (!user) return null;`
   guarding the session-expires-mid-page gap.

5. **`optionalDependencies: @rollup/rollup-linux-arm64-gnu` removed.** It looked like a
   lockfile repair but wasn't: `package-lock.json` already carried the entry and `npm ci`
   validates with *and* without it. Being Linux-ARM, npm skips it on macOS, on
   `ubuntu-latest` CI and on Vercel alike — every machine that builds this project.

**Left alone deliberately:** the middleware's `pathname === '/company'` clause. It matches no
route today (the build emits only `/company/[slug]` and `/company/apply`), but it costs one
clause and correctly admits a future `/company` index page.

## Lock `platform_admins` grants — migration `0003`  ·  2026-08-18

A Strix probe (Day 1 of `TEST.md`) flagged that an anonymous `select` on
`platform_admins` returned `[]` with `200` instead of a permission error. Root
cause: the table carried Supabase's default `GRANT ALL` to `anon`/`authenticated`,
so **RLS-with-zero-policies was the *only* barrier** — disable RLS once and an
anonymous caller could read the admin list and insert its own uid as an admin
(full privilege escalation). There is exactly **one** admin today
(`senjaliyameet8@gmail.com`), and no client path adds another — this closes the
last-resort hole rather than an active one.

`0003_lock-platform-admins-grants.sql` does `revoke all on public.platform_admins
from anon, authenticated`, mirroring what `rate_events` already had. Now the table
is defended by **both** the missing grant and RLS, and a client read returns a hard
permission error instead of an empty-array oracle. `acl.test.ts` updated to assert
the grant is gone (was asserting RLS behaviour only); `npm test` 124/124, `npm run
build` clean. **Applied and verified live 2026-08-18 10:08 UTC** — `platform_admins.relacl`
is `{postgres, service_role}` only; `anon`/`authenticated` hold no SELECT/INSERT; ledger
records `0003`.

## Gotcha audit — 8 app-side bugs fixed, no SQL needed  ·  2026-08-18

A pass over the whole app against this file, hunting broken flows and edge cases
rather than missing features. **Nothing needed a database change** — every finding
was client-side. `npm run build` clean, `npm test` 124/124, `npm run lint` 0
errors (the 22-warning backlog is unchanged).

Ordered by what a user actually loses:

1. **The invite consent gate could be skipped by a race** — [`/invites`](src/app/invites/page.tsx)
   derived `isTrekker` as `accountType === 'trekker'`, which reads **false while
   `useAccountType` is still in flight**. The Header caches `useMyInvites` for 60s,
   so the invite card renders before the account type resolves — and in that window
   the button said "Accept invitation", skipped the amber warning *and* the two-step
   confirm, and converted a trekker account **irreversibly** (platform-admin-only to
   undo) on one click. Unknown now falls on the cautious side (`accountType !== 'company'`)
   and the button is disabled until the answer is in. Same shape as the `Header`
   `showTrekkerNav` note, opposite safe default — see Known Gotchas.
2. **Two departures of the same trek broke the trek page.** Nothing stops booking
   several dates of one trek (`trek_participants` is unique on `(user_id, batch_id)`,
   not on the trek), but [`TrekDetailClient`](src/app/trek/[id]/TrekDetailClient.tsx)
   read the join status with `.maybeSingle()` — which **errors** on two rows and
   returns null. The second booking made the page show "Book This Trek" to someone
   already booked, with no Leave button, and `handleChat` answered *"Please join a
   trek batch to access chat."* Both now read all rows; the sidebar reports the
   earliest departure and Chat opens the one it is reporting on.
3. **Chat "Edit" was a no-op that could post a duplicate.** The composer's submit
   handler in [`/messages`](src/app/(trekker)/messages/page.tsx) was
   `editing ? (e) => { e.preventDefault(); /* edit logic */ } : handleSendMessage`,
   so clicking Send while editing did nothing at all — and Enter bypassed the branch
   entirely and **posted the edit as a new message**. Now saves through the existing
   `Edit own messages` policy, optimistic with rollback, matching `deleteMessage`.
4. **"Join Now" sent signed-out visitors to a 404.** [`TrekCard`](src/components/ui/TrekCard.tsx)
   pushed `/login`; the route is `/auth/login`.
5. **Clearing the email field wrote `''` over `profiles.email`** ([`/profile/edit`](src/app/(trekker)/profile/edit/page.tsx)).
   The column is `not null unique` and is what `invite_company_member()` resolves an
   invitee by — so this quietly made an account un-inviteable, and the *second*
   account to do it collided on the unique index. **The first attempt at this fix was
   itself broken and was replaced on 2026-08-20** — see the entry above; the field is
   now read-only and the column is never written from this form at all.
6. **The join date-picker's `min` was the UTC date** ([`ConfirmationModal`](src/components/ui/ConfirmationModal.tsx)).
   UTC is already tomorrow for timezones behind it late in the day (blocking the
   user's real today) and still yesterday for IST before 05:30 — and
   `join_trek_and_chat`'s one-day grace would have turned that into a real batch.
   Now uses the local calendar date via `localToday()`, which `batchSchema` already
   had for exactly this reason (now exported rather than duplicated), plus a `max`
   mirroring the RPC's +1-year cap so the picker can't offer a guaranteed rejection.
7. **`.single()` on the favourites lookup** in `TrekDetailClient` turned the *common*
   "not favourited" case into a PGRST116 error, and never reset the heart to unfilled.
   `maybeSingle()`.
8. **The avatar path took an unsanitised extension** off the user's filename
   (`/profile/edit`), the one upload call site of four not using `sanitizeFileName()`.
   RLS keys on the first path segment so nothing could escape the user's prefix, but
   a `/` in the extension sprays nested folders and strands the object.

**Left alone deliberately, all recorded in the audit report rather than fixed:**
`/review` is a static mock whose form fakes a success toast (wiring a real
submission is feature work and needs a product call on trek selection + the
join-gate); `/profile/edit` collects privacy, favourite terrains and an emergency
contact *relationship* that no `profiles` column can hold; "Remember me" on the
login form is inert; `/auth/reset-password` accepts any session, not only a
recovery one — which the middleware comment says is intentional.

## Dependency CVEs patched — the 2026-08-14 audit's top finding closed  ·  2026-08-17

`npm audit fix` applied. All 6 high-severity advisories in production dependencies
are gone: `next` 16.2.9 → 16.3.1, `postcss` 8.5.15 → 8.5.26, `sharp` → ≥0.35.0.
Everything resolved inside the existing semver ranges, so `package.json` did not
change — only the lockfile. `npm run build` passes; `npm test` green at 124/124.
One low-severity `esbuild` advisory remains, scoped to the dev server on Windows,
and is intentionally left. Detail in
[§2 Phase 0 — Security tail](#dependency-cves-patched--6-high-in-production-deps-shipped-2026-08-17).

Also corrected here: §1.0's old item 2 claimed "46 files are uncommitted". They were
committed in `525cb09`; the real exposure is that `a1` is **20 commits ahead of
`main`** and none of it is deployed. The row now says that instead.

## Testing + security audit — 7 dependency CVEs, RPC bodies untested  ·  2026-08-14

Full pass over the test setup and the security surface. Everything still open is
filed in §1 (backlog rows in §1.0, detail in §1.4 and §1.5); nothing was fixed, by
request. `npm run build` passes; `npm test` is green at 124/124.

**The suite caught schema drift mid-audit, and it was fixed mid-audit.** The first
run of this pass was red 1/58: anon could call `get_company_batch_participants` in
PGlite but not in production. Live was correct — `has_function_privilege('anon', …)`
was `false` on all 15 multi-tenant RPCs, read back over MCP — and `schema.sql` was
wrong, because it never revoked the **default PUBLIC grant** Postgres attaches at
`CREATE FUNCTION`; only `grant … to authenticated`, which does not remove it. The
2026-08-08 revokes had been applied to the database and never encoded in the
generated file, so the DB suite was building its Postgres from a *more permissive*
schema than the one running. Both the revokes and four new test files landed while
this audit was being written, so the finding is closed; the durable lesson is in
[Known Gotchas](#known-gotchas). Worth recording because this is the first time
the suite caught drift rather than a policy bug — the more valuable of the two
things it was built to do, and the one no amount of reading `schema.sql` finds.

**What the RLS tests structurally cannot reach: the definer RPC bodies.** 81 DB
tests now cover chat isolation, catalogue and profile writes, tenant boundaries
and EXECUTE grants — and `join_trek_and_chat()` is called by none of them. Two of
those files name it in comments as the real guard for booking and chat membership
while testing that *direct* inserts fail. A `SECURITY DEFINER` function bypasses
every policy the suite asserts, so its own `if not …` check is the only control
there. Filed as §1.4 item 1.

**Client-side security controls kept getting counted as controls.** Two of them:
`isPasswordPwned()` gates a call the browser then makes directly to GoTrue, so
`POST /auth/v1/signup` skips it — and the platform setting that *would* bind is
still disabled. And `.eslintrc.json` disables four rules that are in fact live at
error severity, because ESLint 9 reads `eslint.config.mjs` and ignores that file
entirely. Neither is exploitable; both are things the repo appears to say and does
not do. Generalised in [Known Gotchas](#known-gotchas): a check that runs in the
browser in front of a public API raises the floor and enforces nothing.

Also: `npm audit` surfaced 7 high-severity CVEs in *production* dependencies —
including an SSRF and an unauthenticated Server Function endpoint disclosure in
`next@16.2.9`, both of which apply to this deployment. One `npm audit fix`.

## Backlog audit — `/edits` deleted, `0002` split out, docs reconciled  ·  2026-08-14

Re-checked the five most recent backlog items against the repo, the live database
(read-only MCP) and the gating commands. Three were genuinely done and correctly
documented (chat hot-path indexes, security headers, RLS/tenant test suite). Two
were not, in ways worth recording because both are failure modes of *verification*
rather than of the work:

**`/edits` was still live.** Reported deleted three times, most recently while
auditing its own checkbox. It sat in a route group, so `ls src/app/edits` said
nothing was there while `npm run build` listed `ƒ /edits`. Deleted now, together
with its `robots.ts` disallow. Lint warnings 24 → 22. The generalised lesson is in
[Known Gotchas](#known-gotchas): for "does this route exist?", the build output is
the authority and the filesystem is not.

**`CODE_REVIEW.md` had been updated for one of the five.** §3.1 (indexes), §4.1
(headers) and §5.1 (tests) still carried unticked boxes; §5.1 still read "26 tests
exist … **zero** on RLS policies", three items stale, while 124 tests were passing.
`CONTEXT.md` still listed "no security headers". All reconciled, and §3.1 now
records the two places the review's suggested SQL was wrong — the redundant
`trek_batches` index that was correctly skipped, and the participants index that
shipped as `(user_id, conversation_id)`. Worth noting the shape of this: the work
was done and `FEATURES.md`/`DATABASE.md` were updated each time, so nothing was
undocumented — but the file whose job is to say *what remains* was the one left
behind, which is exactly the file a reader trusts to be current.

**`0002` split back out of `0001`.** See the correction in
[Real migrations](#real-migrations--schemasql-demoted-to-a-build-artifact-shipped-2026-08-13).
Recorded on production the same day (09:36:11+00) and read back over MCP, so the
ledger and the migrations folder now agree — which they had not since 2026-08-13.

Verified after: `npm run build` exit 0, `npm test` 124/124 (81 DB tests replaying
both migrations), `npm run lint` 0 errors / 22 warnings, `npm run db:schema`
regenerated from 2 migrations.

## Test setup documented — the guides claimed it didn't exist  ·  2026-08-13

`CLAUDE.md` asserted "There are **no automated tests** in this project", which had stopped being true: `vitest.config.ts` + `playwright.config.ts` are both committed, with 26 unit tests across 3 files and 2 Playwright smoke specs. The claim mattered because it told every reader the build was the only available check, so `npm test` — 1.4 seconds — was going unrun. `CLAUDE.md` now documents both runners, the actual (thin) coverage, and the two config traps: Vitest collects only `src/**/*.test.{ts,tsx}` and hard-excludes `e2e/**`, so a Playwright spec under `src/` gets collected by Vitest and fails on missing fixtures; and `test:e2e` has `reuseExistingServer`, so a dev server already on :3000 will serve the specs. `README.md` §Available Scripts gained the three missing commands. Both gating-check lines now say build **and** test.

- **`CONTEXT.md` carried a stale security warning that read as live.** Its tree flagged `src/app/test/` as "⚠️ dev/RLS test pages — routable in prod", while §10 of the same file recorded the pages as deleted 2026-08-08. The deletion is the true one: the directory is **untracked**, holds nothing but a gitignored `.DS_Store`, and `npm run build` emits no `/test` route. Warning removed. The empty local directory and the now-vestigial `src/app/test/**` entry in `eslint.config.mjs`'s ignore list were both left alone — harmless, and the ignore entry is documented in `CLAUDE.md`.

## Dead code removed — 371 lines + the `mood` enum  ·  2026-08-12

Deleted `src/lib/database.ts` (199 lines), `src/components/ui/Chat.tsx` (49), `src/components/ui/favcard2.tsx` (119), and the duplicate `postcss.config.mjs`. The unused `mood` enum was dropped from the live DB the same day — `drop type public.mood`, no `cascade`, after a `pg_attribute` check returned zero dependent columns. Verified over read-only MCP: `public` now holds exactly six enums (`account_type`, `company_role`, `company_status`, `difficulty`, `experience_level`, `gender`). `supabase/schema.sql` §2 and `DATABASE.md` §3 updated to match. Zero importers on all three modules, so the build could not break; verified with `npm run build` + `npm test` (26 passing) before and after. The ⚠️ `database.ts` warning in `CLAUDE.md` was removed with the file, along with its entries in `CONTEXT.md` and the §7 checkboxes in `CODE_REVIEW.md`. Checklist detail in [`CODE_REVIEW.md`](CODE_REVIEW.md) §7.

- **The postcss duplicate was the only item that could have broken the app, and the safe file was the non-obvious one.** The two configs contradicted rather than duplicated: `.js` had the Tailwind v3 setup matching the installed `tailwindcss ^3.4.17` + `autoprefixer`, `.mjs` had v4 syntax (`@tailwindcss/postcss`) for a package not in `package.json`. `postcss-load-config` resolves `.js` before `.mjs`, so the correct one was silently winning — deleting the `.js` would have stripped every style. Verified by grepping the built CSS for `--tw-` vars and `-webkit-` prefixes rather than trusting a green build, since a broken Tailwind config compiles fine and just renders unstyled. Recorded in [Known Gotchas](#known-gotchas).
- **`favcard2.tsx` was recorded as a "duplicate of `FavCard`" and was not one.** It was an abandoned alternate design, and it carried two defects: a link to `/treks/${id}` (the real route is `/trek/[id]`) and a favorites delete filtered only on `.eq('trek_id', id)` with no user predicate, relying entirely on RLS to stop it clearing that trek for every user. Dead since birth, so never a live bug — but the "duplicate" label would have made it look like a safe copy-paste source.
- **A route inside a route group is invisible to `ls src/app/<name>` — check the build output, not the filesystem.** `/edits` was reported as already deleted **three times** before it actually was (2026-08-14), because it sat at `src/app/(trekker)/edits/page.tsx` and `ls src/app/edits` reports nothing. The authority on whether a route exists is `npm run build`'s route list. Its `robots.ts` disallow was removed at the same time as the page — while a route is live, that entry is load-bearing: dropping it alone would expose a private page to crawlers.
- **The "3 ESLint errors" in the review notes were already fixed** by the uncommitted work described in the entry below; `npm run lint` reports 0 errors. Warnings went 25 → 24 here (deleting `favcard2.tsx` took an `no-img-element` with it), then → 22 when `/edits` went on 2026-08-14. Current split: 12× `no-img-element`, 10× `exhaustive-deps`.

## Security headers added — the app was serving none  ·  2026-08-12

[`next.config.mjs`](next.config.mjs) had no `headers()` block at all, so every response carried zero browser-side policy. Six headers now ship on `/:path*`; CSP is report-only pending [§1.5](#promote-csp-from-report-only-to-enforcing). Full detail in [Security headers](#security-headers). App code untouched — config only.

- **`Referrer-Policy` was the one real leak, not the CSP.** Without it, an outbound click sent the **full URL including query string** to the third party, and the recovery flow puts `token_hash` in the URL. The rest (`nosniff`, `X-Frame-Options: DENY`, HSTS without `preload`, `Permissions-Policy`) is defence-in-depth that costs nothing here — no `<iframe>` anywhere, and no code calls camera/mic/geolocation.
- **Be honest about the CSP: it does not stop XSS.** `script-src` keeps `'unsafe-inline'`, because Next emits inline hydration/flight scripts and `JsonLd` inlines JSON-LD; nonces would have to be minted in middleware, forcing every page dynamic and undoing the server-rendered SEO work from the last three commits. The value is `connect-src` — an injected script cannot ship the browser-held Supabase session off-origin — plus `base-uri`/`form-action`/`object-src`.
- **The allowed origins came from grepping source, and two would not have been guessed.** `wss://` on the Supabase host is a *separate* origin to `connect-src` from the `https://` REST calls, so realtime chat breaks without it. And `worker-src 'self' blob:` is load-bearing for `browser-image-compression` (`useWebWorker: true`) — which fails **silently**, falling back to the uncompressed original, so omitting it would surface weeks later as bloated uploads rather than an error. `next/font/google` self-hosts at build, so no Google Fonts origin is needed at all.
- **Follow-on: lint is back to 0 errors, and two edge functions stopped leaking error detail.** `npm run lint` had 3 errors, none of them from this change and none newly introduced — but they were miscounted at first: only **two** were `no-explicit-any` in the Deno edge functions, the third was `no-html-link-for-pages` in [`src/app/error.tsx`](src/app/error.tsx), app code. The `catch (error: any)` blocks in [`send-trek-notification`](supabase/functions/send-trek-notification/index.ts) and [`send-trek-leave-notification`](supabase/functions/send-trek-leave-notification/index.ts) were returning `error.message` **in the HTTP response body**, against the "log errors but don't expose detail" rule in `CLAUDE.md` — both now log the detail and return a generic `"Internal error"`, which removes the `any` and the leak in one edit. In `error.tsx` the `<a href="/">` is **kept** with a targeted disable and a why-comment: it is the escape hatch after `reset()` has already failed, so a full document load is wanted precisely because it discards the wedged client tree — the lint rule optimises for the normal case, which this is not.
- **`CLAUDE.md`'s ESLint section described a file that does not exist.** It documented rules as off in `.eslintrc.json`; the live config is [`eslint.config.mjs`](eslint.config.mjs) (flat, ESLint 9) extending `next/core-web-vitals` + `next/typescript` with **no rule overrides at all** — which is why `no-explicit-any` was erroring despite being documented as off. Corrected to describe the real config, with the 25-warning backlog (14 `no-img-element`, 11 `exhaustive-deps`) written down as known and non-blocking. `exhaustive-deps` was deliberately **left on**: the warnings flag real stale-closure risk, and silencing them to match a stale doc would have suppressed the signal on code not yet written.
- **A dev-only relaxation nearly shipped to production.** `'unsafe-eval'` was gated on `NODE_ENV !== 'production'`, which is `undefined` when the config loads — true in every phase. Caught by curling a real `next start`; fixed by branching on Next's `phase`. The first re-test *also* lied, because the stale server still held port 3000 and `next start` had exited with `EADDRINUSE`. Both traps are in [Known Gotchas](#known-gotchas).

## Chat hot-path indexes applied — `conversation_id` was unindexed  ·  2026-08-12

[`perf-chat-hot-path-indexes.sql`](supabase/phases/perf-chat-hot-path-indexes.sql) applied + verified. Four indexes and one duplicate dropped; no policy, function or app change. Full detail in [Chat hot-path indexes](#chat-hot-path-indexes-shipped).

- **The read path had no index.** `conversation_messages` held only its `(created_at, id)` pkey and the `(user_id, created_at desc)` index §13 added for the flood trigger — nothing led with `conversation_id`, which is the one column every chat read filters on. So each conversation open and each scroll-back page sequentially scanned the fastest-growing table here. New `(conversation_id, created_at desc)` serves the filter **and** the `order by … desc limit 30` from a single range scan.
- **The badge was the bigger surprise.** `conversation_participants` had two indexes and both led with `conversation_id`, so "which chats am I in?" — the *driving* side of `get_unread_counts()` — had none. That runs on **every page load**, not just `/messages`, so the new `(user_id, conversation_id)` index (covering, and it indexes the FK) reaches further than the messages screen alone.
- **A duplicate index was costing writes for nothing.** `conversation_participants` carried two byte-identical uniques on `(conversation_id, user_id)`, both maintained on every chat join. Dropping the Postgres-default-named one is safe because `on conflict` infers its arbiter from the column list, not a constraint name. [`fix-duplicate-participant-unique.sql`](supabase/phases/fix-duplicate-participant-unique.sql) had proposed exactly this on 2026-08-05 and was **never applied** — worth knowing that a written phase file is not evidence of an applied one.
- ⚠️ **`explain` still shows `Seq Scan`, and that is correct.** 59 rows in 2 heap pages — the planner is right to skip the index, and reading that as a broken index is the trap. `set local enable_seqscan = off` gives `Index Scan using conversation_messages_conv_created_idx` with the `conversation_id` `Index Cond` and **no Sort node**; the missing Sort is the real proof the column order is right, since a wrong order would still index-scan and then sort.
- **Two unindexed FKs left on purpose.** `companies.approved_by` and `company_invites.invited_by` — 4 rows each, platform-admin-only paths. They are what the unindexed-FK verify query returns now; that output is the expected steady state, not a backlog. Likewise `trek_batches.trek_id` needs nothing (already a unique's leading column) even though `CODE_REVIEW.md` item 6 suggests indexing it.

## Batch announcements verified behaviourally — forgery control run  ·  2026-08-12

Cleared item 2 of the §1.0 next-actions list. Phase I had been structurally verified since 2026-08-08 but never exercised as a real write; all six VERIFY blocks have now been run, the one that matters through the real client path. Full results in [Account types → 5](#5--batch-announcements-company--its-bookers).

- **The forgery control passed as a matched pair, over PostgREST.** Signed in as a real trekker, `is_announcement:true` → 403/`42501`; the same insert without the flag → 201 with `is_announcement:false`. The pair is the evidence: a refusal on its own is equally consistent with a missing grant or an unrelated policy, and the control half rules those out.
- **Two ways this run could have reported a working guard as broken, or vice versa.** The SQL Editor runs as the table owner with no `FORCE ROW LEVEL SECURITY`, so without `set local role authenticated` *both* halves succeed and the policy looks broken-open. And the frozen-company control had nothing to test against — every company in the DB is now `approved` — so it needs a rolled-back status flip made under a platform admin's `request.jwt.claims`, or `protect_company_admin_fields()` reverts it silently and the control passes for the wrong reason. That trigger has now cost three separate verification passes; it is in Known Gotchas.
- **One narrower-than-documented rule found, and tightened.** The RPC's *No one has booked this departure yet* guard tests whether a `conversations` row exists, and that row outlives everyone leaving — so a vacated departure accepted an announcement into an empty chat and returned success (10 of 17 batches were in that state). [`fix-announcement-requires-listeners.sql`](supabase/phases/fix-announcement-requires-listeners.sql) adds a participant check as a second branch with its own message; **applied + verified live the same day** (new branch and the original both in the live definition, `search_path` pinned, `anon`=false / `authenticated`=true — `create or replace` preserved the ACL — and the anon-executable definer count still 3). No app change: `postBatchAnnouncement` already surfaces P0001 text verbatim, and a client-side gate stays wrong because the roster includes waitlisted trekkers, who hold no chat seat. **Behavioural pair run the same day** — vacated departure refused, a departure with a member accepted, same caller, both rolled back. That closes the last DB item in the backlog.
- **Reference files caught up, closing debt open since 2026-08-08.** Phase I had been applied for four days without ever being folded in. Now: [`schema.sql`](supabase/schema.sql) **§17** (both RPCs in full, plus the DDL in place — the column at §2, the two tightened `with check` clauses at §8), [`DATABASE.md`](DATABASE.md) (the column, both RPCs in the §6 function table, the §8 RLS matrix row), and two [`security-fixes.sql`](supabase/security-fixes.sql) entries: the forgery gate and the empty-room fix. *A phase file is a proposal; `schema.sql` is what the next session reads.*

## Hardening applied; batch announcements built — account split complete  ·  2026-08-08

Cleared items 1–3 of the §1.0 next-actions list. Two SQL files applied by hand and verified live over read-only MCP, then the last open step of the trekker/company split was built.

- **Both pending SQL files applied.** `fix-anon-execute-definer-rpcs.sql`: anon-executable definer functions **21 → 3**, and no function in the revoke list lost its `authenticated` grant — the failure mode this file was written to avoid. `fix-drop-dead-increment-participants.sql`: `increment_participants` gone, `update_participants_count` still present with its trigger attached. The remaining 3 WARNs are the load-bearing trio and stay open by design (now a Known Gotcha, so the next "get it to zero" pass doesn't take the public site down).
- **Batch announcements (account split step 5).** An announcement is a flagged row in the batch's **existing** conversation rather than a new table — that reuses realtime delivery, `get_unread_counts()` and `mark_conversation_read()` untouched, so it lands where trekkers already look and lights the unread badge for free. Two SECURITY DEFINER RPCs, because the company user is never a `conversation_participant` and so can't even `SELECT` the row it just wrote.
- **The new column needed two policies tightened, not just a column.** `conversation_messages` INSERT was `user_id = auth.uid() AND is_chat_participant(...)` and said nothing about the new flag — so any trekker could `POST` with `is_announcement:true` (the publishable key is in the client bundle) and render a **forged operator notice** in their own trek's chat. Both INSERT and UPDATE `with check` now pin it to `false`; the definer RPC bypasses RLS and is the only writer that can set it.
- **Two things that came free, and one client-side check deliberately not written.** The existing AFTER STATEMENT rate-limit trigger reads `auth.uid()`, which inside a definer function is still the caller — so announcements are capped at the same 30/min as chat with no new code. And the composer has no "does this departure have bookings?" gate, because the real rule is "does a conversation exist?", which `join_trek_and_chat()` creates only for a **confirmed** participant: a waitlist-only departure has a non-empty roster and nowhere to post, so a `participants.length` check would have been quietly wrong.
- **`phase-i-batch-announcements.sql` applied the same day**, structurally verified live: column, both tightened `with check` clauses, all four policies intact after the drop/recreate, both RPCs definer + `search_path`-pinned + `authenticated`-only, and the anon lint still at 3. `npm run build` clean. **Not yet exercised as a real write** — the forgery control is the one that matters and is carried as §1.0 item 2.

## Verification debt cleared — phases F and H run as real DML  ·  2026-08-08

Both guard families were live and structurally verified but had never been exercised as writes by a real non-admin account. Run block by block from a write-capable SQL Editor session, every block rolled back, **all results as expected**. §1.1 removed; results recorded in §2 under "Account types → 1 — database enforcement" and "H — behavioural verification".

- **Phase F** — `is_trekker()` returns `f` for a company account and `t` for a trekker; `favorites` INSERT refused the company account **and accepted the trekker**; `join_trek_and_chat()` raised *Company accounts cannot join treks* for one and returned a normal payload for the other. Post-check clean.
- **Phase H** — the silent `UPDATE 0` refusals on `companies`/`treks`, the `trek_batches` INSERT error, `{"error":"company_frozen"}` from `invite_company_member()`, `suspended` behaving identically to `rejected`, the `accept_company_invite()` frozen branch **with a clean accept as its control**, a platform admin still writing to a suspended tenant and unfreezing it, and both public storage buckets refusing a frozen company's upload. Post-check clean.
- **Why the controls mattered.** Every negative was paired with the same statement run while writable. A refused write on its own is equally consistent with a missing grant, a unique violation or an unrelated policy — the pair is what makes it attributable to the guard under test. This is the same discipline the storage rate limit lacked when it shipped inert and passed every structural check.
- **Three template bugs surfaced only by running it**, all now fixed in the companions. (1) The phase-H template's freeze step is inert — `trg_protect_company_admin_fields` reverts a direct `status` update whenever `is_platform_admin()` is false, which it always is in the SQL Editor. (2) Its `<trek_id>` was unresolvable. (3) Mine: the SQL Editor shows only the last statement's result and a deliberate error aborts everything after it, so the first run returned one error and no controls. Phase H now ends every block in exactly one row-returning statement, with row counts surfaced through data-modifying CTEs.

## Security tail L4 + SEO structured data; two DB items written  ·  2026-08-08

Worked the §1.0 next-actions list. Two shipped in code, two written as SQL awaiting a manual apply, and the phase-H verification template turned out to be unrunnable as written.

- **L4 — `src/app/test/*` deleted.** All 16 files: 8 routable pages that were live in production, one non-routable `editprofiletest.tsx`, 6 `.html` design scratch files. Nothing imported from the directory. `/test` also dropped from `publicRoutes` and from the `robots.ts` disallow list. Build route table confirms they're gone.
- **JSON-LD + `/about` metadata** — the last SEO gap. See the SEO row in §2 for the Event-per-departure / Product-fallback design and the `</script>` escape.
- **`fix-anon-execute-definer-rpcs.sql` written, not applied.** Two things the backlog entry had wrong. **(1)** The count is **21**, not 20 — `is_company_writable` joined when phase H shipped. **(2)** "All are inert for `anon`" is false for three of them: `is_trek_visible`, `is_company_member` and `is_platform_admin` are called from PUBLIC-role SELECT policies on `treks`/`trek_batches`/`companies`, so every anonymous page view depends on them. A blanket revoke over the whole advisor list would have taken down `/explore`, `/trek/[id]` and `/company/[slug]`. The script revokes 18 and documents why the other 3 stay — and pairs every revoke with `grant … to authenticated`, since `revoke from public` also strips the role that inherits through it.
- **`fix-drop-dead-increment-participants.sql` written, not applied** (NEW-5). Confirmed no trigger references it and EXECUTE was already fully revoked.
- **`verify-phase-h.sql` written.** The template in `phase-h-frozen-companies.sql` freezes the company with a plain `update … set status='rejected'` run as the DB owner, which `trg_protect_company_admin_fields` silently reverts whenever `is_platform_admin()` is false — and it is false in the SQL Editor, where `auth.uid()` is null. Every "expect UPDATE 0" would have succeeded and been read as a broken guard. Its `<trek_id>` was also unresolvable: the non-admin company owner has no treks and the only company that has treks belongs to the platform admin. The companion freezes through `reject_company()`/`suspend_company()` under the admin's JWT, creates its own trek in-transaction (which doubles as the over-blocking control), and adds storage blocks the template never had. *Same lesson as the storage rate limit: a guard that never runs and a guard that works look identical — and so do a verification block that was run and one that only ever could have been.*
- **First run, and a third format bug — mine.** Both scripts returned exactly one error and nothing else, because the SQL Editor shows only the last statement's result and a deliberate error aborts the rest of a pasted file. Both errors were the *expected* refusals (phase F `favorites`, phase H `trek_batches`) — but every `-- expect: UPDATE 0` was invisible and no positive control ran. Phase H rewritten so each block ends in one row-returning statement, with row counts surfaced through data-modifying CTEs; both scripts now carry a "run one block at a time" header and a results log.

## Doc restructure — this file became readable  ·  2026-08-08

No code or schema change. `FEATURES.md` had grown to 107 KB in 189 lines and could not be read in a viewer or a terminal.

- **The `_Last updated:` line was 35,798 characters** — a single italic paragraph holding 20 changelog entries chained by `— Prior:`. Split into §3 below, one heading per entry, text unchanged.
- **Four table cells over 2,000 characters** (the longest 8,842) were expanded into per-row subsections with bulleted labels. The compact tables — Core, Phase 2, Phase 0, review follow-ups — were left as tables.
- **Three markdown bugs fixed, all of which broke rendering today.** Unescaped `|` inside cells split rows into phantom columns in two places (`'rain' | 'snow' | 'none'`, and `pending|accepted|declined|revoked`); a stray `|` in the storage rate-limit row opened a 4th column mid-cell; and a **blank line inside the Account types table** (between steps 2 and 3) ended the table early, so **steps 3 and 4 rendered as literal `| … |` text**.
- **One stale backlog entry corrected.** §1 still asked for `is_trek_visible()`'s participant arm to be run on the live DB. It has been live since 2026-08-04 — re-verified 2026-08-08 via read-only MCP (`pg_get_functiondef` contains the arm). This is the second time this file has reported that phase as pending while it was live; the first produced a false 🔴 critical in `CODE_REVIEW.md` §1.3.
- **Two open items that only existed inside §2 prose** were pulled into the backlog as §1.1 Verification debt: phase H's unrun blocks B/D/F, and the phase F verification run. *(Both run 2026-08-08; §1.1 removed and the results recorded in §2.)*
- Restructuring was done by script (`scratchpad/reformat.py`) rather than by hand, so no prose was retyped; a word-frequency diff confirms the only text that left the file is the 19 `— Prior:` separators and the headers of the expanded tables.

## Storage rate limit now reaches the user  ·  2026-08-08

the 6/hour upload cap was rejecting the 7th upload correctly, but storage-api answers a database error with a bare 500 and a `{}` body, so the trigger's message never reached the browser and the user was told "The image failed to upload. Please try again." — wrong advice, since retrying can't succeed for another hour. `uploadErrorMessage()` no longer tries to parse a message that isn't there: it now asks the DB via a new read-only `upload_rate_limited()` probe, and only after an upload has already failed with an unrecognised error. `storage_rate_rule()` keeps the bucket → (action, limit) mapping in one place so the enforcer and the reporter can't disagree. [`supabase/phases/fix-storage-rate-limit-message.sql`](supabase/phases/fix-storage-rate-limit-message.sql) applied + verified live; folded into `schema.sql` §13.4/§13.5, `security-fixes.sql`, `DATABASE.md`. Also stopped the four upload call sites logging the raw `StorageError` — it prints `{}` on this path, and Next 16's dev overlay renders every `console.error` as a red popup, so an expected rejection looked like two crashes.

## Frozen companies — rejected/suspended tenants go read-only

company status was consulted for **reads** only (`is_trek_visible` hides an unapproved catalogue) and for nothing else, so a company a platform admin had rejected or suspended kept full write access to its own tenant: invite staff, change roles, remove members, rewrite its public storefront copy, archive/restore treks, add and delete departures. Suspension hid the treks and changed nothing else. Two tiers now: **pending + approved = writable** (a pending applicant is meant to set up while it waits — the dashboard banner promises exactly that), **rejected + suspended = frozen** (every page still loads and the status banner still explains why, but nothing can be changed). Publishing — treks, departures, trek images — is **approved-only**, stricter than "writable": that was already the product rule in the UI (`/dashboard/treks/new` and the overview hid the create button behind `status === 'approved'`) but the comment claiming it was "enforced by the treks INSERT RLS policy" was **false** — the policy was `is_company_member(company_id)` with no status test, and the publishable key ships in the client bundle, so a direct `POST /rest/v1/treks` from a pending or suspended company's admin succeeded. The DB half is [`supabase/phases/phase-h-frozen-companies.sql`](supabase/phases/phase-h-frozen-companies.sql) *(was "not yet applied" when this entry was written — **applied + behaviourally verified 2026-08-08**, see §2)*: a new `is_company_writable()` composed with the existing membership helpers, `is_approved_company_member()` finally given callers after sitting orphaned since the multi-tenant migration, and the storage write policies moved to the same tiers — without those a frozen company could still overwrite the logo/cover at the **same public CDN paths the storefront already links to**, changing what the public sees without touching a `companies` row. The check that protects someone outside the company is in `accept_company_invite()`: invites issued while approved outlive the rejection as live rows, and accepting one converts a trekker's account irreversibly (platform-admin-only to undo, per phase G) in exchange for a seat on a tenant that can do nothing — so status is re-checked at **accept** time, after the invite lookup so a non-owner still gets "no longer valid" and learns nothing. Deliberately **not** gated: `revoke_company_invite` / `decline_company_invite` (de-escalating — revoking lets a frozen company clean up invites that are now unacceptable anyway), the `is_platform_admin()` arms (freezing must not lock out the role that un-freezes), and every participant-facing flow (`join_trek_and_chat` + the waitlist/count triggers are all SECURITY DEFINER, so no existing booking or chat on a suspended company's trek is touched). App side: `isCompanyFrozen()` in `src/lib/company.ts` mirrors the DB predicate; team hides invite/promote/remove behind `isAdmin && !frozen`, settings wraps the **form** in a `disabled` `<fieldset>` (wrapping the form rather than its contents disables every control inside — file pickers and Save included — without reshaping it), and the trek list/edit/departures pages gate their write controls on `approved` with a status-aware note. `npm run build` clean.

## Login account-type toggle

the login form was trekker-shaped while signup offered both kinds, so `AuthPanel` now mirrors signup: an "I'm signing in as" trekker/company segmented control, with the subheading + helper text switching per side. The control is a shared `AccountTypeToggle` extracted from the signup block, so the two rows can't drift. `handleLogin` routes on the pick (trekker → `/`, company → `/dashboard`) and rejects a mismatch instead of signing someone in somewhere they can't act — the company side requires `getMyAccountType() === 'company'` (the **column**, since only a company account has anything at `/dashboard`), the trekker side requires `isTrekker()` (the **predicate**, so platform admins keep both doors open); the toast is `No {trekker|company} account found with that email.` — deliberately **not** "that's a company account", which would let anyone holding the credentials probe which kind an email is registered as. **The check runs before any session is persisted**: `signIn()` was replaced by `signInAs()` in `src/lib/auth.ts`, which verifies the password against a throwaway `persistSession: false` client, checks the kind on that in-memory session, and only calls `setSession()` on the real cookie-backed client once it matches (a reject just `signOut({scope:'local'})`s the probe to revoke the refresh token). This replaced an earlier sign-in-then-`signOut()` version whose reject path depended on a network round trip succeeding — a flaky one left the user signed in as a kind the UI had just refused. Deliberately **not** a server-side login route: that would funnel every login through one egress IP and pool Supabase's per-IP credential rate limit across all users. `npm run build` clean, lint unchanged (3 pre-existing errors).

## Closeout — docs, advisors, two carried decisions

- no code or schema change; docs, advisors and one decision each on two carried gaps.
- **Advisors re-run**: 54 lints, **nothing new from steps 1–4**. The check that mattered — the four step-4 invite RPCs plus `is_trekker()` and `join_trek_and_chat()` are `authenticated`-only and **absent from the anon list**, so the new SECURITY DEFINER surface added no anonymous exposure; the 20 `anon_security_definer_function_executable` WARNs are the same pre-existing set (older RPCs kept their default PUBLIC grant because `create or replace` preserves the ACL), all inert for `anon`, enumerated in §1. Also 1 ERROR (`security_definer_view` on `public_profiles`, known), 29 `authenticated_security_definer_function_executable` WARNs (inherent — these RPCs are meant to be called by signed-in users), 2 INFO `rls_enabled_no_policy` on `platform_admins`/`rate_events` (**intentional** — RLS on with zero policies *and* revoked grants, i.e. unreachable by design; don't "fix" by adding a policy), leaked-password protection off, Postgres patch pending.
- **`CONTEXT.md` brought up to date** — it had never recorded the account split: new §1 paragraph (two disjoint account kinds, permanent, pinned), the `(trekker)` route group in the §3 tree with a note that the parentheses don't enter the URL, §4 rows re-labelled *trekkers only* + `/dashboard/account` + the reason `/company/apply` reads the raw column, §5 signup/routing, a new §6 "Account types — where each rule lives" table mapping the one predicate across DB/route/controls, and a refreshed §10 (fresh advisor table; stale "`platform_admins` empty" and "Phases C–E not built" corrected). **Two Known Gotchas added**: `is_trekker()` vs `account_type` deliberately disagree for platform admins — mirror the *column* when the DB rule reads the column (`apply_for_company`, `accept_company_invite`) and the *predicate* when it's an RLS gate (joins, favourites, the `(trekker)` guard); getting it backwards is silent and shows the wrong screen to exactly one class of user, which is what bit `/company/apply`. Its testing corollary is sharp: the main test account is **both** `account_type='company'` and a platform admin, so it passes every `is_trekker()` check and **cannot detect this class of bug** — hence the non-admin UIDs named explicitly in both verify files.
- **Decisions, both "leave it, document it"**: `/dashboard/account` stays unreachable pre-application (not a lockout — forgot-password works and the gap closes on apply; if fixed, lift it to a top-level `/account` rather than special-case the guard); `src/app/test/*` stays (still ❌ L4), with the note that `/test/trek/[id]` still renders a Join button the account-type work didn't touch — the DB refuses it, so broken-looking UI, not a bypass.
- **Step 1's behavioural block is still the one genuinely open item** *(✅ run 2026-08-08 — all blocks as expected, see §2)* and is now ready to run as [`supabase/phases/verify-phase-f.sql`](supabase/phases/verify-phase-f.sql): placeholders resolved to real non-admin UIDs, and each negative paired with a **positive control** — the same insert/call as a trekker, which must succeed — because a rejection alone doesn't prove `is_trekker()` caused it (a missing grant or a unique violation looks identical). Blocks C/C2 `disable trigger user` on `trek_participants` first: three live notification triggers there would send real email to a real address if the guard turned out to be inert, and rollback can't unsend it.

## Account types — trekker vs company (steps 1–4)

- **trekker and company are now separate account kinds**, steps 1–4 of 5.
- **Step 4 (invite → accept)** builds the consent step that never existed: `invite_company_member()` used to insert straight into `company_members` and answer "Teammate added", so bolting account conversion onto it would have let any company admin end a trekker's account by typing their email. It now writes a row to a new `company_invites` table, and `accept_company_invite()` — validating server-side that the invite is pending, unexpired and addressed to the caller's **own** `profiles.email` — flips `account_type` and creates the membership in one transaction. **A bypass found while building it is closed in the same phase**: the `company_members` INSERT policy checked `is_company_admin(company_id) and role='staff'` with **no constraint on `user_id`**, and the publishable key ships in the client bundle, so any company admin could POST `/rest/v1/company_members` with an arbitrary `user_id` and skip the RPC — today that adds an unwanted member, after step 4 it would convert a stranger's account with no invite and no consent, i.e. the consent gate would have been decorative. Policy dropped and INSERT revoked; the two SECURITY DEFINER RPCs are now the only write path (no app code inserted directly — checked before dropping). The pin from step 1 is extended, not worked around: a transaction-local GUC that `protect_profile_account_type()` honours and PostgREST cannot set. Conversion refuses while the invitee holds **any** participation (confirmed *or* waitlisted — `promote_waitlist_on_leave()` ignores `account_type`, so a waitlisted row can activate itself later) on a batch dated today or later. No token and no email delivery on purpose: the invitee must already have a Trekker account, so the invite is shown to them at `/invites` when they sign in.
- **Applied 2026-08-06** ([`supabase/phases/phase-g-invite-accept.sql`](supabase/phases/phase-g-invite-accept.sql)); `npm run build` clean; folded into `schema.sql` §15 (+ §14.3 in place) + `DATABASE.md` + `security-fixes.sql` + `CONTEXT.md`.
- **Structural verification via read-only MCP**: invites table with RLS and one SELECT policy, both partial indexes correct, `company_members` INSERT policy **and** grant both gone, all six functions definer with pinned `search_path`, the four new RPCs `authenticated`-only, pin trigger carrying the GUC branch.
- **Behaviourally verified the same day** — blocks A–F run from the SQL Editor against a non-admin company owner and a non-admin trekker, all rolled back, both post-checks clean: the direct `company_members` insert now fails with `42501 permission denied` (a grant denial, so a re-added policy alone cannot reopen it), accept converts and joins in one transaction, a plain profile PATCH is still pinned back (the GUC hatch did not leak — which incidentally proves step 1's pin at runtime, previously structural-only), and both confirmed **and waitlisted** upcoming bookings refuse conversion. Block F could not separate "the ownership check rejected them" from "RLS hid the invite from them", so **F2** was added and run: it captures the invite id while impersonating the admin and holds it across the identity switch, so RLS never filters it — the accept was still refused. Invite ids are not bearer tokens.
- **Step 3** closes the loop the first two steps opened: `AuthPanel` now has a permanent trekker/company choice at signup that flows through `signUp()` → `raw_user_meta_data.account_type` → `handle_new_user()`, so `apply_for_company()` has a population to serve again and the temporary "rejects everyone" state is over. Company signup deliberately does **not** collect company name/slug in the same step — email confirmation is on, so `signUp` returns no session and the RPC could not be called anyway; the details are collected at `/company/apply` after first sign-in, which the step-2 dashboard guard already routes to. Login now checks `isTrekker()` and sends company accounts to `/dashboard`. `/company/apply` shows a "this is a trekker account" explainer rather than a form that would fail on submit — gated on the new `getMyAccountType()`, **not** `isTrekker()`, because the two deliberately disagree for platform admins (`is_trekker()` exempts them; the RPC gates on the raw column) and the UI must mirror whichever rule the DB actually applies. New `/dashboard/account` gives company operators the name + password form they lost with `/profile/edit`; it is a separate route rather than a tab on `/dashboard/settings` because that page redirects staff away via `useRequireCompanyRole(['owner','admin'])`, and staff need a password form too. Known small gap: `/dashboard/account` is under the `/dashboard` layout, so a company account that hasn't registered a company yet is bounced to `/company/apply` before reaching it.
- **Step 1's runtime behaviour is still unverified** *(✅ verified 2026-08-08 — see §2)* — see below; the block is now filled in and ready as [`supabase/phases/verify-phase-f.sql`](supabase/phases/verify-phase-f.sql) but has not been reported as run. Until now there was one account model: every auth user was a full trekker and "being a company" was purely additive (a `company_members` row), so a company owner could join their own or a competitor's treks, favourite, enter batch chats and post reviews.
- **Step 1 (DB, applied 2026-08-06** — [`supabase/phases/phase-f-account-types.sql`](supabase/phases/phase-f-account-types.sql)**)**: `profiles.account_type` enum set at signup via `handle_new_user()` and pinned by `trg_protect_profile_account_type`; every restriction routes through `is_trekker() := account_type='trekker' OR is_platform_admin()` — `join_trek_and_chat()` raises, `trek_participants`/`favorites` INSERT policies require it, `apply_for_company()` inverts it. The pin is the load-bearing piece: `Users can update own profile` is a plain own-row UPDATE policy, so without it every rule is bypassed by one PATCH setting `account_type='trekker'`. **A trigger bug was caught pre-apply** — the first draft copied `protect_company_admin_fields`' `if not is_platform_admin()` shape, but `auth.uid()` is NULL in the SQL Editor, so that check evaluates FALSE there and the pin would have silently reverted the manual corrections it exists to allow; shipped version gates on `auth.uid() is not null` first, and no client can reach that branch because the UPDATE policy is `to authenticated`. Backfill: everyone in `company_members` → `company` (2 company / 2 trekker; platform admins **not** skipped — the data reflects reality and their exemption lives in `is_trekker()` as one rule instead of two half-rules). ⚠️ **Runtime behaviour is NOT verified**: the read-only MCP role cannot execute `is_trekker()` (permission denied — itself evidence the revoke works) and cannot `SET ROLE`, so it cannot impersonate a company account; structural + data checks all pass but, per the storage rate-limit lesson, those cannot distinguish a working guard from an inert one. Run the impersonation block at the bottom of the phase file from the SQL Editor against a **non-admin** company account before treating this as proven.
- **Step 2 (app)**: trekker pages moved into a `src/app/(trekker)/` route group behind a server guard calling the same `is_trekker()` RPC (URLs unchanged — route groups don't affect paths); `/dashboard` layout stops dead-ending trekkers at `/company/apply`, which now rejects them; `Header` splits into two navs; `TrekCard`/`TrekDetailClient` drop the Join/Book/favourite controls for company accounts while keeping them for signed-out visitors so the login prompt survives. Middleware deliberately untouched — it runs on every request and this matters on 6 routes. `npm run build` clean. ⚠️ **Do not deploy to `main` yet**: `apply_for_company()` now rejects everyone, because nothing sets `account_type='company'` at signup until the step-3 AuthPanel toggle lands. Steps 3–5 (company signup + account settings, invite→accept flow, batch announcements) tracked in §1.

## Rate limiting Phase 2, storage uploads

**now verified END TO END**, after shipping broken and passing every structural check anyway. The upload cap keyed off `auth.uid()`, which returns **NULL inside a trigger on `storage.objects`** on the storage-api path even though RLS policies on the same INSERT resolve it — so the guard fired, hit its null bail, and recorded nothing while `pg_trigger`/`pg_proc` reported it healthy. Two other bugs surfaced on the way: the `avatars`/`trek-reviews` **SELECT policies documented in `schema.sql` §9 did not exist on the live DB**, which broke uploads entirely (`.upload()` runs `INSERT … RETURNING *`, and RETURNING evaluates SELECT policies against the new row; public buckets hid it because display goes via CDN without RLS) — fixed by [`fix-missing-avatar-select-policies.sql`](supabase/phases/fix-missing-avatar-select-policies.sql); and a **fourth avatar upload path was missed** ([`src/app/profile/edit/page.tsx`](src/app/profile/edit/page.tsx)) because the grep for `storage.from(` was single-line and that call splits across lines — it uploaded raw files and printed `[object Object]` on failure, hiding the diagnosis. All three fixed and verified. Rate cap now identifies the user via `coalesce(new.owner, auth.uid())` ([`fix-storage-rate-limit-owner.sql`](supabase/phases/fix-storage-rate-limit-owner.sql)).

## Rate limiting Phase 2 — storage upload caps (original entry)

[`supabase/phases/rate-limiting-storage.sql`](supabase/phases/rate-limiting-storage.sql) closes the last uncapped write path. Every bucket had `file_size_limit = null` and `allowed_mime_types = null`, so the only ceiling was Supabase's global 50MB with no per-user cap at all, and `compressImage()` is client-side so it is skipped by calling the Storage API directly with the publishable key. **Two layers**: per-upload **3 MiB + jpeg/png/webp** on `avatars`/`trek-reviews`/`company-logos`/`trek-images` (3 MiB rather than tighter because `compressImage()` returns the *original* file when compression fails), plus **6 uploads/hour/user** — `trek-reviews` carved out at 20/hour because its form uploads N photos in one `Promise.all` and a legitimate 8-photo review would otherwise fail inside its own submit. The trigger is `AFTER INSERT **OR UPDATE**` on `storage.objects`: `avatars` upserts to the fixed path `{uid}.{ext}`, so after the first upload every avatar write is an UPDATE and an INSERT-only guard would have missed the worst path entirely; a `version` check keeps renames and metadata touches from consuming budget. Counted in `rate_events` because avatars are one row forever and review photos are user-deletable. Function lives in `public` — `postgres` holds `TRIGGER` on `storage.objects` but not `CREATE` on the `storage` schema. Client: `compressImage()` added to the avatar upload (the one path uploading raw files), new `src/lib/uploadErrors.ts` maps 413/415/rate-limit to actionable text. `npm run build` clean. `trek-profile` left uncapped on purpose (no client write path).

## Rate limiting Phase 1

- **applied + verified live 2026-08-05**: [`supabase/phases/rate-limiting.sql`](supabase/phases/rate-limiting.sql) puts every limit inside Postgres rather than a Route Handler, because the publishable key ships in the client bundle so anything enforced in Next.js is skipped by calling PostgREST directly. Three guards, each placed where the write actually lands: **chat flood** (30 msg/min) as an `AFTER INSERT … FOR EACH STATEMENT` trigger on `conversation_messages` — a per-row RLS `WITH CHECK` cannot see its own statement's siblings, so PostgREST's array insert would pass 1000 messages through a check reading 0 every time; **join/leave email amplification** (10/hr) as a row trigger on `trek_participants` — `notify_trek_participation()` fires on INSERT *and* DELETE so a cycle sends two real emails, `UNIQUE (user_id, batch_id)` does not help because leaving frees the slot, and the guard cannot live in `join_trek_and_chat()` since the `Users can join treks` policy permits a direct INSERT that skips the RPC; **invite enumeration** (20/hr) inside `invite_company_member()`, whose "no account found" branch had to change from `raise` to `return` — a raised exception rolls back the `rate_events` row recording the attempt, so every failed probe erased its own evidence and the limit counted nothing. New `rate_events` table is log-only and used *only* where evidence does not survive (a left trek, a failed lookup); chat counts its own rows instead, so it needs no storage. Table has RLS on with zero policies + grants revoked, so a user can neither read their counter nor delete it to reset a limit; `pg_cron` prunes hourly (job `prune-rate-events`, jobid 2). Verified against live constraints that `favorites`/`trek_reviews`/`company_members`/`trek_batches`/`companies` are already bounded by unique indexes and need nothing. Client side shipped: `src/lib/company.ts` reads the new `error` codes, `src/app/messages/page.tsx` rolls back the optimistic bubble and returns the text to the composer on rejection. `npm run build` clean.
- **Live verification (MCP):** `rate_events` exists with RLS on, 0 policies, and no SELECT for `anon`/`authenticated`; both triggers present with the right timing (STATEMENT on `conversation_messages`, ROW on `trek_participants`); both `enforce_*` functions present; `invite_company_member` replaced; cron job scheduled. Folded into `supabase/schema.sql` §13 + `supabase/security-fixes.sql` + `DATABASE.md`. Storage-upload limits were outstanding at this point and shipped as Phase 2 (above). ⚠️ The first apply attempt failed with `42P01 relation "public.conversation_messages" does not exist` — the SQL Editor tab was open on a **different Supabase project**, not a defect in the file; every Supabase project's DB is named `postgres` and the user is `postgres` in all of them, so nothing on screen distinguishes them. Diagnose with `select current_database(), current_user, to_regclass('public.conversation_messages'), (select count(*) from pg_tables where schemaname='public');` before suspecting the SQL.

## SEO — server rendering + per-page metadata

**the app now ships real HTML and real per-page metadata**: every route previously rendered client-side behind `'use client'` with a single `metadata` export in `layout.tsx`, so all 31 routes reported the same title/description and link-preview bots (WhatsApp/Slack/Facebook — none run JS) got an empty `<div>`. `/` and `/company/[slug]` are now server components; `/trek/[id]` and `/explore` are server pages wrapping client islands (`TrekDetailClient.tsx` / `ExploreClient.tsx`) that keep all interactivity. New `src/lib/server-queries.ts` holds the session-aware, React-`cache()`d server reads (RLS behaviour unchanged); new `src/lib/site.ts` + `metadataBase` + title template; `generateMetadata()` on trek + company (real title, fact-line description, cover photo as OG/Twitter image, canonical, `noindex` for unapproved companies); new `sitemap.ts`/`robots.ts`; missing rows now return a real 404 via `notFound()` + `src/app/not-found.tsx` instead of a soft 404. Also fixed a **crawler-blocking proxy bug**: `robots.txt`/`sitemap.xml` matched the `src/proxy.ts` matcher and, being session-less, were 307'd to `/auth/login` — now excluded. Dead hooks removed (`useFeaturedTreks`/`useStorefrontTreks`/`useCompany` + keys + `FeaturedTrek`). `npm run build` clean; verified by `curl` (per-trek `<title>`/`og:image`/`<h1>`, 18-URL sitemap, 404 on bogus id) and Playwright (0 hydration errors, 0 redundant client fetches). ⚠️ **`NEXT_PUBLIC_SITE_URL` must be set in Vercel** or canonical/OG URLs point at `localhost:3000`.

## Doc accuracy — two phase files mislabeled as pending

**two phase files were mislabeled as pending; both confirmed live via MCP**: `fix-companies-audit-column-exposure.sql` and `polish-participant-trek-visibility.sql` were recorded here and in their own file headers as "not yet applied", which produced a false 🔴 critical finding in `CODE_REVIEW.md` §1.3 (a "live PII leak" that had already been closed). Read-only MCP verification confirmed both applied — see the per-entry evidence below. Corrected here, in the `polish-…` file header (now a dated `✅ APPLIED` marker), and in `CODE_REVIEW.md` §1.3. **Rule going forward: a SQL file's own comment is not evidence of database state — verify against `pg_proc`/`relacl`/`attacl` before recording or reporting DB status.** No code or schema change.

## Bugfix — departure delete crashed on an orphan conversation

- **removing a departure no longer crashes with an opaque `Error deleting batch: {}`**: `deleteBatch` ([`src/lib/company.ts`](src/lib/company.ts)) hit a PostgREST FK violation (23503) — `join_trek_and_chat` creates one `conversations` row per batch on the first join and nothing ever deletes it, so a batch that was joined then fully vacated had zero participants (`batch_has_participants`=false → the delete policy PERMITTED it) but still owned a conversation, and the `conversations.batch_id` FK (NO ACTION) rejected the delete. Chosen rule: **block while any chat exists** (no data loss). Added SECURITY DEFINER `batch_has_conversation()` (definer is mandatory — `conversations` SELECT is `is_chat_participant`-only, so an inline subquery would be blind to a chat the deleting owner never joined) and required it false in the `company deletes empty batches` policy; `deleteBatch` now logs `error.code`/`error.message` and maps both the FK error and the RLS 0-row no-op to *"has bookings or chat history — archive the trek instead."* `npm run build` clean.
- **Applied to live DB 2026-07-15** (via [`supabase/phases/fix-batch-delete-orphan-conversation.sql`](supabase/phases/fix-batch-delete-orphan-conversation.sql); MCP was unauthorized this session so not independently re-verified). SQL also in `supabase/security-fixes.sql`; `supabase/schema.sql` §12.6 + `supabase/migration-multi-tenant.sql` + `DATABASE.md` synced; Known Gotcha added.

## Perf + data-minimization

- **departure lists no longer download every batch's contact-PII roster to compute a count**: `getTrekBatches` (`src/lib/company.ts`) fired `get_company_batch_participants` once per batch — each returning every participant's `full_name`/`phone_no`/`emergency_contact`/`emergency_no` — only to keep `.filter(status='confirmed').length`. Replaced with one PII-free RPC per trek, `get_trek_batch_confirmed_counts(p_trek_id)` (batch id + integer, same `is_company_member` re-check + empty-set-on-foreign pattern as the roster RPC). `npm run build` clean.
- **Applied + verified live 2026-07-04** (via MCP: company member → correct per-batch counts matching raw rows; non-member / anon / unknown trek → empty set). `supabase/schema.sql` §12 + `supabase/security-fixes.sql` + `DATABASE.md` synced. Also hardened `updateCompany`/`updateTrek`/`setTrekActive` to `.select('id')` and treat a 0-row RLS no-op as failure (no false save confirmation) — code-only, no SQL.

## Security — companies leaked audit UUIDs to the public

- **companies no longer leak audit UUIDs to the public**: the `view companies` RLS policy is row-level only, and `anon`/`authenticated` held a table-wide SELECT grant, so any client could `select=created_by,approved_by` on approved rows and cross-reference those UUIDs against the world-readable `public_profiles` to deanonymize each company's owner + every approving platform admin. The app-side `COMPANY_COLUMNS` allowlist gave no protection (client-controlled column selection). Fix: replaced the table SELECT grant with a **column-level SELECT grant** on non-sensitive columns only (audit cols excluded); the `/admin` dashboard reads the audit columns via two new SECURITY DEFINER, `is_platform_admin()`-gated RPCs `admin_list_companies`/`admin_get_company` (`src/lib/company.ts` `getAllCompanies`/`getAdminCompany` rewired; unused `ADMIN_COMPANY_COLUMNS` removed). `npm run build` clean.
- **Applied + verified live 2026-08-04** (via [`supabase/phases/fix-companies-audit-column-exposure.sql`](supabase/phases/fix-companies-audit-column-exposure.sql); MCP re-check: `has_table_privilege('anon','companies','SELECT')`=false, `created_by`/`approved_by`/`approved_at` `attacl`=null so unreadable by `anon`+`authenticated`, 12-col allowlist intact, both admin RPCs present as SECURITY DEFINER + `is_platform_admin()`-gated with `proacl={postgres,authenticated,service_role}`). SQL also in `supabase/security-fixes.sql`; `supabase/schema.sql` §12 + `DATABASE.md` synced.

## Fix — participants keep booking history after archive/suspension

- **participants keep their own booking history after archive/suspension**: the multi-tenant migration narrowed `treks`/`trek_batches` SELECT to `is_trek_visible()`, which lacked a participant arm — so once a trek was archived or its company suspended, the `trek_batches!inner->treks` joins in profile history/favorites (`src/lib/queries.ts`) silently dropped the row and the user's own booking vanished. Folded the participant arm (`caller has a trek_participants row on one of the trek's batches`) into `is_trek_visible()` in `supabase/migration-multi-tenant.sql` §3 **and** `supabase/schema.sql` (canonical), so a fresh apply can't miss it; `DATABASE.md` synced. Catalogue/storefront stay clean — `search_treks()` filters `active + approved` directly.
- **Applied + verified live 2026-08-04** (via [`supabase/phases/polish-participant-trek-visibility.sql`](supabase/phases/polish-participant-trek-visibility.sql); `pg_get_functiondef('public.is_trek_visible(uuid)')` matches the canonical 4-arm definition byte-for-byte).

## Bugfix — far-future departures were listed but unbookable

**far-future departures can no longer be listed-but-unbookable**: `batchSchema` (`src/lib/schemas.ts`) enforced only a lower bound (`>= localToday()`), so a company admin could create a departure >1 year out; it showed as bookable on the storefront/explore/trek detail but every join failed with a raw DB error, since `join_trek_and_chat` rejects `batch_date > current_date + interval '1 year'` (`supabase/schema.sql:348`). Added a matching `<= localMaxBatchDate()` (today + 1 year) upper bound. `npm run build` clean.

## Dashboard/admin polish

- **status-aware dashboard banner** — new `CompanyStatusBanner` in `src/components/admin/DashboardShell.tsx` (pending = amber "under review"; rejected = rose with the `rejection_reason` quoted + "Submit a new application" CTA → `/company/apply`; suspended = slate with reason + bookings-unaffected note) tracks the switcher's **active** company and replaces the server layout's one-size-fits-all amber banner (removed from `src/app/dashboard/layout.tsx`; redirects unchanged).
- **Company cover image UI** — `/dashboard/settings` now opens with a storefront-style brand header: cover banner (gradient placeholder → uploaded image) with the logo overlapping (`ring-4`), Change/Remove controls for both; covers upload to `company-logos/{company_id}/cover-…` and `coverImageUrl` is plumbed through `CompanyProfileInput`/`updateCompany` with the same `null`-remove/`undefined`-untouched semantics as the logo.
- **Admin detail** — "Owner contact" card renamed **Company contact** (it shows the company's `contact_*` fields), and the audit trail resolves `created_by`/`approved_by` to display names via `public_profiles` in `getAdminCompany` ("Applied … by X", "Actioned by X" — falls back to a shortened UUID).
- **batchSchema** — "today or later" now compares the user's local calendar date (`localToday()` in `src/lib/schemas.ts`), not the UTC date that rejected local-today for timezones behind UTC.
- **SQL applied + verified live 2026-08-04** — participants keep read access to treks they've booked after archive/suspension: [`supabase/phases/polish-participant-trek-visibility.sql`](supabase/phases/polish-participant-trek-visibility.sql) adds a participant arm to `is_trek_visible()`; catalogue/storefront stay clean (`search_treks` filters directly). `npm run build` clean.

## Security — company slug is now immutable

- company **slug is now immutable** for non-platform-admins: `protect_company_admin_fields()` pinned status/approval/`created_by` but not `slug`, so an owner/admin could `PATCH …?slug=…` directly via PostgREST; a freed UNIQUE slug could then be reclaimed by another application → old `/company/[slug]` links hijacked. Added `new.slug := old.slug` in the non-admin branch.
- **Applied + verified live 2026-07-03**: non-admin UPDATE silently pinned back to OLD (begin/update/select/rollback as postgres); platform admin still able to change slug (PostgREST PATCH). SQL in `supabase/security-fixes.sql`; `supabase/schema.sql` §12.5 + `DATABASE.md` synced.

## Bugfix — image removal now persists

image removal now persists: the **Remove** button on company logo (`src/app/dashboard/settings/page.tsx`) and trek cover (`src/components/admin/TrekForm.tsx`) previously only cleared the preview, so `logo_url`/`cover_image_url` were never nulled and the old image reappeared on reload. Both now send `null` (remove) vs `undefined` (untouched) based on whether the preview was cleared — the data layer (`updateCompany`/`trekRow` in `src/lib/company.ts`) already distinguished the two. `npm run build` clean.

## Nav entry points

`Header` now shows a **Dashboard** link to company members and an **Admin** link to platform admins — previously the multi-tenant pages were only reachable by typing the URL. New `isPlatformAdmin()` in `src/lib/company.ts` + `usePlatformAdmin` hook/`platformAdmin` query key in `src/lib/queries.ts`; links gated by `useMyCompanies`/`usePlatformAdmin` in both desktop + mobile nav. `npm run build` clean.

## Multi-tenant Phase E — public storefront

public `/company/[slug]` storefront (cover/logo/verified badge/description + its treks via `search_treks(p_company_id)`), "Organized by {company}" link on `/trek/[id]` (embeds `companies(name, slug)`), optional company label on `TrekCard` (wired in `/explore`). New `useStorefrontTreks` hook + `company_id`/`company_name`/`company_slug` on `SearchTrek`; no schema change (Phase A's `search_treks` already returns the fields). `npm run build` clean. All app-layer phases A–E now done
