# Organizer Feature — Implementation Plan

> Status: **PLAN ONLY — not implemented.** This document is the complete design for adding an
> organizer role that can create, edit, and delete treks and manage all activity around them.
> No code or DB changes have been made yet. Per project rules, all DB changes are applied
> manually by the user in the Supabase SQL Editor (the MCP server is read-only).

---

## 1. Goal & Scope

Add an **Organizer** capability so a qualifying user can:

1. **Create** a trek (title, description, location, difficulty, distance, cost, gear, cover image, etc.).
2. **Edit** their own treks.
3. **Delete / archive** their own treks (safely, respecting existing participants).
4. **Manage batches** (dated departures): add, edit capacity/date, cancel.
5. **Manage activity** around their treks: view per-batch participant rosters (incl. waitlist),
   remove a participant, see counts/ratings, and be present in each batch chat.
6. See an **Organizer Dashboard** that aggregates the above, gated to organizer/admin users.

### In scope (Phase 1)
Per-user organizer ownership (one user owns the treks they create). This matches the existing
data model and the dormant `user_stats.treks_organised` counter.

### Out of scope (noted as Phase 2 / open questions)
A separate **organization** entity (a brand with multiple staff members, shared treks, org
profile page). The phrase "their org" could mean this. See §11 — this is the main decision to
confirm before building.

---

## 2. Current State (grounded in the codebase)

What exists today, and why this feature is a clean fit:

| Area | Current state | Source |
|------|---------------|--------|
| `treks` table | **No owner column.** Publicly readable; no INSERT/UPDATE/DELETE RLS — treks are SQL-seeded only. | `supabase/schema.sql:73-99`, `:1151-1152` |
| `profiles` table | **No role column.** | `supabase/schema.sql:58-71` |
| `user_stats.treks_organised` | Column exists but "stays 0 (no organiser column yet)". | `supabase/schema.sql:183-192`, `DATABASE.md:170` |
| Profile UI | Already renders an **"Organized"** stat and `role === 'Organizer'` badges (currently mock/zero). | `src/app/profile/page.tsx:306-307,332` |
| About page | Already describes "Organizer Responsibilities" conceptually. | `src/app/about/page.tsx:108-160` |
| Explore "Create Your Own Trek" button | Exists but is a no-op (no handler). | `src/app/explore/page.tsx` CTA section |
| Feature tracker | `Organizer / admin UI ❌ — Treks still SQL-seeded; no create/edit UI, no role, no server layer`. | `FEATURES.md:29` |
| Join flow | `join_trek_and_chat` RPC (SECURITY DEFINER) auto-creates batch + conversation, derives `auth.uid()`, validates caller acts as self. **Template to follow for new RPCs.** | `supabase/schema.sql:305-420` |
| Participant RLS | Users can SELECT/INSERT/DELETE only their **own** `trek_participants` rows. Organizers therefore **cannot** read other participants without a new policy or a SECURITY DEFINER RPC. | `supabase/schema.sql:1159-1169` |
| Stats maintenance | `update_participants_count()` keeps `treks.participants_joined`; `recompute_user_stats()` rebuilds `user_stats`. | `supabase/schema.sql:825-857, 585-646` |
| Storage | Bucket `trek-profile` exists (public) but has **no write policy** — cover-image upload isn't possible from the client yet. | `supabase/schema.sql:1249`; no policy in `:1247-1292` |
| Route guard | Middleware treats `['/', '/explore', '/about', '/auth', '/trek', '/test']` as public; everything else requires a logged-in user. No role-based gating. | `src/utils/supabase/middleware.ts:42-53` |
| Image upload helper | `compressImage()` + `sanitizeFileName()`; store under `{uid}/filename`. | `src/utils/imageCompression.ts`, CLAUDE.md |
| Data layer | Reads via `supabase.rpc('search_treks', …)` and TanStack Query hooks in `src/lib/queries.ts`; favorites use direct table mutations with optimistic updates. | `src/lib/queries.ts` |

