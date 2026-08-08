# Trekker — Code Review: Cons & Suggestions

A senior-dev review of the codebase as of **2026-08-04** (branch `a1`). This document
records **problems to fix** and **improvements to make**. The strengths of the project
are deliberately omitted — this is a working backlog, not an assessment.

> **How to use this:** work top-to-bottom. §1 removes the two remaining critical risks and
> takes about an afternoon. §2 is the structural work that unblocks revenue. §3+ is
> steady-state cleanup. Tick boxes as you go.
>
> **Verification state:** `npm run build` passes clean (exit 0, all 31 routes) as of this
> review. Supabase MCP was unauthorized when this review was written, so DB findings were
> taken from static reading of `supabase/schema.sql`, `supabase/migration-multi-tenant.sql`,
> and `supabase/phases/*.sql`. **That produced one false critical finding (§1.3) — the SQL
> files' status comments did not match the live database.** §1.3 has since been verified
> against the live DB (2026-08-04) and withdrawn. Every other DB finding, including the
> §3.1 index gaps, is still static-read only — confirm against the live schema before acting.

---

## §1 — Critical (do first)

### 1.1 🔴 ~5,000 lines of finished work are untracked in git

- [ ] `git add -A && git commit && git push origin a1:main`

**Evidence:** last commit `caa4229` is dated **2026-06-24**; work continued to **2026-07-15**.
Untracked at review time:

```
?? src/app/admin/          ?? src/app/dashboard/       ?? src/app/company/
?? src/components/admin/   ?? src/lib/company.ts       ?? src/hooks/useRequireCompanyRole.ts
?? src/components/layout/BfcacheGuard.tsx
?? supabase/migration-multi-tenant.sql  ?? supabase/phases/  ?? MULTI_TENANT_PLAN.md
```

Plus 13 modified tracked files. That is the **entire multi-tenant app layer** — Phases B–E,
the 830-line `src/lib/company.ts`, all 11 dashboard/admin pages.

**Why it matters — three consequences, the third is the one people miss:**
1. One `git clean -fd`, disk failure, or bad merge destroys three weeks of work.
2. CI has never run on any of it.
3. **It has never deployed.** Prod ships from `main` via Vercel — so the flagship
   multi-tenant marketplace isn't live for anyone.

Highest-leverage item in this document. Five minutes.

---

### 1.2 🔴 `/test/*` is publicly routable in production

- [ ] `rm -rf src/app/test`
- [ ] Remove `'/test'` from `publicRoutes` in `src/utils/supabase/middleware.ts:42`
- [ ] Re-run `npm run build` and confirm the 7 `/test` routes are gone

**Evidence:** build output lists `/test`, `/test/batch`, `/test/fav`, `/test/profile`,
`/test/profilet`, `/test/review`, `/test/storage-check`, `/test/trek/[id]`.
`src/app/test/storage-check/page.tsx` enumerates storage buckets against the live project;
the others are RLS probes.

**Why it matters:** RLS means an attacker can't *read* what they shouldn't — but this hands
them a free reconnaissance console that maps bucket layout and policy boundaries. Tracked as
"L4" across multiple review cycles and still open. Also carries 8 stale `alert()` calls.

---

### 1.3 ✅ ~~Documented security fixes are not applied to the live DB~~ — RESOLVED, claim was false

**Verified against the live DB via read-only MCP on 2026-08-04. Both fixes were already
applied. There is nothing to run.** The original finding below was wrong; it was written from
the SQL files' own stale status headers rather than from the database.

- [x] `supabase/phases/fix-companies-audit-column-exposure.sql` — confirmed applied
- [x] `supabase/phases/polish-participant-trek-visibility.sql` — confirmed applied
- [x] Advisors re-run — neither fix left residue (remaining items tracked in §4.4)
- [x] Stale `⚠️ NOT YET APPLIED` header stripped from `polish-participant-trek-visibility.sql`
      and replaced with a dated `✅ APPLIED` marker

**Evidence — audit column exposure:** the table-wide SELECT grant is gone from both client
roles (`companies` relacl → `anon=awdDxtm`, `authenticated=awdDxtm`; no `r`), and the three
audit columns carry a null `attacl`, i.e. no grant at all:

