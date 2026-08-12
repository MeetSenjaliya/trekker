# Trekker — Project Context

A detailed map of the whole project: stack, architecture, routes, components, data/auth/chat flows, configuration, and known issues. For the database specifically, see [DATABASE.md](DATABASE.md) (reference) and [supabase/schema.sql](supabase/schema.sql) (authoritative DDL + RLS).

> Snapshot date: 2026-06-13; multi-tenant changes folded in 2026-07-02; **account types + `(trekker)` route group folded in 2026-08-06**. Supabase project: `dtjmyqogeozrzzbdjokr`.

---

## 1. What it is

Trekker is a **Next.js (App Router) + Supabase** web app for discovering treks, booking a dated **batch**, joining the batch's **group chat**, and posting **reviews**. It's a client-heavy app that talks to Supabase directly with the **anon key**; security is enforced by Postgres **Row Level Security** and a few **SECURITY DEFINER** RPCs (see DATABASE.md). There is no custom backend server and no service-role key in the client.

Since 2026-07-02 it is a **multi-tenant marketplace**: independent trek **companies** apply self-serve (`/company/apply` → `apply_for_company()` RPC, lands `pending`), get approved by a manually-appointed **platform admin**, and own their treks (`treks.company_id`, soft-delete via `is_active`). Full design: [MULTI_TENANT_PLAN.md](MULTI_TENANT_PLAN.md). Phases A–E are all built: DB (A), application flow + guard layouts (B), `/dashboard` pages + team RPCs (C), `/admin` platform panel (D), public `/company/[slug]` storefronts (E).

**Since 2026-08-06 there are two kinds of account, and this is the single most structural thing to know about the app.** `profiles.account_type` is an enum, `'trekker' | 'company'`, NOT NULL default `'trekker'`, chosen at signup and **permanent** — a database trigger pins it, so there is no switch-later path and no client can PATCH its way across. Before this, every auth user was a full trekker and "being a company" was purely additive (a `company_members` row), which meant a company owner could book their own or a competitor's treks, favourite, sit in batch chats and post reviews. Now the two are disjoint: **trekkers** browse, book, favourite, chat and review but can never reach `/dashboard`; **company accounts** run a storefront but can never join a trek. Every restriction routes through one predicate, `is_trekker()`, used identically by the RLS policies and by the app's route guard — see §5 and §6. Only exception: **platform admins are exempt** inside `is_trekker()` whatever their column says (see the gotcha in FEATURES.md — the exemption makes `is_trekker()` and the raw `account_type` column deliberately disagree, and picking the wrong one silently shows the wrong screen to admins).

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
│   ├── (trekker)/            # ROUTE GROUP — trekker-only pages behind one server guard.
│   │   ├── layout.tsx        #   calls is_trekker(); company accounts → /dashboard
│   │   ├── profile/          #   Profile view (+ edit/)
│   │   ├── favorites/        #   Saved treks
│   │   ├── messages/         #   Group chat UI
│   │   ├── review/           #   Reviews showcase + ReviewForm
│   │   └── edits/            #   Alt profile-edit page
│   │                         # NB: parentheses = grouping only. URLs are still
│   │                         # /profile, /favorites, … — the group is NOT in the path.
│   ├── invites/              # Team invitations addressed to you — deliberately OUTSIDE (trekker)
│   ├── company/apply/        # Company application form (public page, RPC enforces auth)
│   ├── dashboard/            # Company operator area (Phase C). Guard: company membership
│   │   ├── layout.tsx        #   no membership → trekker: /  |  company: /company/apply
│   │   └── account/          #   operator's own name + password (⚠️ see §10 reachability gap)
│   ├── admin/                # Platform admin panel (Phase D). Guard: is_platform_admin() else /
│   └── test/                 # ⚠️ dev/RLS test pages — routable in prod (should be removed/guarded)
├── auth/
│   ├── callback/route.ts     # OAuth/magic-link callback (placeholder)
│   └── confirm/route.ts      # GET: email OTP verify via supabase.auth.verifyOtp()
├── components/
│   ├── layout/  Header.tsx, Footer.tsx
│   └── ui/      TrekCard, FavCard, ReviewCard, ReviewForm, ConfirmationModal,
│                HeroSection, FilterSection, TrekPagination, SnowEffect
├── contexts/AuthContext.tsx  # useAuth(): { user, session, loading, signOut }
├── lib/
│   ├── supabase.ts           # browser anon client singleton + TS interfaces
│   ├── auth.ts               # signUp/signIn/signOut/resetPassword/getCurrentUser/onAuthStateChange
│   ├── joinTrek.ts           # joinTrekBatchAndChat(), leaveTrek()  ← the REAL join path
│   ├── company.ts            # applyForCompany() (→ apply_for_company RPC), getMyCompanies(), getCompany(slug)
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
| `/` | public | Home: hero + 3 featured treks (`search_treks` RPC). **Server component** |
| `/explore` | public | Discovery: search/location/difficulty filters, 6/page (`FilterSection`, `TrekCard`, `TrekPagination`). **Server page renders page 1**, then `ExploreClient.tsx` takes over |
| `/about` | public | Static page |
| `/trek/[id]` | public | Trek detail: hero, stats, itinerary, gear, reviews (`trek_reviews` + `public_profiles`), join/leave (`join_trek_and_chat`), favorite toggle. **Server page + `generateMetadata()`**; interactivity in `TrekDetailClient.tsx` |
| `/company/[slug]` | public | Company storefront + its treks. **Server component + `generateMetadata()`** |
| `/sitemap.xml` `/robots.txt` | public | Generated by `src/app/sitemap.ts` / `robots.ts`. Excluded from the `src/proxy.ts` matcher — they carry no session, so the auth guard would redirect crawlers to `/auth/login` |
| `/auth/login` `/auth/signup` `/auth/forgot-password` | public | Auth forms (`@/lib/auth`) |
| `/auth/callback` `/auth/confirm` | public | Route handlers (OAuth placeholder; OTP verify) |
| `/profile`, `/profile/edit` | **trekkers only** | View/edit profile; avatar upload to `avatars` bucket (path `{uid}/{ts}.{ext}`). **`/profile/edit` is the real editor** |
| `/edits` | **trekkers only** | Duplicate profile editor, **unused** — nothing links to it (only the `robots.ts` disallow references it). Uploads avatars to the fixed path `{uid}.{ext}` with `upsert:true`. Slated for deletion (CODE_REVIEW.md §7) |
| `/favorites` | **trekkers only** | Saved treks (`favorites` ⋈ `treks`) |
| `/messages` | **trekkers only** | Group chat (conversations/messages/participants + `public_profiles`) |
| `/review` | **trekkers only** | Reviews showcase + submit |