**Security model reminder:** there is no app server. All access control is Postgres RLS + SECURITY
DEFINER RPCs deriving the actor from `auth.uid()`. The client UI gate is convenience only — RLS is
the real boundary.

---

## 3. Design Decisions

### 3.1 Ownership model — **per-trek owner column (recommended)**
Add `treks.organizer_id uuid references profiles(id)`. The creator owns the trek. Simple, matches
`treks_organised`, and lets RLS scope writes with `organizer_id = auth.uid()`.

> Alternative (Phase 2): an `organizations` table + `organization_members`, with `treks.org_id`.
> Bigger surface (org CRUD, member roles, org profile). Defer unless the user wants true multi-staff orgs.

### 3.2 Role model — **`profiles.role` enum (recommended)**
Add enum `user_role as ('trekker','organizer','admin')`, column `profiles.role default 'trekker'`.
Gate organizer features on `role in ('organizer','admin')`. Extensible to admin later. (A simple
`is_organizer boolean` also works but an enum leaves room for `admin` without a second migration.)

### 3.3 Becoming an organizer — **self-service apply (Phase 1), admin approval later**
Phase 1: an RPC `become_organizer()` flips the caller's own role to `organizer`. Lowest friction.
If you'd rather vet organizers, make it `admin`-granted instead (see §11).

