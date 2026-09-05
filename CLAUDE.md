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
- `src/proxy.ts` → `src/utils/supabase/middleware.ts` `updateSession()` — session refresh + route guard, and (since 2026-09-05) the per-request CSP nonce from `src/utils/csp.ts`. The nonce is why every route renders at request time (`connection()` in `src/app/layout.tsx`); any `<script>` the app renders itself must carry it — see Known Gotchas in `FEATURES.md`.
- `supabase/functions/` — edge functions (`send-trek-notification`, `send-trek-leave-notification`).
- `supabase/migrations/` — every DB change, append-only. See its `README.md`; `schema.sql` is generated from it.

**Two Supabase client styles coexist:**
- `src/lib/supabase.ts` — plain singleton, used by most page components
- `src/utils/supabase/*` — `@supabase/ssr` factories, used by middleware and route handlers

**Use the `utils/supabase` factories everywhere.** The singleton keeps its session in localStorage; sign-in writes it to cookies, so the singleton is permanently signed out and its queries run as `anon` — which RLS answers with an empty result, not an error. `src/lib/supabase.ts` survives only for `opengraph-image.tsx` (server-side anon reads) and its exported types. See Known Gotchas in `FEATURES.md`.

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

`eslint-config-next` 16 ships **native flat config**, so `eslint.config.mjs` imports `eslint-config-next/core-web-vitals` and `/typescript` directly — it no longer wraps them in `FlatCompat`, which throws on the v16 package. That version also turns on two React Compiler rules, both **errors**, both already at zero violations — keep them there:

- `react-hooks/purity` — no `Math.random()` / `Date.now()` during render. A `useState` lazy initializer is the accepted escape hatch; `useMemo` and `useRef` are **not** (the rule flags both).
- `react-hooks/set-state-in-effect` — no synchronous `setState` in an effect body. Reach for `useSyncExternalStore` when reading web storage or "am I mounted", derive-during-render for defaults, and the adjust-during-render pattern (`if (prev !== next) { setPrev(next); … }`) when re-syncing on a prop change. Async `setState` inside a promise callback is not flagged.

**Two toolchain versions are pinned below latest on purpose — both because of lint, and neither will show up as a problem in `npm run build`:**

- **`typescript` stays on 6.x.** TS 7 (the Go rewrite) type-checks this repo cleanly, but `typescript-eslint` refuses to load against the TS 7 API and `npm run lint` dies before linting anything.
- **`eslint` stays on 9.x**, even though npm marks 9.39.5 deprecated and 10.x is latest. ESLint 10 crashes inside `eslint-plugin-react`, which `eslint-config-next` 16 bundles. Its peer range (`eslint: >=9.0.0`) is wrong — don't trust it, just try it.

Re-test both whenever `eslint-config-next` bumps; see `FEATURES.md` §2 for the tracking issue.

**Known warning backlog** (non-blocking — `npm run build` passes; do not "fix" these in passing as part of unrelated work):
- 12× `@next/next/no-img-element` — use `next/image` for remote images
- 3× `react-hooks/exhaustive-deps` — real stale-closure risk; each needs individual judgement, since a wrongly-added dep can turn a one-shot effect into a re-render loop

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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
