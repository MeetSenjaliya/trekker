# Trekker — Database Reference

Complete reference for the **live Supabase database** (Postgres 17, project `dtjmyqogeozrzzbdjokr`), introspected **2026-06-13**. The runnable, authoritative DDL lives in [supabase/schema.sql](supabase/schema.sql); this document is the readable companion (tables, relationships, RLS matrix, storage, edge functions, and known issues).

- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions).
- **Client access:** browser uses the **anon key** only; there is no service-role key in the app. RLS is therefore the primary security boundary.
- **Schemas in play:** `public` (app tables), `auth` (Supabase-managed users), `storage` (buckets/objects).

---

## 1. Entity overview

```
auth.users ──1:1──> profiles ──┐
                                ├─< trek_participants >── trek_batches >── treks
                                ├─< trek_reviews ───────────────────────── treks
                                ├─< favorites ──────────────────────────── treks
                                ├─< conversation_participants >── conversations ──1:1── trek_batches
                                ├─< conversation_messages ────────  conversations
                                ├─< user_stats (1:1)
                                ├─< user_monthly_activity
                                └─< user_achievements
```

- A **trek** is a catalogue entry. A **batch** is a dated departure of a trek (`UNIQUE(trek_id, batch_date)`).
- Joining a batch creates/uses a **conversation** (one per batch, `conversations.batch_id` is `UNIQUE`) and adds the user to both `trek_participants` and `conversation_participants`. This is done atomically by the `join_trek_and_chat` RPC.
- **Reviews** are one-per-(trek, user) and require the user to have actually joined the trek.

---

## 2. Extensions

| Extension | Version | Purpose |
|---|---|---|
| `uuid-ossp` | 1.1 | UUID generation |
| `pgcrypto` | 1.3 | `gen_random_uuid()` |
| `pg_net` | 0.14.0 | async HTTP from `notify_trek_*` functions |
| `pg_stat_statements` | 1.11 | query stats (Supabase-managed) |
| `supabase_vault` | 0.3.1 | secrets (Supabase-managed) |
| `plpgsql` | 1.0 | procedural language |

## 3. Enum types

