# Trekker — Performance & Supabase Limits

_Last updated: 2026-08-21. Every "current" number below was measured against the live project
(`dtjmyqogeozrzzbdjokr`) over the read-only MCP server, not estimated._

Companion to `FEATURES.md` (what's built) and `CODE_REVIEW.md` (what's wrong).
This file answers one question: **what actually runs out first, and what do we do about it.**

---

## 1 — Measured baseline

| Parameter | Measured value | Source |
| --- | --- | --- |
| Compute tier | **Nano** — 0.5 GB RAM, shared burstable CPU | Free plan default |
| `max_connections` | 60 — **15 already used at idle** by PostgREST/Auth/Realtime/Supavisor | `pg_settings` |
| Supavisor pooler clients | 200 | compute add-on spec |
| `shared_buffers` | 229 MB | `pg_settings` |
| `effective_cache_size` | 384 MB | `pg_settings` |
| `work_mem` | 2.1 MB | `pg_settings` |
| `max_worker_processes` | 6 | `pg_settings` |
| Postgres | 17.4 (aarch64) — security patches outstanding | `version()` |
| Database size | **16 MB** / 500 MB | `pg_database_size` |
| Storage | **15.4 MB across 45 objects** / 1 GB | `storage.objects` |
| Tables | 17, all with RLS enabled | `pg_class.relrowsecurity` |

**Storage object sizes — the root cause of the egress ceiling:**

| Bucket | Objects | Total | Avg object |
| --- | --- | --- | --- |
| `avatars` | 17 | 6,991 kB | **411 kB** |
| `trek-profile` | 14 | 4,200 kB | 300 kB |
| `trek-reviews` | 11 | 3,230 kB | 294 kB |
| `company-logos` | 2 | 1,002 kB | **501 kB** |
| `trek-images` | 1 | 26 kB | 26 kB |

---

## 2 — Ceiling per parameter

| Parameter | Free ceiling | Pro ceiling ($25/mo) | What happens at the limit | Binds us at |
| --- | --- | --- | --- | --- |
| **Egress** | 5 GB/mo | 250 GB, then $0.09/GB | Grace period → throttle | **~5,500 page views/mo** ⚠️ |
| **Cached egress** | 5 GB/mo | 250 GB, then $0.03/GB | Same | counted above |
| **File storage** | 1 GB | 100 GB, then $0.0213/GB | Uploads fail | **~2,900 objects** ⚠️ |
| **Realtime concurrent** | 200 peak | 500, then $10/1,000 | New sockets rejected | **200 users online** ⚠️ |
| **Realtime messages** | 2M/mo | 5M, then $2.50/M | Grace period | not binding |
| **Database size** | 500 MB | 8 GB, then $0.125/GB | Writes fail | ~1M chat messages |
| **MAU (Auth)** | 50,000 | 100,000, then $0.00325 | Grace period | never — decoy limit |
| **Edge function calls** | 500k/mo | 2M, then $2/M | Grace period | not binding |
| **Direct connections** | 60 (45 usable) | 60 on Micro | Connection refused | N/A — we use PostgREST |
| **Pooler clients** | 200 | 200 on Micro | Queued | N/A |
| **Log retention** | 1 day | 7 days | Can't debug yesterday | operationally, now |
| **Project pause** | **after 1 week idle** | never | **Site goes down** | operationally, now |
| **Active projects** | 2 | unlimited | Can't create | not binding |

### Compute tiers, for later

| Tier | RAM | CPU | Direct conns | Pooler | ~Monthly |
| --- | --- | --- | --- | --- | --- |
| Nano *(free)* | 0.5 GB | shared, burstable | 60 | 200 | $0 |
| Micro *(Pro incl.)* | 1 GB | 2-core shared, burstable | 60 | 200 | ~$10 |
| Small | 2 GB | 2-core shared | 90 | 400 | ~$15 |
| Medium | 4 GB | 2-core shared | 120 | 600 | ~$60 |
| Large | 8 GB | 2-core **dedicated** | 160 | 800 | ~$110 |
| XL | 16 GB | 4-core dedicated | 240 | 1,000 | ~$210 |

Nano through 2XL burst for short periods; Large and up deliver sustained performance.

---

## 3 — The egress math

One `/explore` view renders 6 trek cards = 6 cover images:

