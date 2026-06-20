# Trekker — Feature Status

Single source of truth for what's built and what's pending.

> **Maintenance rule:** Whenever a feature is added, changed, or completed, update
> this file in the same change. See the "Feature Tracking" section in `CLAUDE.md`.

Legend: ✅ Done · 🟡 Partial / in progress · ❌ Not started

_Last updated: 2026-06-20_

---

## Core (pre-existing)

| Feature | Status | Notes |
|---------|--------|-------|
| Auth (signup / login / forgot / reset) | ✅ | `token_hash` recovery flow (not PKCE) — see CLAUDE.md gotchas |
| Trek discovery / Explore | ✅ | See "Search & filters" below for the upgraded version |
| Trek detail (reviews, join/leave, favorite) | ✅ | `src/app/trek/[id]/page.tsx` |
| Join / leave trek | ✅ | Always via `joinTrekBatchAndChat()` / `leaveTrek()` → `join_trek_and_chat` RPC |
| Group chat | ✅ | Upgraded to realtime — see below |
| Reviews (submit + showcase) | ✅ | `src/app/review/`, photo uploads compressed |
| Favorites | ✅ | `src/app/favorites/` |
| Profile view + edit | ✅ | `src/app/profile/` |

---

## Phase 2 — Features

| Feature | Status | Evidence |
|---------|--------|----------|
| 🔥 Realtime chat | ✅ | commit `696c385`; `src/app/messages/page.tsx` — `postgres_changes`, presence, typing, unread badges |
| Search & filters on Explore | ✅ | DB: `search_treks()` + `fts` tsvector/GIN in `supabase/schema.sql` (filters/sort/pagination + total_count in one RPC); wired at `src/app/explore/page.tsx`, `src/components/ui/FilterSection.tsx` |
| Real ratings rollup | ✅ | DB: `get_trek_avg_rating()` in `supabase/schema.sql`; wired via `src/lib/utils.ts`, `src/components/ui/TrekCard.tsx` |
| Capacity + waitlist | ✅ | DB: `trek_participants.status` + `promote_waitlist_on_leave()` in `supabase/schema.sql` (per-batch capacity, FIFO promotion trigger); wired into `src/lib/joinTrek.ts` |
| Trekker profiles & gamification | ✅ | DB: `award_user_achievements()` + `get_user_profile()` in `supabase/schema.sql`; `src/lib/achievements.ts` (15 badges); wired at `src/app/profile/page.tsx`. Includes `src/components/ui/ItineraryView.tsx` |
| Notifications | ❌ | Edge functions exist (`supabase/functions/trek-email-notification`, `send-trek-notification`) but not wired; no in-app bell, no web push |
| Organizer / admin UI | ❌ | Treks still SQL-seeded; no create/edit UI, no role, no server layer |
| Maps | ❌ | `meeting_point` is text-only; no Mapbox |
| Payments | ❌ | `estimated_cost` is display-only; no Stripe, no server endpoint |

> ⚠️ DB changes are applied manually in the Supabase SQL editor (read-only MCP). There is no
> migrations folder — `supabase/schema.sql` is the consolidated source of truth for the DB state.
> Confirm the DDL is applied on the live DB before treating a DB-backed feature as live.

---

## Phase 1 — Engineering foundation

| Investment | Status | Notes |
|------------|--------|-------|
| One UI system (drop MUI / Emotion / Bootstrap) | ❌ | All three still in `package.json` |
| TanStack Query | ❌ | Still manual `fetch`/`useEffect` |
| Zod validation (shared client+server) | ❌ | Closes M4 |
| Toasts + error boundaries + Sentry | ❌ | ~48 `alert()` calls remain |
| Tests + CI (Vitest/RTL + Playwright + GH Actions) | ❌ | No automated tests |
| Server layer (Route Handlers / Server Actions + service-role server-side) | ❌ | Needed for notifications/admin/payments |

---

## Phase 0 — Security tail

| Item | Status | Notes |
|------|--------|-------|
| NEW-5 — delete dead `increment_participants` / `update_participants_count` | ❌ | Still in `supabase/schema.sql` |
| M2 — re-enable middleware guard | ✅ | Active in `src/utils/supabase/middleware.ts` (but `/test` still whitelisted) |
| M3 — build error-checking on | ✅ | No `ignoreBuildErrors`/`ignoreDuringBuilds`; `noEmit: true` |
| L4 — delete `src/app/test/*` | ❌ | ~7 routable pages remain, and `/test` is in the public allowlist |
| 3 dashboard advisor toggles | ❌ | Apply in Supabase dashboard |