| Check | Result |
|---|---|
| `has_table_privilege('anon','public.companies','SELECT')` | `false` |
| `has_column_privilege('anon', …, 'created_by', 'SELECT')` | `false` |
| `has_column_privilege('anon', …, 'approved_by', 'SELECT')` | `false` |
| `has_column_privilege('anon', …, 'approved_at', 'SELECT')` | `false` |
| `has_column_privilege('anon', …, 'name', 'SELECT')` | `true` (12-col allowlist intact) |

`admin_list_companies(text)` and `admin_get_company(uuid)` both exist, both `SECURITY DEFINER`,
both gated on `is_platform_admin()`, with `proacl = {postgres, authenticated, service_role}` —
`anon` and `PUBLIC` revoked. The deanonymization path fails on column privilege before RLS is
consulted.

**Evidence — participant visibility:** `pg_get_functiondef('public.is_trek_visible(uuid)')`
matches the phase file byte-for-byte, fourth arm present:

```sql
or exists (
  select 1 from public.trek_participants tp
  join public.trek_batches tb on tb.id = tp.batch_id
  where tb.trek_id = t.id and tp.user_id = auth.uid()
)
```

**The process problem is real but inverted.** `schema.sql` and `DATABASE.md` were never out of
sync — they were correct. What drifted was the *phase file's own status header*, which read
`⚠️ STATUS: NOT YET APPLIED TO THE LIVE DB` long after the SQL went live. A reviewer trusting
that comment reports a PII leak that does not exist, and the next person burns time re-applying
finished work or chasing a phantom breach. That header is now corrected to a dated
`✅ APPLIED` marker, so the trap is disarmed.

**Process fix, restated:** a file's comment is never evidence of database state. Verify against
`pg_proc` / `relacl` / `attacl` before reporting DB findings, and delete the pending marker in
the same change that applies the SQL:

```sql
-- ⚠️ PENDING — NOT YET APPLIED TO LIVE DB (as of YYYY-MM-DD)   ← delete on apply
```

---

## §2 — Structural (unblocks the product)

### 2.1 🟠 No server layer — this is the ceiling on everything commercial

- [ ] Add Route Handlers / Server Actions using `src/utils/supabase/server.ts`
- [ ] Move `SUPABASE_SERVICE_ROLE_KEY` into server-only env (never `NEXT_PUBLIC_*`)

Every write currently goes browser → Supabase with the anon key. There is nowhere to hold a
secret, verify a webhook, or run trusted logic. That single fact blocks:

- **Payments** — Stripe/Razorpay require a server for intent creation and webhook signature
  verification. Non-negotiable.
- **Notifications** — the edge functions in `supabase/functions/` exist but are unwired.
- **Rate limiting** — nothing stops a script hammering `apply_for_company` or auth endpoints.

Already logged in `FEATURES.md` as "Phase 1 remaining". **Promote it to next.**

---

### 2.2 🟠 Zero SSR on discovery pages → SEO is effectively broken

- [ ] Convert `/explore`, `/trek/[id]`, `/company/[slug]`, `/` to Server Components
- [ ] Add `generateMetadata` to `/trek/[id]` and `/company/[slug]` (title, description, OG image)
- [ ] Add `src/app/sitemap.ts` and `src/app/robots.ts`

**Evidence:** every content page is `'use client'` — `src/app/page.tsx`,
`src/app/explore/page.tsx`, `src/app/trek/[id]/page.tsx`, `src/app/company/[slug]/page.tsx`.
Data fetches after hydration, so served HTML contains no trek content. There is exactly
**one** `metadata` export in the whole app (`src/app/layout.tsx:10`). No `generateMetadata`,
no OG tags, no sitemap, no robots.

**Concretely:** every trek shares one title in search results; a trek link shared on WhatsApp
shows no image or description; Google gets a blank shell.

For a marketplace that lives on organic discovery and social sharing, this is a **business
problem wearing a technical costume** — and the cheapest large win available.

**Do it together with §2.1.** Same refactor: keep interactivity (join button, favorite heart,
filter controls) as small client islands; move fetching to the server. Your Zod schemas in
`src/lib/schemas.ts` were already written framework-agnostic for exactly this.

---

### 2.3 🟠 Payments — model the booking state machine *before* writing integration code

