# Trekker — Feature Status

Single source of truth for what's built and what's pending.

> **Maintenance rule:** Whenever a feature is added, changed, or completed, update
> this file in the same change. See the "Feature Tracking" section in `CLAUDE.md`.
>
> **Layout:** the **top half (§1)** is the working backlog — features to add and
> changes still to make. The **bottom half (§2)** is the record of everything
> already shipped. Move a row down once it's done.

Legend: ✅ Done · 🟡 Partial / in progress · ❌ Not started

_Last updated: 2026-06-20 (Tests + CI shipped — Vitest/RTL unit tests, Playwright smoke, GitHub Actions)_

---

# §1 — To do (add / change / fix)

> ⚠️ DB changes are applied manually in the Supabase SQL editor (read-only MCP). There is no
> migrations folder — `supabase/schema.sql` is the consolidated source of truth for the DB state.
> Confirm the DDL is applied on the live DB before treating a DB-backed feature as live.

## Features to add

| Feature | Status | What's missing |
|---------|--------|----------------|
| Notifications | ❌ | Edge functions exist (`supabase/functions/trek-email-notification`, `send-trek-notification`) but not wired; no in-app bell, no web push |
| Organizer / admin UI | ❌ | Treks still SQL-seeded; no create/edit UI, no role, no server layer |
| Maps | ❌ | `meeting_point` is text-only; no Mapbox |
| Payments | ❌ | `estimated_cost` is display-only; no Stripe, no server endpoint |

## Partials to finish

| Feature | Status | Remaining work |
|---------|--------|----------------|
| Search & filters on Explore | 🟡 | Punctuation-only search returns whole catalog — see follow-up #3 |
| Capacity + waitlist | 🟡 | `participants_joined` counter counts waitlisted → inflated "current/max" on cards — see follow-up #1; per-batch `isFull` — see #4; tie-break waitlist position — see #5 |
| Trekker profiles & gamification | 🟡 | Badges/stats count waitlisted participations as joined/completed — see follow-up #2 |
| TanStack Query migration | 🟡 | Trek detail + profile still on manual `fetch`/`useEffect`; favorites mutations need optimistic update + `useFeaturedTreks` N+1 — see follow-up #6 |

## Phase 1 — Engineering foundation (remaining)

| Investment | Status | Notes |
|------------|--------|-------|
| Server layer (Route Handlers / Server Actions + service-role server-side) | ❌ | Needed for notifications/admin/payments |

## Phase 0 — Security tail (remaining)

| Item | Status | Notes |
|------|--------|-------|
| NEW-5 — delete dead `increment_participants` | ❌ | Still in `supabase/schema.sql`. NOTE: `update_participants_count()` is **not** dead — it backs the `participants_joined` counter read by Explore/Favorites (schema.sql:1078); keep + fix it per follow-up #1, don't delete |
| L4 — delete `src/app/test/*` | ❌ | ~7 routable pages remain, and `/test` is in the public allowlist |

## Review follow-ups (2026-06-20)

Open correctness/quality items surfaced by `/code-review` on the Phase 2 + TanStack
Query work. Not yet fixed — listed here so the affected ✅/🟡 rows below stay honest.

| # | Severity | Area | Issue → fix | Location |
|---|----------|------|-------------|----------|
| 1 | High | Capacity + waitlist | `update_participants_count()` counts **all** participants regardless of `status`, so `treks.participants_joined` includes waitlisted joiners and can exceed `max` ("12/10 joined" on Explore/Favorites cards), inconsistent with the confirmed-only `get_trek_participant_count()` on trek detail. **Fix:** add `and tp.status = 'confirmed'`. | `supabase/schema.sql:832` |
| 2 | Med | Gamification + stats | `award_user_achievements()` and `recompute_user_stats()` count waitlisted participations as joined/completed → badges (Trailblazer, distance, completions) and `treks_completed`/`total_distance_km` over-credit seats never actually held. **Fix:** filter `status = 'confirmed'` in both aggregations. | `supabase/schema.sql:655`, `:587` |
| 3 | Med | Search & filters | Punctuation-only search (e.g. `!!!`) sanitizes to empty → `v_tsquery` stays NULL → FTS filter skipped → entire catalog returned instead of none. **Fix:** when sanitized input is empty, return no matches (or skip search but not silently). | `supabase/schema.sql:507` (`search_treks`) |
| 4 | Low | Trek detail | `isFull` is computed trek-wide but capacity/waitlisting is per-batch, so the Book / Join-Waitlist button label can be wrong for the chosen batch (post-join alert still reports the true status). **Fix:** derive `isFull` from the target batch. | `src/app/trek/[id]/page.tsx:218` |
| 5 | Low | Waitlist position | `waitlist_position` uses `joined_at <= mine`; identical timestamps would yield duplicate positions. **Fix:** tie-break by `id`. | `supabase/schema.sql:403` |
| 6 | Low | TanStack Query | `useToggleFavorite`/`useRemoveFavorite` broadly invalidate `['favorites', userId]` with no optimistic update → one heart-click refetches every favorite-status query on the page and the heart only fills after the round-trip (regression vs old instant `setIsLiked`). `useFeaturedTreks` does an N+1 of 2 RPCs/trek (could reuse `search_treks` limit 3). | `src/lib/queries.ts:217`, `:84` |

