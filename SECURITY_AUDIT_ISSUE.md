# Security Hardening — remaining items

Open security/hardening tasks for the Trekker app, verified against the **live Supabase database** (policies, function definitions, advisors). This is a client-side + anon-key app, so RLS / RPC / storage-policy correctness is the primary attack surface.

> The Critical/High issues (RPC impersonation, public PII reads, world-writable batches, `.env.local` in git) are already fixed. The items below are what's left.

## Checklist
- [ ] CRIT-1 — rotate leaked service_role key + source notification-trigger token from Vault *(SQL ready; rotation + apply pending — see below)*
- [ ] M-dos — harden `join_trek_and_chat` (require caller, validate batch date) *(SQL ready; apply pending)*
- [ ] M-update — drop `trek_participants` UPDATE policy *(SQL ready; apply pending)*
- [x] NEW-1 — pin `search_path` on `is_chat_participant` (SECURITY DEFINER) + 7 hygiene functions
- [x] M1 — scope avatar storage writes to the owning user
- [x] NEW-2 — move signup profile creation to a DB trigger
- [x] NEW-3 — require trek-joined to review + drop duplicate policies
- [x] NEW-4 — restrict `trek_participants` read access
- [ ] NEW-5 — remove dead/broken participant-count code
- [ ] M2 — re-enable middleware route guard
- [ ] M3 — stop suppressing type/lint errors at build
- [ ] Advisor — enable leaked-password protection
- [ ] Advisor — apply Postgres security patch
- [ ] Advisor — restrict public bucket listing

---

