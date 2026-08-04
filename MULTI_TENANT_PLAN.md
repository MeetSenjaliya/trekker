# Trekker — Multi-Tenant (Multi-Company) Platform Plan

Converts Trekker from a single-company catalogue to a marketplace where independent
trek companies apply, get approved, and manage their own treks/bookings — with a
platform super-admin overseeing the whole thing.

> Status: **planned, not yet implemented**. The DB migration
> ([supabase/migration-multi-tenant.sql](supabase/migration-multi-tenant.sql)) is
> written and ready to review/apply; the app-layer phases below (B–F) are not
> started. Once each phase ships, move it into `FEATURES.md` §2 per the usual
> convention.

## Decisions locked in for this plan

Confirmed with the user before writing SQL:

1. **Onboarding:** self-serve — any signed-in user can apply to become a company; the
   application sits `pending` until a platform admin approves it.
2. **Platform admin:** yes — a super-admin role (you), assigned manually via SQL
   Editor only (never self-serve), that can approve/reject/suspend companies and see
   everything.
3. **Existing treks:** migrated to one default company ("Trekker Originals") rather
   than left ownerless.
4. **Company pages:** yes — public storefronts at `/company/[slug]`.

## Assumptions made while designing (flag if wrong)

- **Roles:** `owner` (exactly one, set at company creation, never reassignable by
  clients), `admin`, `staff`. Owner/admin/staff can all create & edit treks/batches
  (operational access); only owner/admin can edit company settings or manage the
  team roster. If you want staff restricted to read-only, that's a one-line RLS
  change (`is_company_admin` instead of `is_company_member` on the trek write
  policies).
- **No per-trek moderation queue.** Once a company is approved, its treks go live
  immediately (no "pending review" state per listing) — matches how most
  marketplaces gate the *seller*, not every listing. Can be added later if abuse
  becomes a problem (see Phase F).
- **No hard deletes anywhere new.** Companies suspend (not delete); treks archive via
  `is_active=false` (not delete); batches can only be deleted while empty. This
  protects existing bookings/reviews/chat history from FK breakage and preserves an
  audit trail.
- **Slugs, not sequential IDs, in company URLs** (`/company/himalayan-trails`) — set
  once at application time, validated server-side (`^[a-z0-9]+(-[a-z0-9]+)*$`),
  immutable after creation for v1 (renaming a slug would break existing shared links;
  can be added later as an admin-only rename RPC).

---

## Data model (new/changed)

```
auth.users ──< company_members >── companies ──< treks (company_id, is_active)
                                        │
                                  platform_admins   (manual-only, super-admin)
```

| Table | Purpose | Client writes |
|---|---|---|
| `companies` | Tenant profile: name, slug, logo, description, contact, `status` (pending/approved/rejected/suspended) | Only via `apply_for_company()` RPC (create) and RLS-gated UPDATE for non-admin fields (name/description/logo/contact) — `status`/`approved_by`/`approved_at` are trigger-pinned against self-edit |
| `company_members` | User ↔ company with `role` (owner/admin/staff) | Owner set only by the RPC; admin/staff invites & role changes via RLS, owner rows are immutable/undeletable by clients |
| `platform_admins` | Super-admin allowlist | **None** — SQL Editor only |
| `treks` | +`company_id` (NOT NULL), +`is_active` (soft-delete) | Company members of the owning company |
| `trek_batches` | unchanged shape, RLS now scoped to the parent trek's company for writes | Company members of the owning company |

Full DDL, RLS, RPCs, storage policies: [supabase/migration-multi-tenant.sql](supabase/migration-multi-tenant.sql).
Read the comments inline — every non-obvious decision (why a trigger instead of RLS,
why an RPC instead of a raw INSERT policy, why `platform_admins` has zero policies)
is explained at the point it happens.

### A bug this migration fixes as a side effect

