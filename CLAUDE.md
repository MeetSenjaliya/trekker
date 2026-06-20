# Trekker — Claude Code Guide

## Working Principles

Guidelines to reduce common coding mistakes. Bias toward caution over speed — for trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility"/"configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting; don't refactor what isn't broken.
- Match existing style, even if you'd do it differently.
- Remove imports/variables/functions YOUR changes made unused; don't delete pre-existing dead code unless asked — mention it instead.
- Test: every changed line should trace directly to the request.

### 4. Goal-Driven Execution

**Define success criteria, then verify against them.**

- Turn vague tasks into verifiable goals ("fix the bug" → "reproduce it, then confirm the repro is gone").
- For multi-step tasks, state a brief plan with a verify step for each.
- The build is the gating check — run `npm run build` before marking work complete (see Testing & Linting).

---

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

App Router under `src/app/` (`page`, `explore`, `about`, `trek/[id]`, `auth`, `profile`, `favorites`, `messages`, `review`, `edits`); reusable UI in `src/components/ui/`, layout in `src/components/layout/`. List the tree to see the obvious parts — the non-obvious files that affect how you write code:

- `src/lib/database.ts` — ⚠️ **DEAD**: wrong tables/columns, nothing imports it. Don't read or use it.
- `src/app/test/` — ⚠️ Dev/RLS test pages, public in prod, should be removed.
- `src/lib/joinTrek.ts` — `joinTrekBatchAndChat()` / `leaveTrek()`, the **only** correct join path (→ RPC `join_trek_and_chat`).
- `src/lib/auth.ts` — `signUp/signIn/signOut/resetPassword/updatePassword/getCurrentUser`.
- `src/contexts/AuthContext.tsx` — `useAuth(): { user, session, loading, signOut }`.
- `src/utils/imageCompression.ts` — `compressImage()`, `sanitizeFileName()`.
- `src/proxy.ts` → `src/utils/supabase/middleware.ts` `updateSession()` — session refresh + route guard.
- `supabase/functions/` — edge functions (`send-trek-notification`, `send-trek-leave-notification`).

**Two Supabase client styles coexist:**
- `src/lib/supabase.ts` — plain singleton, used by most page components
- `src/utils/supabase/*` — `@supabase/ssr` factories, used by middleware and route handlers

New server-side code should use the `utils/supabase` factories. Client components can use either; prefer the singleton for consistency.

---

## Code Conventions

- **TypeScript strict mode is on.** Build fails on type errors (`noEmit: true`). Fix types properly — don't cast to `any` or use `// @ts-ignore`.
- **Path alias:** always use `@/` for imports from `src/`. Never use relative `../../` paths across feature boundaries.
- **Supabase queries:** always handle both `.data` and `.error`. Log errors but don't expose Supabase error detail to the UI.
- **Auth:** derive the acting user from `auth.uid()` server-side (RLS / SECURITY DEFINER RPCs), not from a client-supplied `user_id`.
- **Join/leave trek:** always go through `joinTrekBatchAndChat()` / `leaveTrek()` in `src/lib/joinTrek.ts` → RPC `join_trek_and_chat`. Never insert into `trek_participants` directly from the client.
- **Image uploads:** compress with `compressImage()` before uploading. Store under `{uid}/filename` in the relevant bucket. Never store PII in file names.
- **Components:** no default prop sprawl. Keep page components focused; extract reusable pieces into `src/components/ui/`.
- **No comments explaining what code does.** Only comment when the *why* is non-obvious (hidden constraint, workaround, invariant).

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
- Recent commits: `security:` for RLS/policy changes, `chore:` for infra/config, `fix:` for bugs.

---

## Feature Tracking

`FEATURES.md` is the single source of truth for what's built vs pending.

**After adding, changing, or completing ANY feature, update `FEATURES.md` in the same change** — set status (✅ / 🟡 / ❌), add evidence (source files, plus the relevant `schema.sql` section for DB-backed features), and bump the "Last updated" date. Do this before marking the task complete.

**Layout:** `FEATURES.md` has two halves. **§1 — To do** (top) is the forward-looking backlog: features to add, partials to finish, remaining engineering/security work, open review follow-ups. **§2 — Done** (bottom) records what's shipped. When work completes, move its row from §1 to §2 (a 🟡 partial lives in both: shipped part in §2, remaining part in §1, linked by follow-up number).

---

## Supabase — Read-Only MCP + Reference Files

**The Supabase MCP server is connected in read-only mode.** It can inspect live schema, query logs, and fetch advisors, but cannot apply changes.

**All database changes must be applied manually** by the user through the Supabase SQL Editor (dashboard → SQL Editor → run the SQL).

When suggesting a DB/RLS/storage change:
1. Write the exact SQL to run.
2. After the user confirms they've applied it, update the relevant reference files below to stay in sync.

### Reference files (not source of truth)

These document the live database state but **do not reflect changes automatically**. Update them manually after any schema, RLS, or storage policy change is applied on Supabase:

| File | What it tracks |
|------|---------------|
| `supabase/schema.sql` | Full DDL: tables, enums, views, functions, triggers, RLS policies, storage buckets + policies. Update whenever anything changes on Supabase. |
| `supabase/security-fixes.sql` | Rationale + SQL for each security hardening step. Append new entries; don't rewrite history. |
| `CONTEXT.md` | High-level architecture, flows, known issues. Update on significant structural changes. |
| `DATABASE.md` | Human-readable DB reference (tables, columns, RLS summary). Update alongside `schema.sql`. |
| `FEATURES.md` | Feature status (built / partial / pending). Update whenever a feature is added, changed, or completed. |

**When a user applies a change on Supabase, immediately update these files** so the next conversation starts with accurate context.

---

## Known Gotchas

Caveats, invariants, and "don't break this" notes live in the **Known Gotchas** section of `FEATURES.md`.
