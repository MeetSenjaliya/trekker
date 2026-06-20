# Trekker — Claude Code Guide

## Tech Stack

| Area | Choice |
|------|--------|
| Framework | Next.js `^16` (App Router, `output: 'standalone'`) |
| UI runtime | React `19` |
| Language | TypeScript `^5` (`strict: true`, path alias `@/* → src/*`) |
| Backend | Supabase (`@supabase/supabase-js ^2.51`, `@supabase/ssr ^0.6`) |
| Styling | Tailwind CSS `^3.4` (primary), MUI `^7` + Emotion (partial), Bootstrap (minimal) |
| Animation | Framer Motion `^12` |
| Icons | Lucide React |
| Image compression | `browser-image-compression` (review photo uploads) |

No custom backend server. All data access goes through the Supabase anon key; security is enforced entirely by Postgres RLS and SECURITY DEFINER RPCs.

---

## Directory Structure

```
src/
├── app/                        # App Router pages
│   ├── page.tsx                # Home: hero + featured treks
│   ├── explore/                # Trek discovery with filters + pagination
│   ├── about/                  # Static page
│   ├── trek/[id]/              # Trek detail: reviews, join/leave, chat entry, favorite
│   ├── auth/                   # login / signup / forgot-password / reset-password
│   ├── profile/                # Profile view + edit
│   ├── favorites/              # Saved treks
│   ├── messages/               # Group chat UI
│   ├── review/                 # Reviews showcase + submit
│   ├── edits/                  # Alt profile-edit page
│   └── test/                   # ⚠️ Dev/RLS test pages — public in prod, should be removed
├── components/
│   ├── layout/                 # Header.tsx, Footer.tsx
│   └── ui/                     # TrekCard, FavCard, ReviewCard, ReviewForm,
│                               # ConfirmationModal, HeroSection, FilterSection,
│                               # TrekPagination, Chat (stub), SnowEffect
├── contexts/
│   └── AuthContext.tsx          # useAuth(): { user, session, loading, signOut }
├── lib/
│   ├── supabase.ts             # Browser anon client singleton + legacy TS interfaces
│   ├── auth.ts                 # signUp/signIn/signOut/resetPassword/updatePassword/getCurrentUser
│   ├── joinTrek.ts             # joinTrekBatchAndChat(), leaveTrek() — the real join path
│   ├── database.ts             # ⚠️ DEAD — wrong tables/columns, nothing imports it
│   └── utils.ts                # getParticipantCount() RPC wrapper
├── utils/
│   ├── imageCompression.ts     # compressImage(), sanitizeFileName()
│   └── supabase/
│       ├── client.ts           # createBrowserClient (@supabase/ssr)
│       ├── server.ts           # createServerClient (cookies via next/headers)
│       └── middleware.ts       # updateSession(): refresh session + route guard
├── types.ts                    # Trek, Favorite, TrekParticipant (UI-facing types)
└── proxy.ts                    # Next 16 middleware entry → updateSession()

supabase/
├── schema.sql                  # Reference — see Supabase section below
├── security-fixes.sql          # Reference — see Supabase section below
└── functions/                  # Edge functions (send-trek-notification, send-trek-leave-notification)
```

**Two Supabase client styles coexist:**
- `src/lib/supabase.ts` — plain singleton, used by most page components
- `src/utils/supabase/*` — `@supabase/ssr` factories, used by middleware and route handlers

New server-side code should use the `utils/supabase` factories. Client components can use either; prefer the singleton for consistency with the rest of the app.

---

## Code Conventions

- **TypeScript strict mode is on.** Build fails on type errors (`noEmit: true`). Fix types properly — don't cast to `any` or use `// @ts-ignore`.
- **Path alias:** always use `@/` for imports from `src/`. Never use relative `../../` paths across feature boundaries.
- **Supabase queries:** always handle both `.data` and `.error`. Log errors but don't expose Supabase error detail to the UI.
- **Auth:** derive the acting user from `auth.uid()` server-side (RLS / SECURITY DEFINER RPCs), not from a client-supplied `user_id` parameter.
- **Join/leave trek:** always go through `joinTrekBatchAndChat()` / `leaveTrek()` in `src/lib/joinTrek.ts` → RPC `join_trek_and_chat`. Never insert into `trek_participants` directly from the client.
- **Image uploads:** compress with `compressImage()` before uploading. Store under `{uid}/filename` in the relevant bucket. Never store PII in file names.
- **Components:** no default prop sprawl. Keep page components focused; extract reusable pieces into `src/components/ui/`.
- **No comments explaining what code does.** Only add a comment when the *why* is non-obvious (hidden constraint, workaround, invariant).

---

## Testing & Linting

There are **no automated tests** in this project.

```bash
npm run lint      # ESLint (next/core-web-vitals)
npm run build     # TypeScript + ESLint errors fail the build
npm run dev       # Local dev server on http://localhost:3000
```