---

# §2 — Done (shipped features & changes)

## Core (pre-existing)

| Feature | Status | Notes |
|---------|--------|-------|
| Auth (signup / login / forgot / reset) | ✅ | `token_hash` recovery flow (not PKCE) — see Known Gotchas below |
| Trek discovery / Explore | ✅ | See "Search & filters" below for the upgraded version |
| Trek detail (reviews, join/leave, favorite) | ✅ | `src/app/trek/[id]/page.tsx` |
| Join / leave trek | ✅ | Always via `joinTrekBatchAndChat()` / `leaveTrek()` → `join_trek_and_chat` RPC |
| Group chat | ✅ | Upgraded to realtime — see below |
| Reviews (submit + showcase) | ✅ | `src/app/review/`, photo uploads compressed |
| Favorites | ✅ | `src/app/favorites/` |
| Profile view + edit | ✅ | `src/app/profile/` |

## Phase 2 — Features (shipped)

| Feature | Status | Evidence |
|---------|--------|----------|
| 🔥 Realtime chat | ✅ | commit `696c385`; `src/app/messages/page.tsx` — `postgres_changes`, presence, typing, unread badges; `src/lib/chat.ts`. DB deps verified live 2026-06-20: `mark_conversation_read()` + `get_unread_counts()` RPCs, `conversation_participants.last_read_at`, and `conversation_messages` in the `supabase_realtime` publication all present |
| Real ratings rollup | ✅ | DB: `get_trek_avg_rating()` in `supabase/schema.sql`; wired via `src/lib/utils.ts`, `src/components/ui/TrekCard.tsx` |
| Search & filters on Explore | 🟡 | DB: `search_treks()` + `fts` tsvector/GIN in `supabase/schema.sql` (filters/sort/pagination + total_count in one RPC); wired at `src/app/explore/page.tsx`, `src/components/ui/FilterSection.tsx`. ⚠️ open item — see §1 follow-up #3 |
| Capacity + waitlist | 🟡 | DB: `trek_participants.status` + `promote_waitlist_on_leave()` in `supabase/schema.sql` (per-batch capacity, FIFO promotion trigger); wired into `src/lib/joinTrek.ts`. ⚠️ open items — see §1 follow-ups #1, #4, #5 |
| Trekker profiles & gamification | 🟡 | DB: `award_user_achievements()` + `get_user_profile()` in `supabase/schema.sql`; `src/lib/achievements.ts` (15 badges); wired at `src/app/profile/page.tsx`. Includes `src/components/ui/ItineraryView.tsx`. ⚠️ open item — see §1 follow-up #2 |

## Phase 1 — Engineering foundation (shipped)

| Investment | Status | Notes |
|------------|--------|-------|
| One UI system (drop MUI / Emotion / Bootstrap) | ✅ | All four removed from `package.json`; only Tailwind remains. Last MUI use (`TrekPagination`) rewritten in Tailwind + `lucide-react` (`src/components/ui/TrekPagination.tsx`) |
| Zod validation (shared client+server) | ✅ | Closes M4. Shared, framework-agnostic schemas in `src/lib/schemas.ts` (`zod ^4`): sign-up/in, forgot/reset password, profile update, chat message + `fieldErrors()` helper. Wired into all 4 auth pages (`src/app/auth/*`), both profile editors (`src/app/profile/edit/page.tsx`, `src/app/edits/page.tsx`), and chat send (`src/app/messages/page.tsx`). New-password min unified to 8 chars (was 6 on sign-up). Module is React/Next/Supabase-free so the future Server layer can reuse it server-side |
| TanStack Query | 🟡 | Provider `src/app/providers.tsx` (wired in `layout.tsx`); shared query-keys + hooks in `src/lib/queries.ts`. Migrated: home (`useFeaturedTreks`), explore (`useSearchTreks` — debounced filters + cached pagination), favorites (list + remove mutation), `FavCard` (status query + toggle mutation). Pending work tracked in §1 |
| Tests + CI (Vitest/RTL + Playwright + GH Actions) | ✅ | **Unit/component:** Vitest + jsdom + React Testing Library — `vitest.config.ts`, `vitest.setup.ts`; 26 tests across `src/lib/schemas.test.ts` (all Zod schemas + `fieldErrors`), `src/components/ui/TrekPagination.test.tsx`, `src/components/ui/ConfirmationModal.test.tsx`. **E2E:** Playwright — `playwright.config.ts` (webServer: dev locally / prod `npm run start` in CI), `e2e/smoke.spec.ts` (home + explore smoke). **CI:** `.github/workflows/ci.yml` — lint → unit tests → build, then a Playwright job; runs with dummy public Supabase env. Scripts: `npm run test` / `test:watch` / `test:e2e`. Test/config files excluded from the Next build type-check (`tsconfig.json`); test artifacts gitignored; Deno edge functions added to ESLint ignores (already excluded from the TS build) |
| Toasts + error boundaries + Sentry | ✅ | **Toasts:** `sonner` `<Toaster>` in `src/app/providers.tsx`; all 38 app-side `alert()` calls replaced with `toast.success/error/info` across treks, messages, auth, profile, edits, reviews, cards (8 `alert()`s in `src/app/test/*` left — pages slated for deletion, Phase 0 L4). **Error boundaries:** `src/app/error.tsx` + `src/app/global-error.tsx`, both report to Sentry via `captureException`. **Sentry:** `@sentry/nextjs` wired via `src/instrumentation.ts` (server/edge + `onRequestError`), `src/instrumentation-client.ts` (browser + router-transition tracing), and `withSentryConfig` in `next.config.js`. Inert until `NEXT_PUBLIC_SENTRY_DSN` is set; source-map upload gated on `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` (CI only). Env documented in `.env.local.example` |

