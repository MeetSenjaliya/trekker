# Trekker — Project Context

A detailed map of the whole project: stack, architecture, routes, components, data/auth/chat flows, configuration, and known issues. For the database specifically, see [DATABASE.md](DATABASE.md) (reference) and [supabase/schema.sql](supabase/schema.sql) (authoritative DDL + RLS).

> Snapshot date: 2026-06-13. Supabase project: `dtjmyqogeozrzzbdjokr`.

---

## 1. What it is

Trekker is a **Next.js (App Router) + Supabase** web app for discovering treks, booking a dated **batch**, joining the batch's **group chat**, and posting **reviews**. It's a client-heavy app that talks to Supabase directly with the **anon key**; security is enforced by Postgres **Row Level Security** and a few **SECURITY DEFINER** RPCs (see DATABASE.md). There is no custom backend server and no service-role key in the client.

---

## 2. Stack

| Area | Choice |
|---|---|
| Framework | Next.js `^16.0.10` (App Router, `output: 'standalone'`) |
| UI runtime | React `19` |
| Language | TypeScript `^5` (path alias `@/* → src/*`) |
| Backend | Supabase (`@supabase/supabase-js` `^2.51`, `@supabase/ssr` `^0.6` for cookie/session handling) |
| Styling | Tailwind CSS `^3.4`; some MUI (`@mui/material ^7`) + Emotion; Bootstrap present but barely used |
| Animation | Framer Motion `^12` |
| Icons | Lucide React `^0.525` |
| Images | `next/image` (remote patterns: Supabase Storage + `images.unsplash.com`); `browser-image-compression` for review-photo uploads |

Scripts: `dev` / `build` / `start` / `lint` (standard Next). Build no longer suppresses type/lint errors (commit "M3: enforce TS & ESLint errors at build").

---

## 3. Directory layout

```
src/
├── app/                      # App Router pages + route handlers
│   ├── page.tsx              # Home: hero + featured treks
│   ├── explore/              # Trek discovery (filters + pagination)
│   ├── about/                # Static info
│   ├── trek/[id]/            # Trek detail: stats, itinerary, reviews, join/leave, chat entry, favorite
│   ├── auth/
│   │   ├── login/  signup/  forgot-password/
│   ├── profile/              # Profile view (+ edit/)
│   ├── favorites/            # Saved treks
│   ├── messages/             # Group chat UI
│   ├── review/               # Reviews showcase + ReviewForm
│   ├── edits/                # Alt profile-edit page
│   └── test/                 # ⚠️ dev/RLS test pages — routable in prod (should be removed/guarded)
├── auth/
│   ├── callback/route.ts     # OAuth/magic-link callback (placeholder)
│   └── confirm/route.ts      # GET: email OTP verify via supabase.auth.verifyOtp()
├── components/
│   ├── layout/  Header.tsx, Footer.tsx
│   └── ui/      TrekCard, FavCard, favcard2, ReviewCard, ReviewForm, ConfirmationModal,
│                HeroSection, FilterSection, TrekPagination, Chat (stub), SnowEffect
├── contexts/AuthContext.tsx  # useAuth(): { user, session, loading, signOut }
├── lib/
│   ├── supabase.ts           # browser anon client singleton + TS interfaces
│   ├── auth.ts               # signUp/signIn/signOut/resetPassword/getCurrentUser/onAuthStateChange
│   ├── joinTrek.ts           # joinTrekBatchAndChat(), leaveTrek()  ← the REAL join path
│   ├── database.ts           # ⚠️ legacy/dead helpers (wrong tables/columns) — not used
│   └── utils.ts              # getParticipantCount() (RPC), getDisplayParticipantCount()
├── utils/
│   ├── imageCompression.ts   # compressImage(), sanitizeFileName()
│   └── supabase/
│       ├── client.ts         # createBrowserClient (@supabase/ssr)
│       ├── server.ts         # createServerClient (cookies via next/headers)
│       └── middleware.ts     # updateSession(): refresh session + route guard
├── types.ts                  # Trek, Favorite, TrekParticipant (UI-facing types)
└── proxy.ts                  # Next 16 middleware entry → updateSession()
```