### 🔴 CRIT-1 — Live `service_role` JWT hard-coded in two notification triggers
The `"trek-join-notification"` / `"trek-leave-notification"` triggers on `trek_participants` embedded a real, long-lived `service_role` JWT (`role:service_role`, `exp` ≈ 2035) as a plaintext literal in the `supabase_functions.http_request` Authorization header. `service_role` bypasses **all** RLS and storage policies, so possession = total read/write of every table and bucket. Not pullable anonymously over REST (PostgREST doesn't expose `pg_catalog`), but it's a secret at rest exposed to anything reading DDL / backups / logs — and the committed `schema.sql` had it masked to `REPLACE_WITH_SERVICE_ROLE_KEY`, hiding that the live DB held the real key. Confirmed live via `pg_get_triggerdef` (2026-06-16).

**Key insight:** the trigger never needed `service_role`. Both edge functions run `verify_jwt = true` and read `SUPABASE_SERVICE_ROLE_KEY` from their **own env**; the Authorization header is only used to pass the gateway, which any valid JWT (incl. the public **anon** key) satisfies.

**Fix** (DDL in `supabase/migrations/20260616000000_*.sql`, rationale in `security-fixes.sql` CRIT-1):
1. **Rotate** the leaked key in the dashboard (Project Settings → API → "Reset service_role"). *This is the only step that invalidates the exposed key — it cannot be automated; do it first.* Update any deployment/env still using the old value.
2. Replace the literal-key triggers with `notify_trek_participation()`, which reads a **webhook secret** from Vault (`edge_function_token`) and sends it on the `x-trek-webhook-secret` header (the public publishable key rides on `apikey` for routing). SECURITY DEFINER + fail-safe.
3. Migrate to the new API key system (the new keys are **not JWTs**, so they fail edge-function `verify_jwt` and can't be `Authorization: Bearer`):
   - client → publishable key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`);
   - both edge functions → `verify_jwt=false`, admin client from `SUPABASE_SECRET_KEYS`, authorize on `TREK_WEBHOOK_SECRET` (new `index.ts` committed under `supabase/functions/`);
   - generate a webhook secret (`openssl rand -hex 32`), set it as `TREK_WEBHOOK_SECRET` on both functions, and store the same value in Vault:
     ```sql
     select vault.create_secret('<WEBHOOK_SECRET>', 'edge_function_token',
       'Webhook secret the trek_participants triggers send to the edge functions');
     ```
4. **Deactivate the legacy `anon`/`service_role` keys** in the dashboard — this is what finally kills the leaked key (the powerful secret key now lives only in the edge-function env, never in the DB). **Status:** all SQL + function code authored; not applied (MCP read-only). Migration + deactivation pending.

### 🟠 M-dos — `join_trek_and_chat` allows batch/chat spam (DoS)
Any authenticated user could loop the RPC over unbounded future dates to mass-create `trek_batches` + `conversations` (tables they can't otherwise write). No date validation, no rate limit, and the `p_user_id = NULL` path skipped the caller check. **Fix:** require `p_user_id = auth.uid()` (no NULL bypass); validate `p_batch_date` (not null, not past with 1-day tz grace, within `current_date + 1 year`) so the unique `(trek_id, batch_date)` constraint bounds creation; pin `search_path`. Long-term: split batch creation out of the join path (admin-created batches). **Status:** SQL ready in `schema.sql` + migration; apply pending.

### 🟠 M-update — `trek_participants` UPDATE has no effective guard
Policy `"Users can update own participation"` used `USING (auth.uid() = user_id)` with no `WITH CHECK`. A user could change their row's `batch_id` to any batch — relocating into a chat they were never added to and satisfying the `trek_reviews` join-gate (NEW-3) for a trek they never joined. `WITH CHECK` can't fix it (it can't reference the OLD row, so "batch_id unchanged" is inexpressible). **Fix:** drop the UPDATE policy — join = INSERT, leave = DELETE, no app code updates this table, so UPDATE is now default-denied. **Status:** SQL ready in `schema.sql` + migration; apply pending.

### 🔴 NEW-1 — `is_chat_participant` is SECURITY DEFINER with an unpinned `search_path`
The function gating the **entire chat ACL** (used by all `conversation_messages` / `conversation_participants` policies) is `SECURITY DEFINER` but has no `SET search_path` (`proconfig: null`). Classic privilege-escalation vector — a user can shadow `conversation_participants`/`auth.uid()` via an earlier schema on their `search_path` and gain read/write to all chats.
**Fix:**
```sql
ALTER FUNCTION public.is_chat_participant(uuid) SET search_path = public, pg_temp;
```
(6 other `SECURITY INVOKER` functions are also flagged `function_search_path_mutable` — pin them too for hygiene.)

### 🟠 M1 — Avatar storage writes not scoped to owner
`avatars` bucket INSERT/UPDATE/DELETE policies only check `bucket_id = 'avatars'`, so any authenticated user can overwrite/delete **anyone's** avatar. (The `trek-reviews` bucket already does this correctly.)
**Fix:** gate writes on the object path belonging to `auth.uid()` (accept both `avatars/{uid}/file` and `avatars/{uid}.ext` shapes). SQL is in `supabase/security-fixes.sql`. **Applied & verified live (2026-06-13):** all three `avatars` write policies (INSERT/UPDATE/DELETE) now carry the ownership check `(storage.foldername(name))[1] = auth.uid()::text OR name like auth.uid()::text || '.%'` — confirmed via `pg_policies`; the security advisor reports no broad-write finding for the bucket.

### 🟠 NEW-2 — Profile creation on signup is client-side and fails silently
`src/lib/auth.ts:41` inserts the `profiles` row from the browser after `signUp()`. With email confirmation enabled there is **no session** → the insert runs as `anon` → RLS rejects it → user has **no profile row**, and the error is only `console.error`'d.
**Fix:** move to a `handle_new_user()` trigger on `auth.users` (`SECURITY DEFINER`); remove the client-side insert. **Done:** trigger SQL added to `supabase/security-fixes.sql` (NEW-2 block) and the client-side insert removed from `src/lib/auth.ts`. Note the old insert never set the NOT NULL/unique `email` column either, so it could not have succeeded even with a session — the trigger populates `id`, `email`, and `full_name` from the new `auth.users` row. **Still to apply live:** run the NEW-2 block against the DB (MCP was read-only this session).

### 🟠 NEW-3 — Anyone can review a trek they never joined + duplicate policies
Policy `"Users can review treks they joined"` only checks `auth.uid() = user_id` — it never verifies the user joined → fake reviews / rating manipulation. `trek_reviews` and `user_stats` also have **duplicate** SELECT/INSERT policies (drift).
**Fix:** require a matching `trek_participants` row for the trek; drop the duplicate policies. **Done:** SQL added to `supabase/security-fixes.sql` (NEW-3 block) and `supabase/policies.sql` hardened. The single INSERT policy now gates on `EXISTS (trek_participants → trek_batches WHERE tb.trek_id = trek_reviews.trek_id)`; the duplicate `trek_reviews` SELECT and `user_stats` SELECT policies are dropped. **Still to apply live:** run the NEW-3 block in the Supabase SQL editor (MCP write was declined this session).

### 🟡 NEW-4 — `trek_participants` is world-readable (`USING (true)`)
Combined with the `public_profiles` view, anyone (incl. logged-out) can enumerate which users joined which trek — social-graph/privacy leak. Live SELECT policy was `"Anyone can view trek participants"` → role `public`, `USING (true)`.
**Fix:** restrict SELECT to the user's **own rows** (`TO authenticated USING (user_id = auth.uid())`). **Done:** SQL added to `supabase/security-fixes.sql` (NEW-4 block) and `supabase/policies.sql` updated. Chosen own-rows rather than the audit's "authenticated only" note because no app feature reads other users' participation — every production query filters by `user_id = auth.uid()` (verified in `src/app/trek/[id]/page.tsx`, `src/app/profile/page.tsx`, `src/lib/joinTrek.ts`); co-trekker visibility is via chat (`conversation_participants`), counts via `get_trek_participant_count` (SECURITY DEFINER). Own-rows also blocks cross-user enumeration by logged-in users and avoids the infinite-recursion trap (Postgres `42P17`) of a batch-scoped policy that subqueries `trek_participants` from its own `USING` clause. **Applied & verified live (2026-06-13):** `pg_policies` shows the only SELECT policy on `trek_participants` is `"Users can view own trek participation"` → `{authenticated}` → `(user_id = auth.uid())`.

### 🟡 NEW-5 — Dead/broken participant-count code (correctness)
- `src/lib/database.ts:85` calls `rpc('increment_participants')` — **the function does not exist** → call always errors; `treks.participants_joined` is never maintained through it.
- `update_participants_count()` references `trek_participants.trek_id` (column doesn't exist — table has `batch_id`) and is **not attached to any trigger** → dead, broken code.
**Fix:** remove the dead RPC call / function, or implement a correct trigger to maintain the counter.

### 🟡 M2 — Middleware route guard commented out
`src/utils/supabase/middleware.ts` refreshes the session but the redirect-to-login block is disabled → route protection is client-side only.
**Fix:** re-enable server-side route protection for authenticated areas.

### 🟡 M3 — Build suppresses type & lint errors
`next.config.js` sets `eslint.ignoreDuringBuilds: true` and `typescript.ignoreBuildErrors: true` → type-unsafe/lint-flagged code can ship.
**Fix:** remove both; resolve surfaced errors.

---

## ⚙️ Supabase advisor items (dashboard actions)
- **Leaked-password protection disabled** — enable in Auth settings (HaveIBeenPwned check). Also raise min password length to ≥12 (app currently allows 6).
- **Postgres has pending security patches** — upgrade via Project Settings → Infrastructure (brief downtime; back up first).
- **Public bucket listing** — `avatars` and `trek-reviews` have broad SELECT policies allowing clients to list all files; public object URLs don't need this.

## Low / cleanup
- **L2** — verbose error logging (`JSON.stringify(error)`) leaks DB detail to console; strip in prod.
- **L3** — no app-level rate limiting / security headers.
- **L4** — test pages shipped in App Router (`src/app/test/*`) are routable in production; remove or guard.
- **L5** — run `npm audit` for dependency CVEs.
- **M5** — consolidate overlapping SQL policy files into a single source of truth (`supabase/security-fixes.sql` started this).