`trg_initial_trek_message` (on `public.treks`) currently fires on every trek INSERT
and errors — it references a `trek_messages` table that has never existed (see
`DATABASE.md` Known Issues). Nothing hit this before because treks were only ever
SQL-seeded. Company admins creating treks through the new UI would hit it on literally
every save, so the migration drops the trigger (Section 5). Its intended purpose
(seed a welcome message) is already superseded by `join_trek_and_chat()`, which
creates the batch conversation when someone actually books a date.

---

## Security model (attack surface + mitigation)

| Threat | Mitigation |
|---|---|
| **IDOR / cross-tenant access** — company A editing company B's treks/roster | Every RLS policy on `treks`/`trek_batches`/`company_members` goes through `is_company_member()`/`is_company_admin()` (SECURITY DEFINER helpers), never a client-supplied flag. Verified server-side on every request, not just hidden in the UI. |
| **Privilege escalation to owner/admin** | `role='owner'` can only ever be written by `apply_for_company()` (SECURITY DEFINER, one row per call). The client-facing INSERT policy on `company_members` only allows `role='staff'`. The UPDATE policy's `WITH CHECK` blocks setting `role='owner'`. Owner rows can't be updated or deleted via RLS at all. |
| **Privilege escalation to platform admin** | `platform_admins` has RLS enabled with **zero policies** — default-deny for every role, including `authenticated`. The only path is the Supabase SQL Editor, i.e. you. |
| **Self-approval** (a company admin approving/verifying their own company) | `status`/`approved_by`/`approved_at`/`rejection_reason`/`created_by` are pinned back to their old values by a `BEFORE UPDATE` trigger unless the caller `is_platform_admin()` — this can't be bypassed by crafting a different request shape, because it runs inside Postgres regardless of how the UPDATE was issued. |
| **PII exposure to company staff** | Company staff never get `SELECT` on `public.profiles`. Participant contact info (phone/emergency contact) is served only via `get_company_batch_participants(batch_id)`, a SECURITY DEFINER RPC that re-checks membership against that specific batch's company on every call and returns only operational fields. |
| **Mass application / moderation-queue spam** | Partial unique index: one `pending` company application per `created_by`. Rejected users can reapply (intentional — rejection isn't punitive lockout), but can't queue multiple pending applications. |
| **Referential integrity / data loss** | No hard DELETE anywhere new. Companies suspend; treks archive (`is_active=false`); batches delete only while empty. Existing bookings/reviews/chat threads survive a company being suspended. |
| **Storage path traversal / cross-tenant file writes** | `company-logos`/`trek-images` buckets scope every write policy to `is_company_member((storage.foldername(name))[1]::uuid)` — the first path segment must be a company UUID the caller belongs to. Reuses the existing `sanitizeFileName()` + `compressImage()` client-side pipeline. |
| **Anonymous enumeration** | New buckets follow the existing `avatars`/`trek-reviews` pattern: `SELECT` is `authenticated`-only (blocks anon *listing*); public CDN URLs still serve images without auth once you have the path. |
| **Unapproved/suspended companies staying visible** | `is_trek_visible()` is the single source of truth used by `treks`, `trek_batches`, and the rewritten `search_treks()` — a trek only appears publicly when `is_active` AND the owning company's `status='approved'`. Suspending a company immediately delists its entire catalogue with no app-code change needed. |
| **SQL injection** | No raw string concatenation introduced; all new functions use parameterized `plpgsql`/`sql` bodies and PostgREST-parameterized calls, matching the existing `search_treks`/`join_trek_and_chat` pattern. |
| **XSS** | Company name/description/trek fields render through JSX (auto-escaped) like every other field today; no `dangerouslySetInnerHTML` planned. Explicitly re-verify this in code review for the new admin forms (Phase C). |

**Known gap, out of scope for v1** (call out, don't silently fix): no app-level rate
limiting on `apply_for_company` beyond the one-pending-per-user index, and no
per-company daily trek-creation cap. If abuse shows up in practice, add a
`created_at`-windowed check inside the relevant RPC — small, targeted change, not
worth building speculatively now.

---

## Phased plan

### Phase A — Database foundation *(SQL written, ready to review/apply)*

- [supabase/migration-multi-tenant.sql](supabase/migration-multi-tenant.sql): enums,
  `companies`/`company_members`/`platform_admins` tables, `treks.company_id` +
  `is_active`, helper functions, RPCs, triggers, RLS, storage buckets/policies,
  `search_treks()` extended with `p_company_id`, backfill, drops the broken
  `trg_initial_trek_message` trigger.
- **Before running:** open the file, read the two inline TODOs — (1) decide who owns
  "Trekker Originals" (defaults to your earliest signed-up user *that has a profile
  row* — live DB check found `auth.users` has 8 rows but `profiles` only has 3, so
  the backfill deliberately sources from `profiles`, not `auth.users`, to avoid a
  foreign-key failure), (2) the `platform_admins` insert template at the bottom
  (commented out — uncomment, put in your email, run once).
- **Verify:** run `get_advisors` (security) after applying; confirm `search_treks`
  only shows one overload; spot-check `is_trek_visible()` against a manually
  suspended test company.
- **After you confirm it's applied:** I update `supabase/schema.sql`, `DATABASE.md`,
  `CONTEXT.md` to fold this in as the new source of truth (per the project's
  documented Supabase workflow) and mark this phase done in `FEATURES.md`.

### Phase B — Company application flow + role plumbing (app layer)

| File | Change |
|---|---|
| `src/lib/schemas.ts` | Add `companyApplicationSchema` (Zod): name, slug (regex-validated), description, contact email/phone, website |
| `src/lib/company.ts` *(new)* | `applyForCompany()`, `getMyCompanies()`, `getCompany(slug)` — thin wrappers over the RPC/table, mirrors `src/lib/joinTrek.ts`'s shape |
| `src/lib/queries.ts` | TanStack Query hooks: `useMyCompanies()`, `useCompany(slug)` |
| `src/app/company/apply/page.tsx` *(new)* | Application form using the Zod schema; if not signed in, prompts login (client-side check via `useAuth()`, page itself is public) |
| `src/utils/supabase/middleware.ts` | Add `/company` to `publicRoutes` (storefronts + apply page are public; the RPC itself enforces auth) |
| `src/app/dashboard/layout.tsx` *(new)* | Server component: queries `company_members` for the current user (via `utils/supabase/server.ts`), redirects to `/company/apply` if none, shows a "pending approval" banner if their company's `status !== 'approved'` |
| `src/app/admin/layout.tsx` *(new)* | Server component: checks `is_platform_admin()` RPC, redirects to `/` if false |

### Phase C — Company admin dashboard (`/dashboard`)

| Route | Purpose |
|---|---|
| `/dashboard` | Overview: trek count, upcoming batches, total confirmed bookings, pending-approval banner if applicable |
| `/dashboard/treks` | List own company's treks (active + archived toggle) |
| `/dashboard/treks/new`, `/dashboard/treks/[id]/edit` | Create/edit form: title, description, location, difficulty, distance/duration, meeting point(s), cost, max participants, gear checklist, cover image upload → `trek-images/{company_id}/{trek_id}/…` via existing `compressImage()`/`sanitizeFileName()` |
| `/dashboard/treks/[id]/batches` | Add/remove dated departures (direct table writes now that RLS allows it — no longer only-via-RPC); shows capacity vs confirmed count |
| `/dashboard/treks/[id]/participants` | Roster per batch via `get_company_batch_participants()` — name, contact, status; this is the only place company staff ever see participant PII |
| `/dashboard/team` | List `company_members`; owner/admin can invite staff (email lookup → insert), change staff↔admin role, remove non-owner members |
| `/dashboard/settings` | Edit company profile (name/description/logo/contact); logo upload → `company-logos/{company_id}/…` |

New shared UI: a `RequireCompanyRole` pattern analogous to the existing
`useRequireAuth()` hook, plus a lightweight `src/components/admin/` folder for
dashboard-only layout chrome (sidebar/nav) — kept separate from the public
`src/components/ui/` set per the existing "extract reusable pieces" convention.

### Phase D — Platform admin panel (`/admin`)

| Route | Purpose |
|---|---|
| `/admin` | Overview: pending-companies count, total companies/treks/users |
| `/admin/companies` | List all companies, filter by status, approve/reject (with reason)/suspend actions calling the RPCs directly |
| `/admin/companies/[id]` | Detail view: full profile, owner contact, its treks, audit trail (`approved_by`/`approved_at`) |

### Phase E — Public-facing surface changes

| File | Change |
|---|---|
| `src/app/company/[slug]/page.tsx` *(new)* | Storefront: logo, cover, description, verified badge (derived from `status='approved'`), trek list via `search_treks(p_company_id: …)` |
| `src/app/trek/[id]/page.tsx` | Add "Organized by {company.name}" linking to `/company/[slug]` |
| `src/components/ui/TrekCard.tsx` | Optional small company-name label (reuses the `company_name`/`company_slug` fields `search_treks` now returns) |
| `src/app/explore/page.tsx` | No structural change — already calls `search_treks`; new fields just ride along |

### Phase F — Follow-ups (not required for launch, track in `FEATURES.md` §1)

- Per-trek moderation queue, if listing-level abuse becomes a real problem.
- Company slug rename (admin-only RPC).
- Company-application and trek-creation rate limiting beyond the current
  one-pending-application guard.
- Ownership transfer flow for `company_members.role='owner'` (currently permanent
  once set — by design, but you may eventually want a "transfer ownership" RPC).
- Delete `src/app/test/*` (pre-existing backlog item, unrelated to this work, still
  outstanding).

---

## How to use this plan

1. Review [supabase/migration-multi-tenant.sql](supabase/migration-multi-tenant.sql)
   — especially the two manual-step comments — then apply it via the Supabase SQL
   Editor.
2. Tell me it's applied; I'll sync `schema.sql`/`DATABASE.md`/`CONTEXT.md` and update
   `FEATURES.md`.
3. We implement Phase B → C → D → E in that order (each is independently shippable
   and buildable/testable via `npm run build`), or reprioritize if you'd rather see
   the admin dashboard before the public storefronts.

---

## Ready-to-use prompt for the next phase

Paste this (as-is, or edit the "Phase" line) to start implementation once the
migration is applied — it's self-contained, so it works even in a fresh session:

```
Implement Phase B of the Trekker multi-tenant migration described in
MULTI_TENANT_PLAN.md (repo root). Read that file plus
supabase/migration-multi-tenant.sql first — the DB migration is already applied to
Supabase, this is the app-layer follow-up.

Build exactly what Phase B lists: companyApplicationSchema in src/lib/schemas.ts,
src/lib/company.ts (applyForCompany/getMyCompanies/getCompany), the corresponding
TanStack Query hooks in src/lib/queries.ts, the /company/apply page, the /company
public-route addition in src/utils/supabase/middleware.ts, and the two guard
layouts (src/app/dashboard/layout.tsx, src/app/admin/layout.tsx).

Follow CLAUDE.md exactly: @/ path aliases, Zod validation on every form, handle
.data/.error on every Supabase call without leaking error detail to the UI, no
speculative abstractions, match existing file conventions (mirror
src/lib/joinTrek.ts's shape for src/lib/company.ts, mirror useRequireAuth.ts's
pattern for the new guard layouts). Prefer the src/utils/supabase server factories
for new server-side code per CLAUDE.md.

Do not touch RLS/SQL — that's already applied. Do not build Phase C/D/E pages yet,
just the Phase B plumbing. Run npm run build before calling it done. Update
FEATURES.md (move the relevant row/sub-items) when finished.
```

Swap "Phase B" for C/D/E/F in later sessions — each phase's file list in this
document is the spec.