### 3.4 Create/edit/delete mechanism — **owner-scoped RLS for treks/batches; SECURITY DEFINER RPCs for cross-user reads/writes**
- Trek + batch CRUD: plain table RLS scoped to ownership (simple, no RPC needed).
- Roster read, participant removal, guarded delete, stats: SECURITY DEFINER RPCs (they touch other
  users' rows or need validation) — consistent with `join_trek_and_chat`.

### 3.5 Draft vs published, and delete safety
- Add `treks.status text` (`'draft' | 'published' | 'archived'`, default `'draft'`). Explore/home
  must show **published only**.
- **Delete safety:** a trek with batches that have participants must **not** be hard-deleted (it
  would strand bookings + chats). Rule: hard-delete only when the trek has zero participants across
  all batches; otherwise **archive** (`status='archived'`, hidden from discovery, existing bookings
  preserved). A guarded RPC enforces this.

---

## 4. Database Changes (exact SQL — apply in Supabase SQL Editor)

> Order matters. Apply top-to-bottom. After applying, update `supabase/schema.sql`,
> `supabase/security-fixes.sql`, `DATABASE.md`, and `FEATURES.md` to match (see §7).

### 4.1 Enum + columns
```sql
-- Role enum + column
do $$ begin
  create type public.user_role as enum ('trekker','organizer','admin');
exception when duplicate_object then null; end $$;

alter table public.profiles
  add column if not exists role public.user_role not null default 'trekker';

-- Trek ownership + lifecycle
alter table public.treks
  add column if not exists organizer_id uuid references public.profiles(id),
  add column if not exists status text not null default 'draft'
    check (status in ('draft','published','archived')),
  add column if not exists created_at timestamptz default now();

create index if not exists treks_organizer_id_idx on public.treks (organizer_id);
create index if not exists treks_status_idx        on public.treks (status);
```

> Note: existing SQL-seeded treks will have `organizer_id = NULL` and `status='draft'`. Decide
> whether to backfill them to `'published'` (and to an admin owner) so they stay visible — see §11.
> A one-liner: `update public.treks set status='published' where organizer_id is null;`

### 4.2 RLS — treks (replace the read-only policy set)
```sql
-- Discovery should show published treks to everyone; owners see their own drafts.
drop policy if exists "view all treks" on public.treks;
create policy "view published or own treks" on public.treks
  for select to public
  using (status = 'published' or organizer_id = auth.uid());

-- Only organizers/admins can create, and only as themselves.
create policy "organizers insert own treks" on public.treks
  for insert to authenticated
  with check (
    organizer_id = auth.uid()
    and exists (select 1 from public.profiles p
                where p.id = auth.uid() and p.role in ('organizer','admin'))
  );

create policy "organizers update own treks" on public.treks
  for update to authenticated
  using (organizer_id = auth.uid())
  with check (organizer_id = auth.uid());

-- Direct delete is owner-only AND only when safe; the guarded RPC (4.5) is the
-- intended path. This policy is the backstop.
create policy "organizers delete own treks" on public.treks
  for delete to authenticated
  using (organizer_id = auth.uid());
```

> ⚠️ `search_treks` is SECURITY INVOKER/STABLE and currently returns all treks. With the new SELECT
> policy it will still return published treks for anon/auth callers (good), but **must also add an
> explicit `status = 'published'` filter** so an organizer's own drafts don't leak into public
> Explore results for that organizer. See §4.6.

### 4.3 RLS — trek_batches (owner-scoped writes)
```sql
-- SELECT stays public (existing "Anyone can view trek batches").
create policy "organizers insert batches for own treks" on public.trek_batches
  for insert to authenticated
  with check (exists (select 1 from public.treks t
                      where t.id = trek_id and t.organizer_id = auth.uid()));

create policy "organizers update batches for own treks" on public.trek_batches
  for update to authenticated
  using (exists (select 1 from public.treks t
                 where t.id = trek_id and t.organizer_id = auth.uid()));

create policy "organizers delete batches for own treks" on public.trek_batches
  for delete to authenticated
  using (exists (select 1 from public.treks t
                 where t.id = trek_id and t.organizer_id = auth.uid()));
```
> The participant join path (`join_trek_and_chat`) is SECURITY DEFINER and bypasses RLS, so adding
> these batch write policies does **not** break joining. Verify after applying.

### 4.4 Roster read RPC (organizers see participants of their own treks)
`trek_participants` SELECT RLS is own-row only. Add a SECURITY DEFINER RPC instead of broadening RLS:
```sql
create or replace function public.get_batch_roster(p_batch_id uuid)
returns table (
  participant_id uuid, user_id uuid, full_name text, avatar_url text,
  status text, joined_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.trek_batches b
    join public.treks t on t.id = b.trek_id
    where b.id = p_batch_id and t.organizer_id = auth.uid()
  ) then
    raise exception 'Not authorized for this batch';
  end if;

  return query
  select tp.id, tp.user_id, pr.full_name, pr.avatar_url, tp.status, tp.joined_at
  from public.trek_participants tp
  join public.profiles pr on pr.id = tp.user_id
  where tp.batch_id = p_batch_id
  order by (tp.status = 'waitlisted'), tp.joined_at;  -- confirmed first, FIFO
end $$;

revoke all on function public.get_batch_roster(uuid) from public;
grant execute on function public.get_batch_roster(uuid) to authenticated;
```

### 4.5 Guarded delete / archive RPC
```sql
create or replace function public.organizer_delete_trek(p_trek_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_has_participants boolean;
begin
  if not exists (select 1 from public.treks
                 where id = p_trek_id and organizer_id = auth.uid()) then
    raise exception 'Not authorized or trek not found';
  end if;

  select exists (
    select 1 from public.trek_participants tp
    join public.trek_batches b on b.id = tp.batch_id
    where b.trek_id = p_trek_id
  ) into v_has_participants;

  if v_has_participants then
    update public.treks set status = 'archived' where id = p_trek_id;
    return jsonb_build_object('action','archived');
  end if;

  -- No participants → safe hard delete. Remove dependents first (no ON DELETE
  -- CASCADE on these FKs today): favorites, conversations(+participants/messages)
  -- for the trek's batches, the batches, then the trek.
  delete from public.favorites where trek_id = p_trek_id;
  delete from public.conversation_messages cm using public.conversations c
    join public.trek_batches b on b.id = c.batch_id
    where cm.conversation_id = c.id and b.trek_id = p_trek_id;
  delete from public.conversation_participants cp using public.conversations c
    join public.trek_batches b on b.id = c.batch_id
    where cp.conversation_id = c.id and b.trek_id = p_trek_id;
  delete from public.conversations c using public.trek_batches b
    where c.batch_id = b.id and b.trek_id = p_trek_id;
  delete from public.trek_batches where trek_id = p_trek_id;
  delete from public.trek_reviews where trek_id = p_trek_id;
  delete from public.treks where id = p_trek_id;
  return jsonb_build_object('action','deleted');
end $$;

revoke all on function public.organizer_delete_trek(uuid) from public;
grant execute on function public.organizer_delete_trek(uuid) to authenticated;
```
> ⚠️ Verify the exact FK list against `schema.sql` before applying (favorites, trek_reviews,
> trek_batches, conversations, conversation_participants, conversation_messages all reference into
> this graph). An alternative is to add `ON DELETE CASCADE` to those FKs and simplify the RPC — but
> that's a broader migration; the explicit deletes above are surgical.

### 4.6 Update `search_treks` to publish-filter
In the WHERE clause of `search_treks` (`supabase/schema.sql:465+`), add `and t.status = 'published'`
(adjust alias to match the function body) so drafts/archived treks never appear in Explore/home.
This is the single most important read-path change — without it, drafts leak.

### 4.7 Optional: participant removal RPC
If organizers can remove a participant, add `organizer_remove_participant(p_participant_id uuid)`
(SECURITY DEFINER, verify caller owns the trek, then delete the row and reuse the existing
`promote_waitlist_on_leave()` logic / let its trigger fire). Confirm whether the waitlist-promotion
trigger fires on organizer-initiated deletes.

### 4.8 `become_organizer` RPC (self-service role grant — Phase 1)
```sql
create or replace function public.become_organizer()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.profiles set role = 'organizer'
  where id = auth.uid() and role = 'trekker';
end $$;
revoke all on function public.become_organizer() from public;
grant execute on function public.become_organizer() to authenticated;
```
> If you prefer admin-vetted organizers, drop this and grant the role manually / via an admin tool.

### 4.9 Wire up `treks_organised` stat
In `recompute_user_stats()` (`schema.sql:585`), set `treks_organised` =
`count(*) from treks where organizer_id = p_user_id and status <> 'archived'`. Optionally add a
trigger on `treks` (insert/update/delete) calling the existing recompute path so the profile
"Organized" number stays live. Low priority — can be a follow-up.

### 4.10 Storage policy — cover images for `trek-profile`
Bucket exists but has no write policy. Add organizer-scoped, `{uid}/...`-pathed writes (mirrors the
avatars policy at `schema.sql:1265-1275`):
```sql
create policy "Organizers can upload trek covers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trek-profile'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p
                where p.id = auth.uid() and p.role in ('organizer','admin')));

create policy "Organizers can update own trek covers" on storage.objects
  for update to authenticated
  using (bucket_id = 'trek-profile' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Organizers can delete own trek covers" on storage.objects
  for delete to authenticated
  using (bucket_id = 'trek-profile' and (storage.foldername(name))[1] = auth.uid()::text);
```
Public read already works (bucket is public; matches how cover URLs are rendered today).

---

## 5. App / Client Changes (file-by-file)

### 5.1 Types & auth context
- **`src/contexts/AuthContext.tsx`** — expose the user's `role` (fetch from `profiles` alongside the
  session, or via `get_user_profile`). Add a derived `isOrganizer` boolean for convenient gating.
  Keeps a single source of truth for the UI gate.