```
6 × 300 kB                       ≈ 1.8 MB per page view
10 GB (5 egress + 5 cached) ÷ 1.8 MB  ≈ 5,500 page views / month
                                  ≈ ~180 views / day
```

With correctly sized delivery (≈60 kB per card image):

```
6 × 60 kB                        ≈ 360 kB per page view
10 GB ÷ 0.36 MB                  ≈ 28,000 page views / month
                                  ≈ ~950 views / day
```

**Same plan, ~5× the traffic.** This is the highest-leverage change available.

---

## 4 — Optimization techniques, by parameter

### 4.1 Egress — highest priority

- **Serve resized variants, don't shrink the source.** `cover_image_url` is used as both a
  ~400×240 card ([`TrekCard.tsx:144`](src/components/ui/TrekCard.tsx#L144)) and a full-bleed
  `h-[65vh]` hero ([`TrekDetailClient.tsx:209`](src/app/trek/[id]/TrekDetailClient.tsx#L209)).
  The hero needs ~1920px. Shrinking the original degrades it.
- **Use `next/image`, not Supabase Image Transformations.** Transformations are Pro-only and
  quota'd at **100 origin images/month** (then $5 per 1,000) — unusable for a growing catalogue.
  `next/image` resizes at Vercel's edge and hits Supabase once per cache period.
- **This also clears the 12 `@next/next/no-img-element` lint warnings** — they flag exactly
  these call sites.
- **Set a long `cacheControl` on upload.** Storage defaults to a short TTL; a high value keeps
  assets in the browser and CDN, converting egress into cached egress (and then into nothing).
- **Set per-bucket file size limits** so a user cannot upload a 10 MB photo you then serve back.
- **Prefer cached egress.** The Smart CDN bills lower for cached bytes; small working sets
  (13 treks today) should be near-100% cache hit.

### 4.2 Storage — 1 GB / ~2,900 objects

- **Compress per bucket, not globally.** [`imageCompression.ts:5-6`](src/utils/imageCompression.ts#L5-L6)
  applies `maxSizeMB: 1, maxWidthOrHeight: 1920` to everything:
  - `avatars` → target **400 px / ~40 kB**. Displayed at 128–160 px max. No visible change.
  - `company-logos` → target **400 px / ~40 kB**. Currently 501 kB avg.
  - `trek-reviews` → target **1200 px / ~150 kB**.
  - `trek-profile` (covers) → **keep 1920 px**; it backs the hero.
- **Delete orphaned objects.** Nothing currently prunes storage when a trek or review is removed.
- **Never store originals you never serve.** No "keep the raw upload just in case" bucket.

### 4.3 Realtime — 200 concurrent sockets

- **Channels multiplex over one socket** — the cap is *users with the app open*, not channels.
- **The global message channel is intentionally unfiltered**
  ([`messages/page.tsx:217-218`](src/app/(trekker)/messages/page.tsx#L217-L218)); it drives unread
  badges across every conversation. Filtering it requires `conversation_id=in.(…)` rebuilt on
  every membership change plus a resubscribe — **not a cheap change, and premature today.**
- **Unsubscribe on unmount** (already done at line 283) — leaked channels burn the 200 cap.
- **Prefer `broadcast` over `postgres_changes`** for high-frequency signals. Presence and typing
  already do this correctly.
- **`postgres_changes` costs one RLS evaluation per subscriber per row change.** Load scales
  with concurrent subscribers, not message volume. Revisit filtering when concurrency is real.

### 4.4 Database CPU & query time

- **Fix the 20 `auth_rls_initplan` warnings.** Policies on `profiles`, `trek_participants`,
  `conversation_messages`, `favorites`, `treks`, `company_members`, `trek_reviews`,
  `user_stats`, `user_achievements`, `user_monthly_activity` and `conversation_participants`
  call `auth.uid()` **per row**. Wrap as `(select auth.uid())` so Postgres evaluates it once
  as an InitPlan. Free, and cheapest to do while tables are near-empty.
- **Add the 2 missing primary keys** — `conversation_participants` (hot path on every chat
  load) and `favorites`.
- **Index the 2 unindexed foreign keys** — `companies.approved_by`, `company_invites.invited_by`.
- **Collapse the duplicate permissive SELECT policies on `treks`**
  (`company members view own treks` + `view treks`); every permissive policy runs on every query.
- **Drop the 2 unused indexes** — `trek_participants_batch_status_idx`, `trek_reviews_user_idx` —
  they cost write throughput and buy nothing. Confirm against production usage first.
- **Index columns used inside RLS policies**, not just columns in `WHERE` clauses.
- **`work_mem` is 2.1 MB.** Any sort or hash exceeding it spills to disk. Keep `ORDER BY` on
  indexed columns and always paginate (message loads already cap at 30).

### 4.5 Connections

- **We do not open Postgres connections.** `@supabase/ssr` and `supabase-js` speak HTTPS to
  PostgREST, which owns its own pool. The 60-connection limit is not our constraint.
- **Adding a Node backend with a `pg` driver would create this problem**, spending 45 usable
  connections across serverless instances. If it ever happens, it must go through Supavisor in
  transaction mode.
- **Rule of thumb if a pool is ever added:** with heavy PostgREST use, keep the pool under 40%
  of `max_connections`.

### 4.6 Page rendering

- **Public pages are fully dynamic.** [`server-queries.ts`](src/lib/server-queries.ts) uses the
  cookie-reading server client, so Next marks every request dynamic. There is no `revalidate`
  anywhere in `src/`. `cache()` is per-request React memoization only — it does **not** cache
  across requests.
- **Split anon from authed.** A logged-out visitor to `/explore` or `/trek/[id]` sees identical
  HTML; that path can be statically cached. Signed-in users keep the dynamic path (a company
  member previewing their own inactive trek must still see it — the tradeoff is deliberate).
- **`/trek/[id]` issues 3 queries per view** (`getTrekDetail`, `getTrekReviews`,
  `getTrekParticipantCount`). Caching the anon path removes all three for most traffic.

### 4.7 Operational

- **Move to Pro before real customers.** Free projects pause after 1 week idle — a quiet week
  takes the site down until someone clicks restore in the dashboard.
- **1-day log retention** means an incident is unforensicable by the next morning.
- **Upgrade Postgres** — `supabase-postgres-17.4.1.069` has outstanding security patches.
- **Enable leaked-password protection** (HaveIBeenPwned check) in Auth settings.
- **Review `public_profiles`** — it is a `SECURITY DEFINER` **view** (advisor ERROR), which
  bypasses the querying user's RLS.
- **Re-run `get_advisors` after every migration.**

---

## 5 — Priority order

| # | Action | Cost | Effect |
| --- | --- | --- | --- |
| 1 | Per-bucket compression targets (§4.2) | small | ~10× smaller avatars/logos |
| 2 | `next/image` for remote images (§4.1) | medium | ~5× egress headroom, clears 12 lint warnings |
| 3 | `(select auth.uid())` migration + PKs + FK indexes (§4.4) | small | removes the per-row scaling cliff |
| 4 | Long `cacheControl` + bucket size limits (§4.1) | small | converts egress to cached egress |
| 5 | Upgrade to Pro | $25/mo | no pausing, 50× egress, 7-day logs |
| 6 | Cache the anon render path (§4.6) | medium | removes most SSR queries |
| 7 | Realtime filtering (§4.3) | large | **defer** — premature below ~100 concurrent |

---

## 6 — What not to do

- **Don't add a Node/Express backend to "scale the database."** It is the same Postgres, and it
  introduces a connection-pool problem we currently do not have. A backend is needed for
  *secrets* (payment verification, third-party API keys) — not for throughput. Edge functions in
  `supabase/functions/` are the right home for that.
- **Don't blanket-shrink `maxWidthOrHeight`.** The trek hero needs 1920 px.
- **Don't buy Supabase Image Transformations** for catalogue images — 100 origin images/month.
- **Don't chase MAU.** 50,000 is unreachable; egress and storage cap us in the low thousands.
- **Don't "fix" the 3 remaining `react-hooks/exhaustive-deps` warnings in bulk.** Each needs
  individual judgement; a wrongly-added dep turns a one-shot effect into a re-render loop. The 7
  closed on 2026-09-01 in `messages/page.tsx` were closed by *stabilizing* the identities the
  effects closed over (`useMemo` the client, `useCallback` the fetcher, key on `user?.id` not
  `user`) — never by pasting the suggested deps in. See `CODE_REVIEW.md` §3.3.