There are **two** Supabase client styles in the repo: the plain singleton in `src/lib/supabase.ts` (used by most page components) and the `@supabase/ssr` factories in `src/utils/supabase/*` (used by middleware/route handlers). New server-side code should prefer the `utils/supabase` factories.

---

## 4. Routes

| Route | Access | Purpose |
|---|---|---|
| `/` | public | Home: hero + 3 featured treks (`treks` + `trek_batches`, counts via RPC) |
| `/explore` | public | Discovery: search/location/difficulty filters, 6/page (`FilterSection`, `TrekCard`, `TrekPagination`) |
| `/about` | public | Static page |
| `/trek/[id]` | public | Trek detail: hero, stats, itinerary, gear, reviews (`trek_reviews` + `public_profiles`), join/leave (`join_trek_and_chat`), favorite toggle |
| `/auth/login` `/auth/signup` `/auth/forgot-password` | public | Auth forms (`@/lib/auth`) |
| `/auth/callback` `/auth/confirm` | public | Route handlers (OAuth placeholder; OTP verify) |
| `/profile`, `/profile/edit`, `/edits` | **protected** | View/edit profile; avatar upload to `avatars` bucket |
| `/favorites` | **protected** | Saved treks (`favorites` ⋈ `treks`) |
| `/messages` | **protected** | Group chat (conversations/messages/participants + `public_profiles`) |
| `/review` | **protected** | Reviews showcase + submit |
| `/test/*` | public (⚠️) | Dev/RLS test pages — should be removed or guarded before prod |

Route protection is enforced server-side (see Auth below).

---

## 5. Auth flow