- **`src/lib/queries.ts`** — extend the trek interfaces with `organizer_id` / `status` where needed.

### 5.2 New data-layer module — `src/lib/organizer.ts`
Co-locate organizer reads/writes (mirrors `src/lib/joinTrek.ts`):
- `createTrek(input)` → insert into `treks` (RLS enforces role + ownership); returns new id.
- `updateTrek(id, patch)` → update.
- `deleteTrek(id)` → `supabase.rpc('organizer_delete_trek', { p_trek_id: id })` (returns
  `archived | deleted` so the UI can message correctly).
- `listMyTreks()` → select where `organizer_id = auth.uid()` (all statuses).
- `addBatch / updateBatch / deleteBatch`.
- `getBatchRoster(batchId)` → `supabase.rpc('get_batch_roster', …)`.
- `becomeOrganizer()` → `supabase.rpc('become_organizer')`.
- Each handles `.data` **and** `.error`, logs but doesn't surface raw Supabase errors (per CLAUDE.md).

### 5.3 TanStack Query hooks (in `queries.ts`, matching existing style)
- `useMyTreks()`, `useBatchRoster(batchId)` (reads).
- `useCreateTrek()`, `useUpdateTrek()`, `useDeleteTrek()`, `useBatchMutations()` (writes) — invalidate
  `queryKeys.featuredTreks`, the relevant `searchTreks` keys, and a new `queryKeys.myTreks(userId)`.
