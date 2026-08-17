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

Versions live in `package.json`. Two things it doesn't tell you: styling is **Tailwind-first** — MUI + Emotion and Bootstrap are partial legacy holdovers, don't reach for them in new code; and there is **no custom backend server**. All data access goes through the Supabase publishable key; security is enforced entirely by Postgres RLS and SECURITY DEFINER RPCs.

---

## Directory Structure

App Router under `src/app/`; reusable UI in `src/components/ui/`, layout in `src/components/layout/`. List the tree to see the obvious parts — the non-obvious files that affect how you write code:

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

Scripts are in `package.json`. `npm test` is Vitest and takes ~1.4s.

**Don't assume a change is safe because `npm test` passes**; assume only that the tested surface still works. The heaviest coverage is `tests/db/**` — **RLS policies, definer RPCs and EXECUTE grants against real Postgres**, plus a check that `schema.sql` still matches the migrations. Read `tests/db/README.md` before adding to those.

**Vitest runs two projects** (`vitest.config.ts`): `unit` (jsdom, `src/**/*.test.{ts,tsx}`) and `db` (node, `tests/db/**/*.test.ts`). The DB project boots PGlite — Postgres 18 compiled to WASM, in-process, no Docker — and replays `supabase/migrations/*.sql` in order, so every run also proves the migrations rebuild a database from nothing. Target it with `npx vitest run --project db`.

**The DB tests are only as true as `supabase/migrations/`.** They prove the policies *as committed* are sound, not that production matches them — read `supabase_migrations.schema_migrations` over the MCP server for that. Their first run found 20 functions whose live EXECUTE grants the file could not reproduce.

Config is `vitest.config.ts` (jsdom, `vitest.setup.ts`, `@` alias mirrored from tsconfig) and `playwright.config.ts` (chromium only). **Vitest only collects `src/**/*.test.{ts,tsx}` and explicitly excludes `e2e/**`** — a Playwright spec placed under `src/` would be picked up by Vitest and fail on the missing Playwright fixtures. Add unit tests beside the code as `*.test.ts(x)`; add browser specs to `e2e/` as `*.spec.ts`.

`npm run test:e2e` binds port 3000 and reuses an existing server locally (`reuseExistingServer`), so a dev server you already have running will serve the specs — stop it first if you want a clean run.

A stale `.eslintrc.json` is still in the repo turning four rules off — ESLint 9 reads `eslint.config.mjs` and ignores it entirely, so none of that applies; don't trust it. It's queued for deletion in `FEATURES.md` §1.5.

So every rule the `next/core-web-vitals` + `next/typescript` presets ship is live at its default severity — including ones previously documented here as off. Notably `@typescript-eslint/no-explicit-any` is an **error**: a bare `catch (e: any)` fails `npm run lint`. Type the caught value properly (`e instanceof Error ? … : …`) or avoid touching its properties.

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

## Supabase — Read-Only MCP

**The Supabase MCP server is connected in read-only mode.** It can inspect live schema, query logs, and fetch advisors, but cannot apply changes — **all database changes are applied manually** by the user through the Supabase SQL Editor.

Every DB change is an append-only migration in `supabase/migrations/`. **Never edit an applied migration** — fix it with a new one. **`supabase/schema.sql` is generated — never hand-edit it** (`npm test` fails on drift).

**Never claim a migration is applied because a file says so.** Comments outlive their truth — that produced a false 🔴 critical in `CODE_REVIEW.md` §1.3. Check the ledger over the read-only MCP server:

```sql
select version, name, applied_at from supabase_migrations.schema_migrations order by version;
```

For the full write → test → apply → sync workflow and the reference files to update afterwards, use the **`db-migration` skill**.

---

## Known Gotchas

Caveats, invariants, and "don't break this" notes live in the **Known Gotchas** section of `FEATURES.md`.