- **Client API:** `src/lib/auth.ts` wraps the anon client: `signUp(email, password, fullName)` passes `options.data.full_name`; `signIn` uses `signInWithPassword`; plus `signOut`, `resetPassword`, `getCurrentUser`, `onAuthStateChange`.
- **Profile creation is server-side.** The `profiles` row is created by the `handle_new_user()` trigger on `auth.users` (SECURITY DEFINER), **not** the browser — this works even with email confirmation on (no session yet). The old client-side insert was removed (NEW-2).
- **Email confirmation:** the link hits `src/auth/confirm/route.ts` → `supabase.auth.verifyOtp({ token_hash, type })` → redirect.
- **Session state (client):** `src/contexts/AuthContext.tsx` calls `getSession()` on mount and subscribes to `onAuthStateChange`; exposes `useAuth()`.
- **Session refresh + route guard (server):** `src/proxy.ts` (Next 16's `proxy` convention, replacing `middleware.ts`) delegates to `updateSession()` in `src/utils/supabase/middleware.ts`. It calls `supabase.auth.getUser()`, then **redirects unauthenticated users to `/auth/login`** for any path that isn't public. Public prefixes: `['/', '/explore', '/about', '/auth', '/trek', '/test']`. The redirect guard is **active** (this resolves the previously-disabled M2 item — but note `/test` is still public).

---

## 6. Core flows

### Join a trek (+ chat)
`src/lib/joinTrek.ts → joinTrekBatchAndChat(userId, trekId, trekTitle, date)` calls the RPC `join_trek_and_chat(p_user_id, p_trek_id, p_batch_date)`. The RPC (SECURITY DEFINER) atomically: upserts the `trek_batches` row, upserts the batch `conversation`, inserts the `trek_participants` row, and adds the user to `conversation_participants`. It derives the caller from `auth.uid()` and refuses `p_user_id` mismatches. Returns `{ batch_id, participant_id, conversation_id }`.

`leaveTrek(userId, batchId?, conversationId?)` deletes the user's `conversation_participants` then `trek_participants` rows. The DELETE fires the leave-notification webhook.

### Reviews
`ReviewForm` compresses up to 5 photos (`compressImage`, ≤1MB each) → uploads to the `trek-reviews` bucket under `{uid}/…` → inserts into `trek_reviews`. RLS requires the reviewer to have **joined the trek** (NEW-3) and enforces one review per (trek, user). `ReviewCard` renders author (via `public_profiles`), stars, comment, photo grid.

### Favorites
Heart toggles in `TrekCard`/`FavCard` insert/delete `favorites` rows (own-row RLS, unique per (user, trek)).

### Participant counts
`src/lib/utils.ts → getParticipantCount(trekId)` calls RPC `get_trek_participant_count(trek_uuid)` (counts across the trek's batches). `treks.participants_joined` is **not** a reliable source (its maintenance code is dead — see Known issues).

---

## 7. Chat / realtime

- Tables: `conversations` (one per batch), `conversation_participants`, `conversation_messages`.
- `/messages` lists the user's conversations and renders a thread. Messages are fetched in pages (newest first) and reversed for display; author names/avatars come from the `public_profiles` view.
- **Message features:** soft-delete (`is_deleted`), edit (`updated_at`), reply (`reply_to`), emoji reactions (`reactions` jsonb), with optimistic UI updates.
- **Realtime:** chat currently relies on fetch/optimistic updates — there is **no `supabase.channel(...)` subscription** for live inserts. (AuthContext does use realtime auth-state events.) Adding a per-conversation channel would make messages stream live.

---

## 8. Storage

| Bucket | Use | Path convention |
|---|---|---|
| `avatars` | profile pictures | `{uid}/file` or `{uid}.ext` (both accepted by RLS) |
| `trek-reviews` | review photos | `{uid}/file` |
| `trek-profile` | (unused; public, no policies) | — |

All buckets are public-read; writes are owner-scoped (M1 fix). See DATABASE.md §9 for the listing-advisor caveat.

---

## 9. Configuration & env

- **Env vars** (`.env.local`, see `.env.local.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. A `SUPABASE_SERVICE_ROLE_KEY` slot exists in the example but is **not used** in code (and must never reach the browser). `.env*` files are git-ignored (untracked since commit `4e180fa`).
- **`next.config.js`:** `output: 'standalone'`; image `remotePatterns` for the Supabase project host + Unsplash.
- **`tailwind.config.js`:** scans `src/app`, `src/components`, `src/pages`.
- **`tsconfig.json`:** strict, `@/*` alias.

---

## 10. Known issues & cleanup backlog

App-level:
- `src/lib/database.ts` is **dead/broken** (targets a non-existent `reviews` table, `trek_participants.trek_id`/`status`, and the missing `increment_participants` RPC). Safe to delete; nothing live imports it.
- `src/app/test/*` pages ship to production and are in the public route list — remove or guard.
- `src/components/ui/Chat.tsx` is a stub; `favcard2.tsx` looks like an unused variant.
- No app-level rate limiting / security headers; verbose `console.error(JSON.stringify(error))` can leak DB detail.

Database-level (see DATABASE.md §11 for detail): broken `trg_initial_trek_message` (insert into non-existent `trek_messages` ⇒ trek creation errors), dead `update_participants_count`, duplicate dead notification triggers, plus open advisors (security_definer_view on `public_profiles`, public-bucket listing, RPC-exposed SECURITY DEFINER functions, leaked-password protection off, Postgres patch pending).

Security history and the remaining hardening checklist live in [SECURITY_AUDIT_ISSUE.md](SECURITY_AUDIT_ISSUE.md); applied-fix SQL with rationale is in [supabase/security-fixes.sql](supabase/security-fixes.sql).

---

## 11. Where things live (quick index)

| I want to… | Look at |
|---|---|
| Change a table / policy | [supabase/schema.sql](supabase/schema.sql) (then apply + re-run advisors) |
| Understand the DB | [DATABASE.md](DATABASE.md) |
| Add/inspect a page | `src/app/<route>/page.tsx` |
| Touch auth | `src/lib/auth.ts`, `src/contexts/AuthContext.tsx`, `src/utils/supabase/middleware.ts`, `src/proxy.ts` |
| Touch join/leave | `src/lib/joinTrek.ts` + RPC `join_trek_and_chat` |
| Touch chat | `src/app/messages/page.tsx` + `conversation_*` tables |
| Touch uploads | `src/utils/imageCompression.ts`, `ReviewForm`, profile-edit pages |
| Security backlog | [SECURITY_AUDIT_ISSUE.md](SECURITY_AUDIT_ISSUE.md) |