- Add `myTreks`/`batchRoster` to the `queryKeys` registry so invalidation stays centralized.

### 5.4 Routes / pages (App Router under `src/app/organizer/`)
- `organizer/page.tsx` — **Dashboard**: list my treks (status chips), quick stats, "New trek" CTA.
- `organizer/treks/new/page.tsx` — **Create** form (reuse field set from the `treks` columns).
- `organizer/treks/[id]/edit/page.tsx` — **Edit** form + Delete/Archive button (with
  `ConfirmationModal`, which already exists).
- `organizer/treks/[id]/page.tsx` — **Manage** view: batches list, per-batch roster (confirmed +
  waitlist), participant counts, link into the batch chat.
- Reuse `src/components/ui/` pieces; extract a `TrekForm` component shared by new/edit.

### 5.5 Cover image upload
Use `compressImage()` + `sanitizeFileName()`; upload to `trek-profile/{uid}/{filename}`; store the
public URL in `treks.cover_image_url`. Never put PII in filenames (CLAUDE.md).

### 5.6 Route gating
- **DB/RLS is the real guard** (already covered).
- **UX guard:** in the `organizer/*` layout (client), redirect non-organizers to `/` or to a
  "Become an organizer" prompt. Optionally extend `src/utils/supabase/middleware.ts` to redirect
  `/organizer/*` for logged-out users (it already protects non-public routes, so logged-out users
  are bounced to `/auth/login` automatically — only the *role* check needs adding, and that's
  cheapest in the page/layout since middleware would need a DB round-trip for the role).

### 5.7 Entry points / wiring existing UI
- **Explore "Create Your Own Trek"** button → route to `organizer/treks/new` (or the become-organizer
  prompt if not yet an organizer). Currently a no-op.
- **Profile page** → add an "Organizer Dashboard" link when `isOrganizer`; the "Organized" stat and
  role badge already exist and will now be backed by real data.
- **Navbar** (`src/components/layout/`) → conditional "Organizer" link for organizers.

### 5.8 Organizer ↔ chat presence
Decide whether the organizer is auto-added to each batch conversation on batch creation (so they can
coordinate). If yes, add the organizer to `conversation_participants` when a batch's conversation is
created (the conversation is currently created lazily on first join via `join_trek_and_chat`).
Simplest: when an organizer opens a batch's chat, ensure membership via a small SECURITY DEFINER RPC
`ensure_organizer_in_chat(batch_id)`. Flag as a decision (§11).

---

## 6. Trek Detail Page — organizer surfacing (optional, Phase 1.5)
On `src/app/trek/[id]/page.tsx`, optionally show the organizer's name/avatar ("Organized by …") and,
if the viewer **is** the owner, an inline "Manage" button → `organizer/treks/[id]`. Requires
selecting `organizer_id` (+ joined profile) in the detail query.

---

## 7. Docs / Reference Files to Update (same change set)
Per CLAUDE.md, after the SQL is applied and the UI lands:
- **`supabase/schema.sql`** — add the enum, columns, indexes, new/changed RLS, new RPCs, storage
  policies, and the `search_treks` publish filter.