The five rows above all live in the `src/app/(trekker)/` **route group** and share one guard, [`src/app/(trekker)/layout.tsx`](src/app/(trekker)/layout.tsx): a server component that calls the **same `is_trekker()` RPC the RLS policies call**, and redirects company accounts to `/dashboard`. Using one predicate on both sides is the point — the UI cannot end up offering something the database will refuse. Route-group parentheses affect nothing in the URL, so all five paths are unchanged; this was a pure move. The guard is deliberately **not** in `src/proxy.ts`: middleware runs on every request and this matters on six routes.
| `/company/apply` | public | Company application form; prompts login client-side (`useAuth()`), the RPC itself requires auth. **Shows a "this is a trekker account" explainer instead of the form** when the caller isn't a company account — gated on `getMyAccountType()` (the raw column), **not** `is_trekker()`, because the two disagree for platform admins and the UI must mirror whichever rule `apply_for_company()` actually applies |
| `/dashboard/*` | **company accounts with a membership** | Operator area (Phase C). Guard redirects members-without-a-company by account kind: trekker → `/`, company → `/company/apply`. Banners non-approved companies via `CompanyStatusBanner`; a **rejected/suspended** company gets the whole area read-only (`isCompanyFrozen()`) rather than a redirect — the pages and the banner explaining why are the point |
| `/dashboard/account` | **company members** | Operator's own account: display name + password change, email read-only. Separate route rather than a `/dashboard/settings` tab because that page is `useRequireCompanyRole(['owner','admin'])`-gated and bounces staff, who need a password form too. ⚠️ Not reachable before the company exists — see §10 |
| `/admin/*` | **protected + platform admins only** | Platform panel (Phase D): company approve/reject/suspend. Guard = `is_platform_admin()` RPC else `/` |
| `/invites` | **protected** | Team invitations addressed to the signed-in user (`get_my_invites`), accept/decline. **Deliberately NOT in the `(trekker)` route group** — the invitee is a trekker before accepting and a company account after, so that group's `is_trekker()` guard would bounce them mid-flow. Reached from the Header's "Invitations (n)" entry, shown only when there is one |