## Phase 0 — Security tail (shipped)

| Item | Status | Notes |
|------|--------|-------|
| M2 — re-enable middleware guard | ✅ | Active in `src/utils/supabase/middleware.ts` (but `/test` still whitelisted) |
| M3 — build error-checking on | ✅ | No `ignoreBuildErrors`/`ignoreDuringBuilds`; `noEmit: true` |
| 3 open security advisors | ✅ | Resolved-by-design — no actionable dashboard toggle (`supabase/security-fixes.sql:376`). **(1)** `security_definer_view` on `public_profiles` is intentional (Known Gotcha — keep). **(2)** `auth_leaked_password_protection` toggle is Pro-only; enforced in app via `isPasswordPwned()` ([src/lib/auth.ts](src/lib/auth.ts), commit `65dfe82`). **(3)** `vulnerable_postgres_version` upgrade is Pro-only; acknowledged on free plan. Advisors keep flagging (1)+(2) since they only inspect the toggle, not the design/app-level mitigation. |

---

# Known Gotchas

Caveats, invariants, and "don't break this" notes. Some overlap with §1 backlog items (linked where they do); others document intentional designs that look like bugs — don't "fix" them.

- **`src/lib/database.ts` is dead.** It references a non-existent `reviews` table, `trek_participants.trek_id` (column doesn't exist), and the old `increment_participants` RPC. Nothing live imports it. Safe to delete eventually but don't touch it expecting it to work.

- **`trg_initial_trek_message` trigger is broken in prod.** It calls `create_trek_initial_message()` which inserts into a `trek_messages` table that doesn't exist. Creating a trek via the API currently errors because of this trigger. It's reproduced in `schema.sql` with a BUG comment — don't fix silently without telling the user.

- **`treks.participants_joined` is a denormalised counter** kept in sync by the `trek_participants_count_trigger`. Use `get_trek_participant_count()` RPC for reads if you need accuracy; don't trust the column in isolation. (See §1 follow-up #1 — it currently counts waitlisted participants.)

- **`src/app/test/*` pages are publicly routable in production.** They're included in the middleware public-path allowlist. Should be removed or guarded before any public launch. (See §1 Phase 0 item L4.)

- **No realtime subscriptions in chat.** ⚠️ *Outdated as of the realtime-chat work (commit `696c385`) — `src/app/messages/page.tsx` now uses `postgres_changes`/presence/typing. The trek-detail `Chat` component stub may still lack live updates; verify before relying on this note.*

- **`public_profiles` view is `security_definer`.** Supabase's advisor flags this as an error. It's intentional — it lets `full_name` and `avatar_url` be readable cross-user (for chat/reviews) without exposing PII from the `profiles` base table. Don't "fix" it by making the view `security_invoker`.

- **Storage buckets are `public: true` (CDN delivery) but object listing requires auth.** The SELECT RLS policies on `storage.objects` are scoped to `authenticated` to block anonymous enumeration of UUID-keyed paths. `getPublicUrl()` bypasses RLS entirely — it always works regardless of policy.

- **Two env vars only:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The `SUPABASE_SERVICE_ROLE_KEY` slot exists in `.env.local.example` but is unused in app code and must never reach the browser.

- **Password recovery uses the `token_hash` flow, not PKCE.** `resetPasswordForEmail()` (in `src/lib/auth.ts`) redirects to `/auth/reset-password`, whose page calls `supabase.auth.verifyOtp({ token_hash, type })`. This is deliberate — PKCE breaks when the reset email is opened on a different device than the one that requested it. It depends on two dashboard settings that are **not** in the repo: the Supabase "Reset Password" email template must link to `{{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery` (the default `{{ .ConfirmationURL }}` will NOT work), and `/auth/reset-password` must be in Authentication → URL Configuration → Redirect URLs. The old `src/auth/{callback,confirm}/route.ts` handlers were deleted (they sat outside `src/app/`, so App Router never registered them — dead code with a latent open-redirect).