- **`supabase/security-fixes.sql`** — append an entry explaining the new RLS surface (treks/batches
  writable by owners; roster/delete RPCs; storage policy) and the threat model.
- **`DATABASE.md`** — document `profiles.role`, `treks.organizer_id`/`status`, the new RPCs, and the
  `treks_organised` source change.
- **`CONTEXT.md`** — note the organizer flow in the architecture section.
- **`FEATURES.md`** — move `Organizer / admin UI` from §1 (To do, ❌) toward §2 (Done, ✅/🟡) as parts
  ship; add evidence (files + `schema.sql` sections); bump "Last updated". Track any deferred pieces
  (org entity, admin approval, participant removal, chat presence) as new §1 follow-ups.

---

## 8. Security Considerations / Checklist
- [ ] Role check lives in **RLS/RPC**, not just the UI. The `organizer/*` UI gate is convenience only.
- [ ] All new RPCs are `SECURITY DEFINER` with `set search_path = public, pg_temp`, derive the actor
      from `auth.uid()`, and `revoke … from public` + `grant execute … to authenticated` (match
      `join_trek_and_chat`).
- [ ] `search_treks` filters `status='published'` so drafts/archived never leak.
- [ ] Delete is guarded: treks with participants archive (never strand bookings/chats).
- [ ] Storage writes are role-gated and `{uid}/`-pathed; no PII in filenames; compress before upload.
- [ ] Owner-scoped `with check` on every trek/batch write prevents writing on someone else's behalf.
- [ ] Re-run Supabase advisors (`get_advisors`) after applying; confirm no new RLS/security warnings.
- [ ] Confirm the participant **join** path and **waitlist promotion** still work after adding batch
      write policies (DEFINER should bypass, but verify on the live DB).

---

## 9. Verification Plan
1. `npm run build` — the gating check (TypeScript strict + ESLint). Fix any error before "done".
2. Manual: become organizer → create draft → it appears on the dashboard but **not** in Explore →
   publish → it appears in Explore/home → add a batch → join as a second user → roster shows them →
   archive (with participant) vs delete (empty) behave per §3.5.
3. RLS spot-check: as a non-owner, attempt to update/delete someone else's trek/batch — must fail.
4. Advisors clean; `treks_organised` reflects owned published treks on the profile.

---

## 10. Phased Rollout (suggested order)
1. **DB foundation** — §4.1 columns/enum + §4.2/4.3 RLS + §4.6 publish filter + §4.10 storage. (Apply SQL.)
2. **Role plumbing** — §4.8 `become_organizer`, AuthContext `role`/`isOrganizer`, profile/explore entry points.
3. **Create/Edit** — `organizer.ts`, hooks, `TrekForm`, new/edit pages, cover upload.
4. **Manage activity** — §4.4 roster RPC, batches CRUD, manage page.
5. **Delete/Archive** — §4.5 guarded RPC + UI with `ConfirmationModal`.
6. **Polish** — `treks_organised` source (§4.9), trek-detail "Organized by/Manage", chat presence (§5.8).
7. **Docs** — §7 reference-file sync + FEATURES.md move.

---

## 11. Open Questions / Decisions Needed Before Building
1. **Org as entity vs per-user owner?** Phase 1 assumes **per-user ownership**. Do you want a true
   multi-member **organization** (shared treks, org profile, staff roles)? That's a larger Phase 2.
2. **Who can become an organizer?** Self-service (`become_organizer`) vs admin-approved?
3. **Existing SQL-seeded treks** (organizer_id NULL): backfill to `published` and assign an owner, or
   leave them ownerless/published-by-policy? (Affects the §4.2 SELECT policy and §4.1 backfill.)
4. **Can organizers remove participants?** (Adds §4.7 RPC + UI.)
5. **Organizer auto-joined to batch chats?** (§5.8.)
6. **Hard-delete strategy:** explicit dependent deletes (as written) vs adding `ON DELETE CASCADE` to
   the FKs (broader migration, simpler RPC)?
```