- [ ] Design the booking state machine
- [ ] Add seat-hold + expiry so inventory isn't oversold during checkout
- [ ] Webhook-driven confirmation (never client-confirmed) + idempotency key
- [ ] Then integrate the gateway

Given the `IndianRupee` icon used throughout the UI, the target market appears to be India —
**Razorpay or Cashfree over Stripe**, because they give you UPI, which is table stakes there
in a way Stripe isn't. (Adjust if that assumption is wrong.)

The integration is not the hard part. Today `join_trek_and_chat` confirms a seat instantly
and `estimated_cost` is decorative. Money forces a lifecycle you don't have:

```
pending_payment → paid → confirmed → completed
                ↘ expired   ↘ cancelled → refunded
```

Plus policy decisions with no current home: cancellation windows, refund rules, company-side
booking confirmation, no-show handling. **Model this first** — it's the part that's expensive
to retrofit once real bookings exist.

---

### 2.4 🟠 Adopt real migrations

- [ ] Create `supabase/migrations/NNNN_description.sql`, append-only, applied in order
- [ ] Demote `schema.sql` to a generated artifact rather than a hand-edited one

Hand-maintained SQL files carry no proof of what's actually deployed — §1.3 is a worked example
of a status comment outliving its truth and producing a false critical finding. That's not a
discipline failure — it's the method failing at this scale. You can still paste migrations
into the SQL Editor by hand; you gain an ordered, replayable history and the ability to
rebuild a dev database from scratch.

---

## §3 — Performance

### 3.1 🟠 Missing indexes on the chat hot path

- [ ] Verify against the live DB (MCP was unauthorized at review time), then apply

Checked every `create index` across `schema.sql`, `migration-multi-tenant.sql`, and
`phases/*.sql`. Two real gaps:

- **`conversation_messages` has no index on `conversation_id`.** PK is `(created_at, id)`.
  The fetch at `src/app/messages/page.tsx:166` filters
  `.eq('conversation_id', …).order('created_at', desc).limit(30)` — a sequential scan on your
  largest, fastest-growing table. Fine at 500 rows; cliff-edge at 50k.
- **`conversation_participants` has no `user_id`-leading index.** The unique constraint is
  `(conversation_id, user_id)`, but "list my conversations" (`messages/page.tsx:122`) queries
  by `user_id` alone.

```sql
create index if not exists conversation_messages_conv_created_idx
  on public.conversation_messages (conversation_id, created_at desc);

create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id);

-- Unindexed FKs (lower priority — slow joins and slow cascading deletes)
create index if not exists favorites_trek_id_idx     on public.favorites (trek_id);
create index if not exists trek_reviews_user_id_idx  on public.trek_reviews (user_id);
create index if not exists trek_batches_trek_id_idx  on public.trek_batches (trek_id);
```

### 3.2 🟡 Trek detail page fetching

- [ ] Replace `select('*')` at `src/app/trek/[id]/page.tsx:98` with an explicit column list
- [ ] Parallelize the trek → participant-count → reviews waterfall (`Promise.all`)
- [ ] Finish the TanStack migration here and on `/profile` (last manual `useEffect` fetches)

### 3.3 🟡 Messages page effect churn

- [ ] `src/app/messages/page.tsx:163` — the init effect lists `conversations` in its deps, so
      it re-runs on every conversation-list change. Use a ref or narrow the dependency.

---

## §4 — Security hardening

### 4.1 🟡 No security headers at all

- [ ] Add a `headers()` block to `next.config.mjs`: CSP, HSTS, `X-Frame-Options: DENY`,
      `Referrer-Policy`, `X-Content-Type-Options: nosniff`

Currently there is none. For an app where the browser holds the auth token, clickjacking and
XSS defense-in-depth matter.

### 4.2 🟡 No rate limiting

- [ ] Once §2.1 exists, add Upstash Redis limits on auth, `apply_for_company`, and chat send

### 4.3 🟡 Raw Supabase errors reach logs

- [ ] Audit `console.error(error)` sites — with Sentry wired, DB detail may land in your
      error dashboard. `src/lib/company.ts` already models the right pattern (allowlisted
      user-facing messages, generic fallback); apply it consistently.