Route protection is enforced server-side (see Auth below).

---

## 5. Auth flow

- **Client API:** `src/lib/auth.ts` wraps the anon client: `signUp(email, password, fullName, accountType)` passes `options.data.full_name` **and `options.data.account_type`**; `signIn` uses `signInWithPassword`; plus `signOut`, `resetPassword`, `updatePassword`, `getCurrentUser`, `onAuthStateChange`.
- **Account kind is chosen at signup and is permanent.** `AuthPanel` has a trekker/company segmented control; the value rides `raw_user_meta_data.account_type` into `handle_new_user()`, which stamps `profiles.account_type`, and `trg_protect_profile_account_type` pins it from there on. There is no switch-later path in the UI **by design** — the pin is what makes every downstream rule meaningful, since `Users can update own profile` is a plain own-row UPDATE policy and without the pin one PATCH would undo all of it. The single sanctioned exception is `accept_company_invite()` (§6), which opens the pin through a transaction-local GUC no client can set.
- **Company signup deliberately does not collect company name/slug in the same step.** Email confirmation is on, so `signUp` returns no session and `apply_for_company()` could not be called there anyway; the details are collected at `/company/apply` after first sign-in, which the `/dashboard` guard already routes new company accounts to.
- **Post-login routing** (`handleLogin`) calls `isTrekker()` and sends company accounts to `/dashboard`, trekkers to the normal destination.
- **Profile creation is server-side.** The `profiles` row is created by the `handle_new_user()` trigger on `auth.users` (SECURITY DEFINER), **not** the browser — this works even with email confirmation on (no session yet). The old client-side insert was removed (NEW-2).
- **Email confirmation:** the link hits `src/auth/confirm/route.ts` → `supabase.auth.verifyOtp({ token_hash, type })` → redirect.
- **Session state (client):** `src/contexts/AuthContext.tsx` calls `getSession()` on mount and subscribes to `onAuthStateChange`; exposes `useAuth()`.
- **Session refresh + route guard (server):** `src/proxy.ts` (Next 16's `proxy` convention, replacing `middleware.ts`) delegates to `updateSession()` in `src/utils/supabase/middleware.ts`. It calls `supabase.auth.getUser()`, then **redirects unauthenticated users to `/auth/login`** for any path that isn't public. Public prefixes: `['/', '/explore', '/about', '/auth', '/trek', '/company']`. The redirect guard is **active** (this resolves the previously-disabled M2 item; `/test` was dropped from the list when the pages were deleted, 2026-08-08).

---

## 6. Core flows

### Join a trek (+ chat)
`src/lib/joinTrek.ts → joinTrekBatchAndChat(userId, trekId, trekTitle, date)` calls the RPC `join_trek_and_chat(p_user_id, p_trek_id, p_batch_date)`. The RPC (SECURITY DEFINER) atomically: upserts the `trek_batches` row, upserts the batch `conversation`, inserts the `trek_participants` row, and adds the user to `conversation_participants`. It derives the caller from `auth.uid()` and refuses `p_user_id` mismatches. Returns `{ batch_id, participant_id, conversation_id }`.

`leaveTrek(userId, batchId?, conversationId?)` deletes the user's `conversation_participants` then `trek_participants` rows. The DELETE fires the leave-notification webhook.

### Reviews
`ReviewForm` compresses up to 5 photos (`compressImage`, ≤1MB each) → uploads to the `trek-reviews` bucket under `{uid}/…` → inserts into `trek_reviews`. RLS requires the reviewer to have **joined the trek** (NEW-3) and enforces one review per (trek, user). `ReviewCard` renders author (via `public_profiles`), stars, comment, photo grid.

### Favorites
Heart toggles in `TrekCard`/`FavCard` insert/delete `favorites` rows (own-row RLS, unique per (user, trek)).

### Account types — where each rule lives (2026-08-06)

One predicate, `is_trekker() := account_type = 'trekker' OR is_platform_admin()`, enforced in three places that must agree:

| Layer | Mechanism | File / object |
|---|---|---|
| Database | `join_trek_and_chat()` raises `'Company accounts cannot join treks'`; `trek_participants` + `favorites` INSERT policies have `with check ((auth.uid() = user_id) AND is_trekker())`; `apply_for_company()` inverts it | `supabase/schema.sql` §14 |
| Route | `(trekker)` group layout calls the same RPC and redirects company accounts to `/dashboard`; the `/dashboard` guard is the mirror image | `src/app/(trekker)/layout.tsx`, `src/app/dashboard/layout.tsx` |
| Controls | `Header` renders Favorites/Profile/Messages for trekkers only (avatar links to `/dashboard/settings` for company accounts); `TrekCard` drops the Join button; `TrekDetailClient` replaces "Book This Trek" with an explanatory note and hides the favourite heart | `src/components/…` |

The UI gates are cosmetic — every one of them is backed by an RLS policy or an RPC raise, so removing a button in devtools changes nothing. They're gated on `canJoin`/`canBook`, which stay **true for signed-out visitors** so the login prompt survives; only a confirmed company account loses the control. Reviews needed no new rule (reviewing already requires having joined) and `conversation_participants` INSERT is service_role-only.

Two things that look like bugs and aren't: **platform admins are exempt** from `is_trekker()` regardless of their `account_type` column, so code mirroring a column-based DB rule must read the column, not the predicate (FEATURES.md Known Gotchas); and a **company account keeps its old bookings** — the split blocks *new* joins/favourites, it doesn't delete history, which is why converting a trekker refuses while they hold an upcoming booking (next section).

### Company onboarding (multi-tenant, 2026-07-02)
`/company/apply` validates with `companyApplicationSchema` (Zod) → `src/lib/company.ts → applyForCompany()` → RPC `apply_for_company` (SECURITY DEFINER: forces `status='pending'`, makes the caller the `owner` member atomically; one pending application per user). A platform admin then runs `approve_company()` / `reject_company()` via SQL (UI comes in Phase D). Company treks only appear publicly (`search_treks`, trek/batch RLS) once the company is `approved` — suspending a company instantly delists its catalogue via `is_trek_visible()`.

**Status controls writes too, since 2026-08-08.** It used to gate reads only, which made suspension a read-side illusion: the treks vanished from Explore while the company kept full write access to its own tenant (invite staff, change roles, rewrite its storefront, archive treks, add departures). Two tiers now — `is_company_writable()` = `pending`+`approved` (settings, team, logos: an applicant is meant to set up while it waits) and `is_approved_company_member()` = `approved` only (treks, departures, trek images). **Rejected and suspended are frozen**: every dashboard page still loads and `CompanyStatusBanner` still explains why, but nothing can be changed. The app mirrors the predicate as `isCompanyFrozen()` in `src/lib/company.ts` so the UI never offers an action RLS will refuse. Reads are never status-gated (staff and existing bookers must keep reading a hidden trek), and neither are the platform-admin arms — freezing must not lock out the role that un-freezes. Rationale + verification: [`supabase/phases/phase-h-frozen-companies.sql`](supabase/phases/phase-h-frozen-companies.sql), `schema.sql` §16.

### Joining someone else's company — invite → accept (2026-08-06)
`/dashboard/team` → `inviteMember()` → RPC `invite_company_member` writes a **pending `company_invites` row** (it does not add a member) → the invitee sees "Invitations (n)" in the Header and accepts at `/invites` → RPC `accept_company_invite` flips `profiles.account_type` and creates the membership in one transaction. There is no token and no email: the invite already requires the person to have a Trekker account, so it is simply shown to them when they sign in. Both ends check the company isn't frozen — the invite RPC answers `company_frozen`, and `accept_company_invite()` re-checks at **accept** time, because invites issued while approved outlive a later rejection and accepting one would trade an account irreversibly for a seat on a dead tenant.

The consent step is the point. Accepting is **destructive and irreversible from the app** for a trekker — `account_type` flips to `company`, RLS then refuses new joins/favourites and the `(trekker)` guard redirects them to `/dashboard`; their bookings, favourites and chats stay in the database but become unreachable, and only a platform admin can flip it back. So `/invites` states that cost above a two-step confirm, and the RPC refuses while they hold any participation (confirmed *or* waitlisted) on a batch dated today or later. An account that is **already** a company account skips all of that and just gains the membership.

`company_members` has **no client INSERT path at all** — no policy, no grant. Memberships are created only by `apply_for_company()` (owner) and `accept_company_invite()` (invited member). The old INSERT policy checked the company and the role but not `user_id`, which let any company admin add an arbitrary account to their team via PostgREST; harmless-ish before, but it would have made the consent gate decorative. Don't re-add one.

### Participant counts
`src/lib/utils.ts → getParticipantCount(trekId)` calls RPC `get_trek_participant_count(trek_uuid)` (counts confirmed participants across the trek's batches). `treks.participants_joined` is a trigger-maintained denormalised counter (`trek_participants_count_trigger` → `update_participants_count()`); as of follow-up #1 (2026-06-22) it counts **confirmed only**, so it agrees with the RPC. Prefer the RPC when you need a guaranteed-fresh read.

---

## 7. Chat / realtime

- Tables: `conversations` (one per batch), `conversation_participants`, `conversation_messages`.
- `/messages` lists the user's conversations and renders a thread. Messages are fetched in pages (newest first) and reversed for display; author names/avatars come from the `public_profiles` view.
- **Message features:** soft-delete (`is_deleted`), edit (`updated_at`), reply (`reply_to`), emoji reactions (`reactions` jsonb), with optimistic UI updates.
- **Batch announcements (2026-08-08):** the operator's only channel to its bookers, since company accounts can't join a trek and `/messages` is trekker-only. An announcement is a `conversation_messages` row with `is_announcement = true` in the batch's **existing** conversation — not a separate table — so it reuses realtime delivery, unread counts and the read receipt untouched, and renders as an amber `Megaphone` notice with no reply/react affordances. The company user is never a `conversation_participant`, so both directions go through SECURITY DEFINER RPCs (`post_batch_announcement` / `get_batch_announcements`): it cannot read trekker replies, appear in presence, or see the member list. **Both write policies pin `is_announcement = false`** — without that a trekker could POST the flag directly and forge an operator notice. See `schema.sql` §17.
- **Realtime:** chat currently relies on fetch/optimistic updates — there is **no `supabase.channel(...)` subscription** for live inserts. (AuthContext does use realtime auth-state events.) Adding a per-conversation channel would make messages stream live.

---

## 8. Storage

| Bucket | Use | Path convention |
|---|---|---|
| `avatars` | profile pictures | `{uid}/file` or `{uid}.ext` (both accepted by RLS) |
| `trek-reviews` | review photos | `{uid}/file` |
| `trek-profile` | (unused; public, no policies) | — |
| `company-logos` | company logo/cover (Phase C UI) | `{company_id}/file` — writes scoped to membership **+ a writable company** |
| `trek-images` | trek cover/photos (Phase C UI) | `{company_id}/{trek_id}/file` — writes scoped to membership **+ an approved company** |

All buckets are public-read; writes are owner-scoped (M1 fix) or company-scoped (multi-tenant), and the two company buckets also carry the status tier of the table they feed (2026-08-08) — because they're public, a bare-membership write policy would let a frozen company overwrite its logo at the CDN path the storefront already links to. See DATABASE.md §9 for the listing-advisor caveat.

---

## 9. Configuration & env

- **Env vars** (`.env.local`, see `.env.local.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SITE_URL` (canonical origin for `metadataBase`, canonical links, OG image URLs and the sitemap — **must be set in Vercel**, or every shared link advertises `http://localhost:3000`; falls back to `VERCEL_PROJECT_PRODUCTION_URL` then localhost, resolved in `src/lib/site.ts`). A `SUPABASE_SERVICE_ROLE_KEY` slot exists in the example but is **not used** in code (and must never reach the browser). `.env*` files are git-ignored (untracked since commit `4e180fa`).
- **`next.config.js`:** `output: 'standalone'`; image `remotePatterns` for the Supabase project host + Unsplash.
- **`tailwind.config.js`:** scans `src/app`, `src/components`, `src/pages`.
- **`tsconfig.json`:** strict, `@/*` alias.

---

## 10. Known issues & cleanup backlog

App-level:
- **`/dashboard/account` is unreachable for a company account that hasn't applied yet** — the `/dashboard` guard sends member-less company accounts to `/company/apply` first. Known, accepted, documented (decision 2026-08-06); not a lockout, since `/auth/forgot-password` still works and the gap closes once they apply. Fixing it means lifting the page to a top-level `/account` route rather than special-casing the guard.
- No app-level rate limiting / security headers; verbose `console.error(JSON.stringify(error))` can leak DB detail.

Database-level (see DATABASE.md §11 for detail): ~~broken `trg_initial_trek_message`~~ (dropped 2026-07-02 by the multi-tenant migration — trek creation works now), ~~`platform_admins` empty~~ (populated 2026-07-02), duplicate dead notification triggers on `trek_participants` (three fire on join — `trek-join-notification`, `trek_join_email_trigger`, plus `trek-leave-notification` on delete).

**Advisors, re-run 2026-08-06 at closeout — 54 lints, nothing new from the account-type work:**

| Lint | Count | Status |
|---|---|---|
| `security_definer_view` — `public_profiles` | 1 ERROR | Known, intentional (the view exists to expose a safe subset) |
| `authenticated_security_definer_function_executable` | 29 WARN | Inherent to the design — these RPCs are *meant* to be called by signed-in users and each re-derives the caller from `auth.uid()`. Not actionable |
| `anon_security_definer_function_executable` | 20 WARN → **3, closed 2026-08-08** | `create or replace` preserves the original ACL, so the older RPCs kept their default PUBLIC execute grant. `supabase/phases/fix-anon-execute-definer-rpcs.sql` revoked `public, anon` on 18 of the 21 (the count was 21, not 20 — `is_company_writable` joined with phase H), each paired with `grant execute … to authenticated`. ⚠️ The remaining **3 stay open by design**: `is_trek_visible`, `is_company_member` and `is_platform_admin` are called from PUBLIC-role SELECT policies, so revoking them takes the public site down — see FEATURES.md Known Gotchas |
| `rls_enabled_no_policy` — `platform_admins`, `rate_events` | 2 INFO | **Intentional.** Both are RLS-on-with-zero-policies *plus* revoked grants, i.e. deliberately unreachable from any client. Don't "fix" by adding a policy |
| `auth_leaked_password_protection` disabled | 1 WARN | Dashboard toggle (HaveIBeenPwned check), not applied |
| `vulnerable_postgres_version` (`supabase-postgres-17.4.1.069`) | 1 WARN | Patch upgrade pending |

The check that mattered: the four step-4 invite RPCs (`accept_company_invite`, `decline_company_invite`, `revoke_company_invite`, `get_my_invites`) plus `is_trekker()` and `join_trek_and_chat()` are **`authenticated`-only — none appear in the anon list**, so the new SECURITY DEFINER surface added no anonymous exposure.

Security history and the remaining hardening checklist live in [SECURITY_AUDIT_ISSUE.md](SECURITY_AUDIT_ISSUE.md); applied-fix SQL with rationale is in [supabase/security-fixes.sql](supabase/security-fixes.sql).

---

## 11. Where things live (quick index)

| I want to… | Look at |
|---|---|
| Change a table / policy | [supabase/schema.sql](supabase/schema.sql) (then apply + re-run advisors) |
| Understand the DB | [DATABASE.md](DATABASE.md) |
| Add/inspect a page | `src/app/<route>/page.tsx` |
| Fetch data server-side (SSR / `generateMetadata` / sitemap) | `src/lib/server-queries.ts` (via `src/utils/supabase/server.ts`) |
| Change a page title / link preview | `src/app/layout.tsx` defaults, `generateMetadata()` in `trek/[id]` + `company/[slug]`, origin in `src/lib/site.ts` |
| Touch auth | `src/lib/auth.ts`, `src/contexts/AuthContext.tsx`, `src/utils/supabase/middleware.ts`, `src/proxy.ts` |
| Change what a trekker vs a company account may do | `is_trekker()` in `supabase/schema.sql` §14 **first** (it's the rule), then mirror it in `src/app/(trekker)/layout.tsx` / `src/app/dashboard/layout.tsx` and the `canJoin`/`canBook` props. Read the `is_trekker()`-vs-`account_type` gotcha in FEATURES.md before choosing which to call |
| Add a trekker-only page | Drop it in `src/app/(trekker)/` — it inherits the guard, and the URL does not gain the group name |
| Touch join/leave | `src/lib/joinTrek.ts` + RPC `join_trek_and_chat` |
| Touch chat | `src/app/messages/page.tsx` + `conversation_*` tables |
| Touch uploads | `src/utils/imageCompression.ts`, `ReviewForm`, profile-edit pages |
| Security backlog | [SECURITY_AUDIT_ISSUE.md](SECURITY_AUDIT_ISSUE.md) |