ESLint rules in `.eslintrc.json`:
- `@typescript-eslint/no-explicit-any` — off
- `@typescript-eslint/no-unused-vars` — off
- `react-hooks/exhaustive-deps` — off
- `@next/next/no-img-element` — warn (use `next/image` for remote images)

Before marking any task complete: run `npm run build`. If it errors, fix it — the build is the gating check.

---

## Git Conventions

- Branch off `main`. Current working branch is `a1`.
- Commit messages are short and imperative: `fix: ...`, `feat: ...`, `security: ...`, `chore: ...`.
- Never commit `.env.local` or any file containing secrets. `.env*` is gitignored.
- Recent commits follow the pattern: `security:` for RLS/policy changes, `chore:` for infra/config, `fix:` for bugs.

---

## Feature Tracking

`FEATURES.md` is the single source of truth for what's built vs pending.

**After adding, changing, or completing ANY feature, update `FEATURES.md` in the same change** — set its status (✅ / 🟡 / ❌), add the evidence (source files, and the relevant `schema.sql` section for DB-backed features), and bump the "Last updated" date. Do this before marking the task complete.

---

## Supabase — Read-Only MCP + Reference Files

**The Supabase MCP server is connected in read-only mode.** It can be used to inspect live schema, query logs, and fetch advisors, but it cannot apply changes.

**All database changes must be applied manually** by the user through the Supabase SQL Editor (dashboard → SQL Editor → run the SQL).

When suggesting a DB/RLS/storage change:
1. Write the exact SQL to run.
2. After the user confirms they've applied it, update the relevant reference files below to stay in sync.

### Reference files (not source of truth)

These files document the live database state but **do not reflect changes automatically**. They must be manually updated after any schema, RLS, or storage policy change is applied on Supabase:

| File | What it tracks |
|------|---------------|
| `supabase/schema.sql` | Full DDL: tables, enums, views, functions, triggers, RLS policies, storage buckets + policies. Update this whenever anything changes on Supabase. |
| `supabase/security-fixes.sql` | Rationale + SQL for each security hardening step. Append new entries; don't rewrite history. |
| `CONTEXT.md` | High-level architecture, flows, known issues. Update when significant structural changes happen. |
| `DATABASE.md` | Human-readable DB reference (tables, columns, RLS summary). Update alongside `schema.sql`. |
| `FEATURES.md` | Feature status (built / partial / pending). Update whenever a feature is added, changed, or completed. |

**When a user applies a change on Supabase, immediately update these files to reflect the new state** so the next conversation starts with accurate context.

---

## Known Gotchas

- **`src/lib/database.ts` is dead.** It references a non-existent `reviews` table, `trek_participants.trek_id` (column doesn't exist), and the old `increment_participants` RPC. Nothing live imports it. Safe to delete eventually but don't touch it expecting it to work.

- **`trg_initial_trek_message` trigger is broken in prod.** It calls `create_trek_initial_message()` which inserts into a `trek_messages` table that doesn't exist. Creating a trek via the API currently errors because of this trigger. It's reproduced in `schema.sql` with a BUG comment — don't fix silently without telling the user.

- **`treks.participants_joined` is a denormalised counter** kept in sync by the `trek_participants_count_trigger`. Use `get_trek_participant_count()` RPC for reads if you need accuracy; don't trust the column in isolation.

- **`src/app/test/*` pages are publicly routable in production.** They're included in the middleware public-path allowlist. Should be removed or guarded before any public launch.

- **No realtime subscriptions in chat.** Messages are fetched on demand / optimistic update only. There is no `supabase.channel()` subscription — new messages from other users don't appear live without a page refresh.

- **`public_profiles` view is `security_definer`.** Supabase's advisor flags this as an error. It's intentional — it lets `full_name` and `avatar_url` be readable cross-user (for chat/reviews) without exposing PII from the `profiles` base table. Don't "fix" it by making the view `security_invoker`.

- **Storage buckets are `public: true` (CDN delivery) but object listing requires auth.** The SELECT RLS policies on `storage.objects` are scoped to `authenticated` to block anonymous enumeration of UUID-keyed paths. `getPublicUrl()` bypasses RLS entirely — it always works regardless of policy.

- **Two env vars only:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The `SUPABASE_SERVICE_ROLE_KEY` slot exists in `.env.local.example` but is unused in app code and must never reach the browser.

- **Password recovery uses the `token_hash` flow, not PKCE.** `resetPasswordForEmail()` (in `src/lib/auth.ts`) redirects to `/auth/reset-password`, whose page calls `supabase.auth.verifyOtp({ token_hash, type })`. This is deliberate — PKCE breaks when the reset email is opened on a different device than the one that requested it. It depends on two dashboard settings that are **not** in the repo: the Supabase "Reset Password" email template must link to `{{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery` (the default `{{ .ConfirmationURL }}` will NOT work), and `/auth/reset-password` must be in Authentication → URL Configuration → Redirect URLs. The old `src/auth/{callback,confirm}/route.ts` handlers were deleted (they sat outside `src/app/`, so App Router never registered them — dead code with a latent open-redirect).