| Type | Values | Used by |
|---|---|---|
| `difficulty` | `Easy, Moderate, Hard, Expert` | `treks.difficulty` |
| `experience_level` | `Beginner, Intermediate, Expert` | `profiles.experience_level` |
| `gender` | `Male, Female` | `profiles."Gender"` |
| `mood` | `Biginer, intermediate, expert` | **unused** (typo'd; safe to drop) |

---

## 4. Tables

### `profiles` — user profile, 1:1 with `auth.users`
Holds **PII**. Public reads are blocked at the table; cross-user display data is served by the `public_profiles` view.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK**, FK → `auth.users(id)` |
| `full_name` | text | |
| `avatar_url` | text | |
| `bio` | text | |
| `emergency_contact` | text | PII |
| `created_at` | timestamptz | `now()` |
| `email` | text | **NOT NULL, UNIQUE** (PII) |
| `age` | integer | PII |
| `"Gender"` | `gender` | quoted/capitalised column name |
| `experience_level` | `experience_level` | |
| `phone_no` | varchar | PII |
| `emergency_no` | varchar | PII |

Row created automatically by the `handle_new_user()` trigger on signup.

### `treks` — catalogue (public read)
No owner column → no legitimate client write path (seeded/admin only).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK**, `gen_random_uuid()` |
| `title` | text | **NOT NULL** |
| `description` | text | |
| `location` | text | |
| `cover_image_url` | text | |
| `difficulty` | `difficulty` | **NOT NULL** |
| `distance_km` | numeric | |
| `duration_hours` | numeric | |
| `meeting_point` / `meeting_point2` | text | |
| `max_participants` | integer | |
| `estimated_cost` | numeric | |
| `gear_checklist` | text[] | |
| `rating` | smallint | ⚠️ legacy static column — **no longer surfaced on cards**. Card/Explore ratings are now the live average of `trek_reviews.rating` (see `get_trek_avg_rating()` / `search_treks()`). |
| `plan` | text | itinerary |
| `participants_joined` | smallint | denormalised counter, kept in sync by `trek_participants_count_trigger` → `update_participants_count()`. Used directly by the Explore listing. |
| `fts` | tsvector | **generated** (`title`+`description`+`location`, `english`); GIN-indexed (`treks_fts_idx`). Backs Explore search via `search_treks()`. |

### `trek_batches` — a dated departure
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `trek_id` | uuid | **NOT NULL**, FK → `treks(id)` |
| `batch_date` | date | **NOT NULL** |
| `max_participants` | integer | per-batch capacity; seeded from `treks.max_participants` by `join_trek_and_chat` at batch creation. NULL = unlimited. |
| `created_at` | timestamptz | `now()` |
| | | **UNIQUE(`trek_id`, `batch_date`)** |

### `trek_participants` — bookings
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `user_id` | uuid | FK → `profiles(id)` |
| `batch_id` | uuid | FK → `trek_batches(id)` |
| `joined_at` | timestamptz | `now()` |
| `status` | text | `'confirmed'` (default) or `'waitlisted'`; CHECK-constrained. Full batches waitlist new joiners (no chat seat); promoted FIFO by `promote_waitlist_on_leave()`. Indexed `(batch_id, status, joined_at)`. |
| | | **UNIQUE(`user_id`, `batch_id`)** |

### `trek_reviews` — one review per (trek, user)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `trek_id` | uuid | FK → `treks(id)` |
| `user_id` | uuid | FK → `profiles(id)` |
| `rating` | integer | `CHECK 1..5` |
| `comment` | text | |
| `created_at` | timestamptz | `now()` |
| `photo_urls` | text[] | default `{}` |
| `trek_date` | date | |
| | | **UNIQUE(`trek_id`, `user_id`)** |

### `favorites` — wishlist (no surrogate PK)
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | **NOT NULL**, FK → `profiles(id)` |
| `trek_id` | uuid | FK → `treks(id)` |
| `created_at` | timestamptz | `now()` |
| | | **UNIQUE(`user_id`, `trek_id`)** |

### `conversations` — one chat per batch
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `batch_id` | uuid | **UNIQUE**, FK → `trek_batches(id)` |
| `name` | text | e.g. `"<trek title> — <date>"` |
| `created_at` | timestamptz | `now()` |

### `conversation_participants` — chat membership
| Column | Type | Notes |
|---|---|---|
| `conversation_id` | uuid | **NOT NULL**, FK → `conversations(id)` |
| `user_id` | uuid | **NOT NULL**, FK → `profiles(id)` |
| `joined_at` | timestamptz | `now()` |
| | | **UNIQUE(`conversation_id`, `user_id`)** |

### `conversation_messages` — chat messages
Composite **PK (`created_at`, `id`)**.

| Column | Type | Notes |
|---|---|---|
| `conversation_id` | uuid | **NOT NULL**, FK → `conversations(id)` |
| `user_id` | uuid | **NOT NULL**, FK → `profiles(id)` |
| `message` | text | **NOT NULL** |
| `created_at` | timestamptz | **NOT NULL**, `now()`, part of PK |
| `id` | uuid | `gen_random_uuid()`, part of PK |
| `updated_at` | timestamptz | edit timestamp |
| `is_deleted` | boolean | soft-delete (default `false`) |
| `reply_to` | uuid | references another message id (no FK) |
| `reactions` | jsonb | `{ "emoji": [userId, …] }`, default `{}` |

### `user_stats` — per-user aggregate (1:1)
`treks_completed`, `treks_organised` (int ≥ 0), `total_distance_km` (≥ 0), `last_updated` (touched by trigger). **PK** `user_id`. **System-managed: read-only to clients** (SELECT own row only; no INSERT/UPDATE policy). Rebuilt from source by `recompute_user_stats()` (triggers + daily pg_cron). `treks_completed`/`total_distance_km` = joined batches whose `batch_date` has passed. `treks_organised` stays 0 (no organiser column yet); `avg_rating` was dropped (no per-user source).

### `user_monthly_activity` — per-user monthly counters
**PK (`user_id`, `month`)**; `month` `CHECK extract(day) = 1`. Counters: `treks_joined`, `photos_shared`, `reviews_written`, `distance_km` (all `CHECK ≥ 0`). **System-managed: read-only to clients** (same model as `user_stats`).

### `user_achievements` — earned badges (gamification)
**PK (`user_id`, `achievement_key`)**; `earned_at` timestamptz. **Append-only, system-managed: read-only to clients** (SELECT own rows only; INSERT/UPDATE/DELETE revoked — written exclusively by `award_user_achievements()`, chained off `recompute_user_stats()`). Badge catalog (key → name/icon/description) lives in `src/lib/achievements.ts`; criteria thresholds live in `award_user_achievements()`. 15 badges keyed on treks joined (entry-level "Trailblazer"), completed-trek count, total distance, distinct locations, Hard/Expert completions, distinct active months, reviews written, and photos shared.

---

## 5. Views

| View | Definition | Notes |
|---|---|---|
| `public_profiles` | `select id, full_name, avatar_url from profiles` | **Owner-privileged** (security_invoker = false) so it returns all rows while `profiles` stays own-row-only. Readable by `anon` + `authenticated`. ⚠️ Supabase linter flags this as `security_definer_view` (ERROR) — intentional trade-off. |
| `user_completed_treks` | `trek_participants ⋈ trek_batches ⋈ treks WHERE batch_date < current_date` | Past treks per user. |

---

## 6. Functions

| Function | Returns | Security | search_path | Role |
|---|---|---|---|---|
| `is_chat_participant(uuid)` | boolean | **DEFINER** | pinned | Gates **all** chat RLS; avoids recursion. |
| `handle_new_user()` | trigger | **DEFINER** | pinned | Creates `profiles` row on signup. ⚠️ exposed via RPC (revoke EXECUTE). |
| `join_trek_and_chat(uuid,uuid,date)` | jsonb | **DEFINER** | pinned | The one write path for joining; derives caller from `auth.uid()`, refuses acting for others. Enforces per-batch capacity under a `FOR UPDATE` row lock — full batches return `status:'waitlisted'` (no chat seat) with a `waitlist_position`; otherwise `'confirmed'`. |
| `get_trek_participant_count(uuid)` | integer | INVOKER | pinned | **Confirmed** participant count across a trek's batches (excludes waitlisted). |
| `promote_waitlist_on_leave()` | trigger | **DEFINER** | pinned | After a confirmed participant leaves, promotes the oldest waitlisted joiner (FIFO) to confirmed and adds them to the batch chat. EXECUTE revoked from anon/authenticated. |
| `get_trek_avg_rating(uuid)` | numeric | INVOKER | pinned | Live average of a trek's `trek_reviews.rating`, rounded to 1 dp; `null` when unrated. Single-trek card views (home page). Granted to anon + authenticated. |
| `search_treks(text,text,text,numeric,numeric,numeric,numeric,date,text,int,int)` | setof rows | INVOKER | pinned | Explore page read path: FTS + filters (location/difficulty/distance/price/date) + sort + pagination in one call. `rating` is the live average of `trek_reviews` (numeric, 1 dp, `null` when unrated); the `rating` sort orders by it. Returns `total_count` per row (window count). Granted to anon + authenticated. |
| `update_user_stats_timestamp()` | trigger | INVOKER | pinned | Touch `user_stats.last_updated`. |
| `recompute_user_stats(uuid)` | void | **DEFINER** | pinned | Rebuilds a user's `user_stats` + `user_monthly_activity` from source (idempotent), then calls `award_user_achievements()`. EXECUTE revoked from clients; called by triggers + daily pg_cron. |
| `award_user_achievements(uuid)` | void | **DEFINER** | pinned | Evaluates the 15-badge catalog from source metrics and appends newly-qualifying badges to `user_achievements` (idempotent, on conflict do nothing — never removes). EXECUTE revoked from clients; called by `recompute_user_stats()`. |
| `get_user_profile(uuid)` | jsonb | INVOKER | pinned | One read path for the profile page: `{ stats, current_month, achievements[] }` in a single round trip. INVOKER so own-row RLS still applies; `p_user_id` defaults to `auth.uid()`. Granted to `authenticated`. |
| `trg_recompute_user_stats()` | trigger | **DEFINER** | pinned | Trigger glue → `recompute_user_stats()` for the affected user. |
| `on_user_join_trek()` | trigger | INVOKER | pinned | No-op (legacy). |
| `create_trek_initial_message()` | trigger | INVOKER | pinned | 🐞 **BROKEN** — inserts into non-existent `trek_messages`. |
| `update_participants_count()` | trigger | INVOKER | pinned | 🐞 **DEAD** — references non-existent `trek_participants.trek_id`; not attached. |
| `notify_trek_join()` / `notify_trek_remove()` | trigger | INVOKER | pinned | `pg_net` POST to `trek-email-notification` edge fn that **does not exist**; redundant with the webhook triggers. Anon key hard-coded in live DB. |

---

## 7. Triggers

| Table | Trigger | Timing/Event | Calls | Status |
|---|---|---|---|---|
| `auth.users` | `on_auth_user_created` | AFTER INSERT | `handle_new_user()` | ✅ active |
| `user_stats` | `trg_update_user_stats_timestamp` | BEFORE UPDATE | `update_user_stats_timestamp()` | ✅ active |
| `trek_participants` | `trg_participant_stats` | AFTER INSERT/DELETE | `trg_recompute_user_stats()` | ✅ active |
| `trek_reviews` | `trg_review_stats` | AFTER INSERT/UPDATE/DELETE | `trg_recompute_user_stats()` | ✅ active |
| `treks` | `trg_initial_trek_message` | AFTER INSERT | `create_trek_initial_message()` | 🐞 errors on insert |
| `trek_participants` | `trek-join-notification` | AFTER INSERT | webhook → `send-trek-notification` | ✅ active |
| `trek_participants` | `trek-leave-notification` | AFTER DELETE | webhook → `send-trek-leave-notification` | ✅ active |
| `trek_participants` | `trek_join_email_trigger` | AFTER INSERT | `notify_trek_join()` | 🐞 dead edge fn |
| `trek_participants` | `trek_remove_email_trigger` | AFTER DELETE | `notify_trek_remove()` | 🐞 dead edge fn |
| `trek_participants` | `trek_participants_waitlist_promote` | AFTER DELETE | `promote_waitlist_on_leave()` | ✅ active — FIFO waitlist promotion |

> `trek_participants` has **two** INSERT and **two** DELETE notification triggers — one working webhook pair plus one dead `pg_net` pair. Consider dropping the dead pair.

---

## 8. RLS policy matrix

RLS is enabled on all 11 public tables. `auth.uid() = …` checks appear under both the `public` and `authenticated` roles in the live DB; effect is the same (anon has no `uid`).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | own (`id = uid`) | own | own | — |
| `treks` | **public `true`** | — | — | — |
| `trek_batches` | **public `true`** | — (RPC only) | — | — |
| `trek_participants` | **own** (`user_id = uid`) | own | own | own |
| `trek_reviews` | **public `true`** | own **AND joined the trek** | own | own |
| `favorites` | own | own | — | own |
| `conversations` | `is_chat_participant(id)` | — | — | — |
| `conversation_participants` | `is_chat_participant(cid)` | `service_role` only | — | own (`user_id = uid`) |
| `conversation_messages` | `is_chat_participant(cid)` | own **AND** participant | own | own |
| `user_stats` | own | — (system) | — (system) | — |
| `user_monthly_activity` | own | — (system) | — (system) | — |
| `user_achievements` | own | — (system) | — (system) | — (system) |

Key design points:
- **No public read of `profiles`** — PII is protected; cross-user names/avatars come from `public_profiles`.
- **`trek_participants` is own-row only** (NEW-4) — closes the logged-out + cross-user social-graph leak.
- **Reviews require participation** (NEW-3) — the INSERT `WITH CHECK` verifies a matching `trek_participants → trek_batches` row for the trek.
- **Chat writes** are membership-gated; `conversation_participants` INSERT is `service_role`-only, so users are added only via the `join_trek_and_chat` RPC (SECURITY DEFINER).
- **Batch/trek writes** have no policy → denied to clients; created only by the SECURITY DEFINER RPC.

---

## 9. Storage

Buckets (all **public**, no size limit, any MIME):

| Bucket | Read | Write | Notes |
|---|---|---|---|
| `avatars` | public | owner-scoped INSERT/UPDATE/DELETE | path `{uid}/file` **or** `{uid}.ext` |
| `trek-reviews` | public (`Public Access`) | owner-scoped INSERT/DELETE (no UPDATE) | path `{uid}/file` |
| `trek-profile` | — | — | public bucket, **no object policies**; reachable only by public URL. Likely unused. |

⚠️ Advisor `public_bucket_allows_listing` flags `avatars` and `trek-reviews`: the broad public SELECT allows clients to **list** all files. Object URLs don't need listing — consider narrowing.

---

## 10. Edge Functions (deployed)

| Slug | verify_jwt | Invoked by |
|---|---|---|
| `send-trek-notification` | true | `trek-join-notification` trigger (on join) |
| `send-trek-leave-notification` | true | `trek-leave-notification` trigger (on leave) |

Source is **not** in this repo (`supabase/functions/` is empty locally). The `trek-email-notification` function referenced by `notify_trek_*` is **not deployed**.

---

## 11. Known issues / advisors

Security advisor (live, 2026-06-13):

- **ERROR** `security_definer_view` — `public_profiles`. Intentional (documented above). [ref](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)
- **WARN** `public_bucket_allows_listing` — `avatars`, `trek-reviews`. [ref](https://supabase.com/docs/guides/database/database-linter?lint=0025_public_bucket_allows_listing)
- **WARN** `anon/authenticated_security_definer_function_executable` — `handle_new_user`, `is_chat_participant`, `join_trek_and_chat` are callable via `/rest/v1/rpc`. `handle_new_user` is a trigger fn and should have EXECUTE revoked. [ref](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- **WARN** `auth_leaked_password_protection` — disabled. The built-in toggle is **Pro-only**, so it's handled in app code instead: `isPasswordPwned()` in [src/lib/auth.ts](src/lib/auth.ts) checks signups/password-updates against HaveIBeenPwned's range API (k-anonymity). The advisor will still flag this since it only inspects the Auth toggle. [ref](https://supabase.com/docs/guides/auth/password-security)
- **WARN** `vulnerable_postgres_version` — `supabase-postgres-17.4.1.069` has patches available. Manual upgrade is **Pro-only**; on the free plan this is acknowledged (Supabase patches free-tier infra on their own schedule). [ref](https://supabase.com/docs/guides/platform/upgrading)

Correctness bugs (in DB):

- `create_trek_initial_message()` + `trg_initial_trek_message` insert into non-existent `trek_messages` → **creating a trek errors**.
- `treks.participants_joined` is kept in sync by `trek_participants_count_trigger` → `update_participants_count()` on every join/leave (NEW-5). The exact cross-batch count is still available via `get_trek_participant_count()`.
- Duplicate dead notification triggers (`notify_trek_join/remove` → non-existent edge fn).
- App-side dead code: [src/lib/database.ts](src/lib/database.ts) targets a non-existent `reviews` table and `trek_participants.trek_id` column and the non-existent `increment_participants` RPC. Not on any live path (the app uses [src/lib/joinTrek.ts](src/lib/joinTrek.ts)).

See [SECURITY_AUDIT_ISSUE.md](SECURITY_AUDIT_ISSUE.md) for the full hardening backlog and history, and [supabase/security-fixes.sql](supabase/security-fixes.sql) for applied-fix SQL with rationale.

---

## 12. How to apply

`supabase/schema.sql` is dependency-ordered and idempotent where practical. On a fresh project, run it top-to-bottom (SQL editor or `psql`). On the existing project it's a reference — the live DB already matches it. After DDL changes, re-run the security advisor (`get_advisors`) to catch missing RLS.
