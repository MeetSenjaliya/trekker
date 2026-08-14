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
- `npm run build` is the gating check; `npm test` is cheap enough (~1.4s) to run alongside it. Both before marking work complete (see Testing & Linting).

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

- `src/lib/joinTrek.ts` — `joinTrekBatchAndChat()` / `leaveTrek()`, the **only** correct join path (→ RPC `join_trek_and_chat`).
- `src/lib/auth.ts` — `signUp/signInAs/signOut/resetPassword/updatePassword/getCurrentUser`. `signInAs()` takes the account kind and only persists a session if it matches.
- `src/contexts/AuthContext.tsx` — `useAuth(): { user, session, loading, signOut }`.
- `src/utils/imageCompression.ts` — `compressImage()`, `sanitizeFileName()`.
- `src/proxy.ts` → `src/utils/supabase/middleware.ts` `updateSession()` — session refresh + route guard.
- `supabase/functions/` — edge functions (`send-trek-notification`, `send-trek-leave-notification`).
- `supabase/migrations/` — every DB change, append-only. See its `README.md`; `schema.sql` is generated from it.

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

```bash
npm run lint      # ESLint (next/core-web-vitals)
npm run build     # TypeScript + ESLint errors fail the build
npm run dev       # Local dev server on http://localhost:3000
npm test          # Vitest unit tests (~1.4s) — run this too, it's cheap
npm run test:watch
npm run test:e2e  # Playwright; starts its own dev server on :3000
npm run db:schema # Regenerate supabase/schema.sql from supabase/migrations/
npm run db:check  # Fail if schema.sql is stale (also asserted by npm test)
```

**124 unit + DB tests across 10 files, plus 2 Playwright smoke specs.** Don't assume a change is safe because `npm test` passes; assume only that the tested surface still works:
- `tests/db/**` (81) — **RLS policies, definer RPCs and EXECUTE grants against real Postgres**, plus a check that `schema.sql` still matches the migrations. See `tests/db/README.md` before adding to these
- `src/lib/schemas.test.ts` (15) — Zod schema validation
- `src/lib/company.test.ts` (17) — the pure logic in `company.ts`; its I/O is covered by `tests/db/`
- `src/components/ui/ConfirmationModal.test.tsx` (5), `TrekPagination.test.tsx` (6)
- `e2e/smoke.spec.ts` (2) — homepage loads, `/explore` reachable

**Vitest runs two projects** (`vitest.config.ts`): `unit` (jsdom, `src/**/*.test.{ts,tsx}`) and `db` (node, `tests/db/**/*.test.ts`). The DB project boots PGlite — Postgres 18 compiled to WASM, in-process, no Docker — and replays `supabase/migrations/*.sql` in order, so every run also proves the migrations rebuild a database from nothing. Target it with `npx vitest run --project db`.

**The DB tests are only as true as `supabase/migrations/`.** They prove the policies *as committed* are sound, not that production matches them — read `supabase_migrations.schema_migrations` over the MCP server for that. Their first run found 20 functions whose live EXECUTE grants the file could not reproduce.

Config is `vitest.config.ts` (jsdom, `vitest.setup.ts`, `@` alias mirrored from tsconfig) and `playwright.config.ts` (chromium only). **Vitest only collects `src/**/*.test.{ts,tsx}` and explicitly excludes `e2e/**`** — a Playwright spec placed under `src/` would be picked up by Vitest and fail on the missing Playwright fixtures. Add unit tests beside the code as `*.test.ts(x)`; add browser specs to `e2e/` as `*.spec.ts`.

`npm run test:e2e` binds port 3000 and reuses an existing server locally (`reuseExistingServer`), so a dev server you already have running will serve the specs — stop it first if you want a clean run.

ESLint config is `eslint.config.mjs` (flat config, ESLint 9). It extends `next/core-web-vitals` + `next/typescript` and sets **no rule overrides**; the only customisation is an `ignores` list (`.next`, `node_modules`, `out`, `build`, `src/app/test`). A stale `.eslintrc.json` is still in the repo turning four rules off — ESLint 9 ignores it entirely, so none of that applies; don't trust it. It's queued for deletion in `FEATURES.md` §1.5.

So every rule those presets ship is live at its default severity — including ones previously documented here as off. Notably `@typescript-eslint/no-explicit-any` is an **error**: a bare `catch (e: any)` fails `npm run lint`. Type the caught value properly (`e instanceof Error ? … : …`) or avoid touching its properties.

**Known warning backlog** (non-blocking — `npm run build` passes; do not "fix" these in passing as part of unrelated work):
- 12× `@next/next/no-img-element` — use `next/image` for remote images
- 10× `react-hooks/exhaustive-deps` — real stale-closure risk; each needs individual judgement, since a wrongly-added dep can turn a one-shot effect into a re-render loop

Before marking any task complete: run `npm run build` and `npm test`. If either fails, fix it — the build is the gating check, and the unit tests are fast enough that skipping them buys nothing.

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

### Every DB change is a migration

`supabase/migrations/NNNN_description.sql`, append-only. Full workflow in `supabase/migrations/README.md`. The short version:

1. **Write the next migration.** Never edit an applied one — fix it with a new one. It must run top-to-bottom on an empty database, and must end by recording itself in `supabase_migrations.schema_migrations`.
2. **Test it:** `npx vitest run --project db` replays every migration into a real in-process Postgres.
3. **Give the user the file to paste** into the SQL Editor (dashboard → SQL Editor → run).
4. **After they confirm**, run `npm run db:schema` to regenerate `schema.sql`, and update the reference files below.

**Never claim a migration is applied because a file says so.** Comments outlive their truth — that produced a false 🔴 critical in `CODE_REVIEW.md` §1.3. Check the ledger over the read-only MCP server:

```sql
select version, name, applied_at from supabase_migrations.schema_migrations order by version;
```

### Reference files (not source of truth)

These document the live database state but **do not reflect changes automatically**. Update them manually after any schema, RLS, or storage policy change is applied on Supabase:

| File | What it tracks |
|------|---------------|
| `supabase/schema.sql` | **Generated — do not hand-edit.** Every migration concatenated in order (`npm run db:schema`); `npm test` fails on drift. Run it whole to build a fresh project. |
| `supabase/security-fixes.sql` | Rationale for each security hardening step. Append new entries; don't rewrite history. The SQL itself now lives in a migration. |
| `CONTEXT.md` | High-level architecture, flows, known issues. Update on significant structural changes. |
| `DATABASE.md` | Human-readable DB reference (tables, columns, RLS summary). Update alongside `schema.sql`. |
| `FEATURES.md` | Feature status (built / partial / pending). Update whenever a feature is added, changed, or completed. |

**When a user applies a change on Supabase, immediately update these files** so the next conversation starts with accurate context.

---

## Known Gotchas

Caveats, invariants, and "don't break this" notes live in the **Known Gotchas** section of `FEATURES.md`.