### 4.4 🟡 Optional advisor cleanup

- [ ] Revoke `anon` EXECUTE on the company action RPCs (incl. `get_company_members`,
      `invite_company_member`) to silence `anon_security_definer_function_executable` WARNs.
      They already fail safely via internal `auth.uid()` / `is_company_*` /
      `is_platform_admin()` checks — this is noise reduction, not a live hole.

---

## §5 — Testing

### 5.1 🟡 Coverage is thin exactly where risk is highest

- [ ] Add RLS integration tests (pgTAP, or Vitest with two authenticated clients)
- [ ] Add tests for `src/lib/company.ts`

26 tests exist: Zod schemas plus two presentational components. **Zero** tests on
`src/lib/company.ts` (830 lines of business-critical multi-tenant logic) and **zero** on RLS
policies — which *are* your security model.

Highest-value assertions to write first:

| Assertion |
|---|
| User B cannot read User A's `trek_participants` row |
| `anon` sees no `pending` company |
| A suspended company's treks vanish from `search_treks` |
| A non-owner cannot `PATCH` `companies.slug` |
| A non-member gets an empty set from `get_company_batch_participants` |

Your test suite currently does not cover the thing most likely to break catastrophically.

---

## §6 — Product gaps

| Feature | Status | Note |
|---|---|---|
| Payments | ❌ | See §2.3 — `estimated_cost` is display-only; no revenue path exists |
| Booking lifecycle | ❌ | No cancellation, refunds, company-side confirmation, or no-show handling |
| Notifications | ❌ | Edge functions written and idle. Booking confirmation + departure reminders are the highest-value emails — wire these first after §2.1 |
| Maps | ❌ | `meeting_point` is free text; no geocoding, no map pin |

---

## §7 — Code hygiene / dead code

- [ ] Delete `src/lib/database.ts` — 199 lines, dead, wrong tables, documented as dead for months
- [ ] Delete `src/components/ui/Chat.tsx` — stub
- [ ] Delete `src/components/ui/favcard2.tsx` — duplicate of `FavCard`
- [ ] Delete `src/app/edits/` — **decided 2026-08-05: `/profile/edit` is the real profile editor.** `/edits` is the duplicate: nothing links to it (the only reference anywhere is the `robots.ts` disallow list), so it is reachable only by typing the URL. Both were kept in sync during the storage rate-limit work (`compressImage()` + `uploadErrors` wired into each), so deleting `/edits` loses nothing. Note the two use different avatar path layouts — `/edits` writes `{uid}.{ext}` (fixed path, upsert-overwrite), `/profile/edit` writes `{uid}/{ts}.{ext}` (new object each time); the storage RLS policy accepts both, so removing `/edits` does not need a policy change. Remove `'/edits'` from `src/app/robots.ts` at the same time
- [ ] Delete one of `postcss.config.js` / `postcss.config.mjs` — one is ignored
- [ ] Drop the unused `mood` enum and the dead `increment_participants` RPC (Phase 0 NEW-5).
      **Keep `update_participants_count()`** — it backs the `participants_joined` counter.
- [ ] Consolidate the two Supabase client styles (`lib/supabase.ts` vs `utils/supabase/*`)

Roughly 500 lines of pure noise that misleads every future reader.

---

## Suggested order of work

| # | Work | Effort | Removes |
|---|---|---|---|
| 1 | §1.1 commit + push | 5 min | Total-loss risk; ships multi-tenant to prod |
| 2 | §1.2 delete `/test` | 10 min | Public recon surface |
| ~~3~~ | ~~§1.3 apply pending SQL~~ — already applied, no work | — | — |
| 4 | §3.1 indexes | 15 min | Chat scaling cliff |
| 5 | §4.1 security headers | 20 min | Clickjacking / XSS depth |
| 6 | §2.1 + §2.2 server layer **and** SSR/SEO together | days | Unblocks revenue + organic growth |
| 7 | §5.1 RLS tests | days | Protects the security model |
| 8 | §2.3 payments | weeks | Revenue |
| 9 | §7 dead code, §3.2–3.3, §6 notifications | ongoing | Noise, latency, retention |

Items 1–5 take one afternoon and clear both remaining critical risks (§1.3 needed no work).
