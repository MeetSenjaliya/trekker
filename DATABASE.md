# Trekker — Database Reference

Complete reference for the **live Supabase database** (Postgres 17, project `dtjmyqogeozrzzbdjokr`), introspected **2026-06-13**, updated **2026-07-02** after the multi-tenant migration ([supabase/migration-multi-tenant.sql](supabase/migration-multi-tenant.sql)) was applied and verified live, and **2026-08-05** after Postgres-enforced rate limiting ([supabase/phases/rate-limiting.sql](supabase/phases/rate-limiting.sql) and [supabase/phases/rate-limiting-storage.sql](supabase/phases/rate-limiting-storage.sql)), and **2026-08-06** after the account-type split ([supabase/phases/phase-f-account-types.sql](supabase/phases/phase-f-account-types.sql)) and the invite → accept flow ([supabase/phases/phase-g-invite-accept.sql](supabase/phases/phase-g-invite-accept.sql)), and **2026-08-08** after the storage rate limit was made visible to the user ([supabase/phases/fix-storage-rate-limit-message.sql](supabase/phases/fix-storage-rate-limit-message.sql)), and **2026-08-13** after the `createTrek()` RETURNING fix and the chat policy re-scoping ([supabase/phases/fix-trek-returning-and-chat-policy-roles.sql](supabase/phases/fix-trek-returning-and-chat-policy-roles.sql)), applied and read back from production the same day, and **2026-08-13** when all of the above was captured as [supabase/migrations/0001_baseline.sql](supabase/migrations/0001_baseline.sql) and the project moved to numbered, append-only migrations (§12) — with the RETURNING/chat-policy pair split back out as [0002](supabase/migrations/0002_trek-returning-and-chat-policy-roles.sql) on **2026-08-14**, since it was applied after `0001` was recorded.

The runnable DDL lives in [supabase/schema.sql](supabase/schema.sql), **generated** from those migrations; this document is the readable companion (tables, relationships, RLS matrix, storage, edge functions, and known issues). The live database remains the source of truth — check [`supabase_migrations.schema_migrations`](#supabase_migrationsschema_migrations--what-is-actually-deployed) to see what it actually has.

- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions).
- **Client access:** browser uses the **anon key** only; there is no service-role key in the app. RLS is therefore the primary security boundary.
- **Schemas in play:** `public` (app tables), `auth` (Supabase-managed users), `storage` (buckets/objects), `supabase_migrations` (the deployment ledger, §12).

---

## 1. Entity overview

```
auth.users ──1:1──> profiles ──┐
                                ├─< trek_participants >── trek_batches >── treks >── companies
                                ├─< trek_reviews ───────────────────────── treks         │
                                ├─< favorites ──────────────────────────── treks         │
                                ├─< conversation_participants >── conversations ──1:1── trek_batches
                                ├─< conversation_messages ────────  conversations        │
                                ├─< company_members >────────────────────────────── companies
                                ├─< user_stats (1:1)
                                ├─< user_monthly_activity
                                └─< user_achievements

auth.users ──< platform_admins   (super-admin allowlist, SQL-Editor-only)
```

- A **trek** is a catalogue entry. A **batch** is a dated departure of a trek (`UNIQUE(trek_id, batch_date)`).
- Since 2026-07-02 every trek is **owned by a company** (`treks.company_id` NOT NULL) and soft-deletes via `is_active`. A trek is publicly visible only when `is_active` AND its company is `approved` (`is_trek_visible()`). Companies are created only via `apply_for_company()` (self-serve, lands `pending`) and moderated by **platform admins** (approve/reject/suspend RPCs).
- Joining a batch creates/uses a **conversation** (one per batch, `conversations.batch_id` is `UNIQUE`) and adds the user to both `trek_participants` and `conversation_participants`. This is done atomically by the `join_trek_and_chat` RPC.
- **Reviews** are one-per-(trek, user) and require the user to have actually joined the trek.

---

## 2. Extensions

| Extension | Version | Purpose |
|---|---|---|
| `uuid-ossp` | 1.1 | UUID generation |
| `pgcrypto` | 1.3 | `gen_random_uuid()` |
| `pg_net` | 0.14.0 | async HTTP from `notify_trek_*` functions |
| `pg_cron` | — | scheduled jobs: daily `recompute_user_stats`, hourly `prune-rate-events` |
| `pg_stat_statements` | 1.11 | query stats (Supabase-managed) |
| `supabase_vault` | 0.3.1 | secrets (Supabase-managed) |
| `plpgsql` | 1.0 | procedural language |

## 3. Enum types

| Type | Values | Used by |
|---|---|---|
| `difficulty` | `Easy, Moderate, Hard, Expert` | `treks.difficulty` |
| `experience_level` | `Beginner, Intermediate, Expert` | `profiles.experience_level` |
| `gender` | `Male, Female` | `profiles."Gender"` |
| `company_status` | `pending, approved, rejected, suspended` | `companies.status` |
| `company_role` | `owner, admin, staff` | `company_members.role` |

---

## 4. Tables

### `profiles` — user profile, 1:1 with `auth.users`
Holds **PII**. Public reads are blocked at the table; cross-user display data is served by the `public_profiles` view.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK**, FK → `auth.users(id)` |
| `full_name` | text | ≤ 100 chars (`profiles_full_name_len`, 0009). NULL = unset — `handle_new_user()` writes `left(nullif(trim(…), ''), 100)`, **clamping** since 0010: it is an AFTER INSERT trigger with no exception handler, so raising here would abort the `auth.users` insert and fail the signup outright |
| `avatar_url` | text | |
| `bio` | text | ≤ 500 chars (`profiles_bio_len`, 0009) |
| `emergency_contact` | text | PII. ≤ 100 chars (`profiles_emergency_contact_len`, 0011) |
| `created_at` | timestamptz | `now()` |
| `email` | text | **NOT NULL, UNIQUE** (PII) |
| `age` | integer | PII |
| `"Gender"` | `gender` | quoted/capitalised column name |
| `experience_level` | `experience_level` | |
| `phone_no` | varchar | PII. ≤ 20 chars (`profiles_phone_no_len`, 0013) and digits/whitespace/`+`/`(`/`)`/`-` only (`profiles_phone_no_format`, 0013). Both arrived with the format rule: no Zod counterpart writes this column (the profile schema carries the emergency contact's phone, not the user's own) and it is unclear anything still does, but the owner can write it directly over PostgREST |
| `emergency_no` | varchar | PII. ≤ 20 chars (`profiles_emergency_no_len`, 0011); digits/whitespace/`+`/`(`/`)`/`-` only (`profiles_emergency_no_format`, 0013 — the Zod regex the length cap left behind). Empty and NULL pass both |
| `account_type` | `account_type` | **NOT NULL**, default `'trekker'`. Immutable to clients |

Row created automatically by the `handle_new_user()` trigger on signup.

**`account_type` (since 2026-08-06)** — `'trekker'` or `'company'`. Set once at signup from `raw_user_meta_data.account_type` (anything but the literal `'company'` falls back to `'trekker'`), then pinned by `trg_protect_profile_account_type`; only platform admins and the SQL Editor can change it. Company accounts cannot join treks (`join_trek_and_chat` raises) or favourite them (RLS), and only company accounts can call `apply_for_company()`. Reviews are blocked transitively — reviewing already requires having joined. The check everything routes through is `is_trekker()`, which returns true for trekkers **and platform admins**, so the admin account keeps full trekker access while owning a company. **Since 2026-08-06 there is exactly one client path across the split**: `accept_company_invite()`, which flips `trekker → company` after the invitee consents. It gets through the pin via a transaction-local GUC (`app.account_type_change='allow'`) that the trigger honours and PostgREST cannot set; the RPC hard-codes `'company'`, so `company → trekker` remains platform-admin/SQL-Editor only.

### `treks` — catalogue (tenant-aware read since 2026-07-02)
Owned by a company; company members create/edit their own treks via RLS, archive via `is_active=false` (the only delete path — no hard DELETE).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK**, `gen_random_uuid()` |
| `title` | text | **NOT NULL**, ≤ 150 chars (`treks_title_len`, 0011) |
| `description` | text | ≤ 2000 chars (`treks_description_len`, 0011) |
| `location` | text | ≤ 200 chars (`treks_location_len`, 0011) |
| `cover_image_url` | text | |
| `difficulty` | `difficulty` | **NOT NULL** |
| `distance_km` | numeric | |
| `duration_hours` | numeric | |
| `meeting_point` / `meeting_point2` | text | ≤ 300 chars each (`treks_meeting_point_len` / `treks_meeting_point2_len`, 0011) |
| `max_participants` | integer | `> 0` (`treks_max_participants_positive`, 0009). NULL = uncapped |
| `estimated_cost` | numeric | `>= 0` (`treks_estimated_cost_nonneg`, 0009); no upper bound |
| `gear_checklist` | text[] | Joined with newlines, ≤ 2000 chars (`treks_gear_checklist_len`, 0011) — bounds the same string the textarea's Zod cap measures, not the element count |
| `rating` | smallint | ⚠️ legacy static column — **no longer surfaced on cards**. Card/Explore ratings are now the live average of `trek_reviews.rating` (see `get_trek_avg_rating()` / `search_treks()`). |
| `plan` | text | itinerary |
| `participants_joined` | smallint | denormalised counter, kept in sync by `trek_participants_count_trigger` → `update_participants_count()`; counts **confirmed only** (follow-up #1, so it equals `get_trek_participant_count()`). Used directly by the Explore listing. |
| `fts` | tsvector | **generated** (`title`+`description`+`location`, `english`); GIN-indexed (`treks_fts_idx`). Backs Explore search via `search_treks()`. |
| `company_id` | uuid | **NOT NULL**, FK → `companies(id)`, indexed. Added 2026-07-02; backfilled to "Trekker Originals". |
| `is_active` | boolean | **NOT NULL** default `true`. Soft-delete: `false` = archived (hidden from public catalogue). |

### `companies` — a tenant/operator (added 2026-07-02)
Created **only** via `apply_for_company()` (no INSERT policy). Approval-workflow columns are pinned against self-edit by `trg_protect_company_admin_fields`. Client SELECT is **column-restricted**: `anon`/`authenticated` are granted SELECT only on the non-sensitive columns — the audit UUIDs `created_by`/`approved_by`/`approved_at` are excluded (RLS is row-level only, so without this a client could select them and deanonymize owners/approving admins via `public_profiles`). Admins read the audit columns via the `admin_list_companies` / `admin_get_company` SECURITY DEFINER RPCs.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `name` | text | **NOT NULL**, CHECK non-blank |
| `slug` | text | **NOT NULL, UNIQUE**, CHECK `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 60 chars. Public URL `/company/[slug]`; **immutable** — pinned to OLD by `trg_protect_company_admin_fields` for non-platform-admins (blocks slug hijack of old links). No rename path in v1 |
| `description` / `logo_url` / `cover_image_url` / `contact_email` / `contact_phone` | text | storefront profile, editable by company owner/admin. `description`, `contact_email` and `contact_phone` are bounded in `src/lib/schemas.ts` and nowhere else — `0009`/`0011` never reached this table |
| `website` | text | storefront profile. CHECK `^https?://` case-insensitive (`companies_website_scheme`, 0014) — it is rendered into an `href` on the public storefront and on the admin review page, and bare `z.url()` accepted `javascript:`/`data:`/`vbscript:`. NULL passes (blank field: both writers send `website \|\| null`); `''` does not |
| `status` | `company_status` | **NOT NULL** default `'pending'`, indexed. Only platform admins can change it (trigger-pinned) |
| `rejection_reason` | text | set by `reject_company()` / `suspend_company()` |
| `created_by` | uuid | **NOT NULL**, FK → `auth.users(id)`. Partial unique index `companies_one_pending_per_creator`: **one pending application per user** (spam guard; rejected users can reapply) |
| `approved_by` / `approved_at` | uuid / timestamptz | audit trail, set by `approve_company()` |
| `created_at` | timestamptz | `now()` |

### `company_members` — user ↔ company with role (added 2026-07-02)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `company_id` | uuid | **NOT NULL**, FK → `companies(id)` ON DELETE CASCADE, indexed |
| `user_id` | uuid | **NOT NULL**, FK → `profiles(id)` ON DELETE CASCADE, indexed |
| `role` | `company_role` | **NOT NULL** default `'staff'`. `'owner'` is written exactly once, by `apply_for_company()`; owner rows can't be updated/deleted via RLS |
| `created_at` | timestamptz | `now()` |
| | | **UNIQUE(`company_id`, `user_id`)** |

⚠️ **No INSERT policy and no INSERT grant since 2026-08-06.** Rows are created only by `apply_for_company()` (owner) and `accept_company_invite()` (invited member), both SECURITY DEFINER. The dropped `company admins invite staff` policy checked the company and the role but **not `user_id`**, so any company admin could POST `/rest/v1/company_members` with an arbitrary `user_id` — harmless-ish before, but once accepting an invite converts an account it would have destroyed a stranger's account with no invite and no consent. Don't re-add a client INSERT path here.

### `company_invites` — pending consent step (added 2026-08-06)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `company_id` | uuid | **NOT NULL**, FK → `companies(id)` ON DELETE CASCADE |
| `email` | text | **NOT NULL**, stored lowercased + trimmed by the RPC; every lookup lowercases |
| `invited_by` | uuid | **NOT NULL**, FK → `profiles(id)` |
| `role` | `company_role` | **NOT NULL** default `'staff'`, CHECK `role <> 'owner'` |
| `status` | text | **NOT NULL** default `'pending'`, CHECK ∈ `pending, accepted, declined, revoked` |
| `created_at` | timestamptz | **NOT NULL** `now()` |
| `expires_at` | timestamptz | **NOT NULL** `now() + 14 days` |
| `responded_at` | timestamptz | set on accept/decline/revoke |
| | | **UNIQUE(`company_id`, `lower(email)`) WHERE `status='pending'`** (partial) + partial index on `lower(email)` |

**No token column and no email delivery, on purpose.** `invite_company_member()` requires the invitee to already have a Trekker account (it resolves them in `profiles` by email), so the invite is shown to them at `/invites` when they sign in. Inviting people *without* accounts is what would need a hashed token + a mail step; the deployed edge functions are trek notifications, not transactional mail. The partial unique index is why `invite_company_member()` sweeps expired pendings to `revoked` first — otherwise a timed-out invite would hold the index and make that person permanently un-invitable.

**Reads**: the company side selects directly (SELECT policy = any member). The invitee has **no** read policy — as a non-member, `companies` hides an unapproved company from them and `profiles` is self-only, so they read through `get_my_invites()` instead. Writes are RPC-only (INSERT/UPDATE/DELETE revoked from `authenticated`, everything revoked from `anon`).

### `platform_admins` — super-admin allowlist (added 2026-07-02)
`user_id` (PK, FK → `auth.users`), `created_at`. **Defended two ways (since migration `0003`, applied 2026-08-18):** the `anon`/`authenticated` grants are revoked outright (`relacl` = `{postgres, service_role}`), **and** RLS is enabled with zero policies = default-deny. Either alone denies every client role; both together mean disabling RLS does not silently reopen the allowlist, and a client read returns a permission error rather than an empty array. Rows are added only via the SQL Editor — there is deliberately no client path (see `supabase/phases/phase-d-platform-admin.sql`). **Holds one admin as of 2026-08-18** (`senjaliyameet8@gmail.com`).

### `trek_batches` — a dated departure
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `trek_id` | uuid | **NOT NULL**, FK → `treks(id)` |
| `batch_date` | date | **NOT NULL** |
| `max_participants` | integer | per-batch capacity; seeded from `treks.max_participants` by `join_trek_and_chat` at batch creation. `> 0` (`trek_batches_max_participants_positive`, 0009). NULL = unlimited. |
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
| | | **INDEX** `trek_reviews_user_idx (user_id)` — the unique leads with `trek_id`, so the `user_id` FK was unindexed (2026-08-12) |

### `favorites` — wishlist (no surrogate PK)
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | **NOT NULL**, FK → `profiles(id)` |
| `trek_id` | uuid | FK → `treks(id)` |
| `created_at` | timestamptz | `now()` |
| | | **UNIQUE(`user_id`, `trek_id`)** |
| | | **INDEX** `favorites_trek_idx (trek_id)` — the unique leads with `user_id`, so the `trek_id` FK was unindexed (2026-08-12) |

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
| `last_read_at` | timestamptz | **NOT NULL**, `now()` — unread-count watermark; read by `get_unread_counts()`, advanced by `mark_conversation_read()` |
| | | **UNIQUE(`conversation_id`, `user_id`)** — was **two** byte-identical uniques until 2026-08-12; the Postgres-default-named duplicate (`…_conversation_id_user_id_key`) was dropped, since every `on conflict (conversation_id, user_id)` infers its arbiter from the column list, not a constraint name |
| | | **INDEX** `conversation_participants_user_conv_idx (user_id, conversation_id)` — the unique leads with `conversation_id`, so "which chats am I in?" (the driving side of `get_unread_counts()`, and the `/messages` sidebar) had no usable index. Covering for both; also indexes the `user_id` FK |

### `conversation_messages` — chat messages
Composite **PK (`created_at`, `id`)**.

**Indexes** — `conversation_messages_conv_created_idx (conversation_id, created_at desc)` (2026-08-12) and `conversation_messages_user_created_idx (user_id, created_at desc)` (2026-08-05, for the §13 flood trigger). The first is the read path: `fetchMessagesPage()` filters `conversation_id` then takes `order by created_at desc limit 30`, so that column order serves the filter *and* the sort from one range scan (no Sort node, stops after 30 rows). Before it, nothing led with `conversation_id` and every conversation open was a sequential scan of the fastest-growing table here.

| Column | Type | Notes |
|---|---|---|
| `conversation_id` | uuid | **NOT NULL**, FK → `conversations(id)` |
| `user_id` | uuid | **NOT NULL**, FK → `profiles(id)` |
| `message` | text | **NOT NULL**, ≤ 2000 chars (`conversation_messages_message_len`, 0009) and non-blank after trim **unless the row is soft-deleted** (`conversation_messages_message_not_blank`, 0010). The `is_deleted` arm exists because deletion blanks the text; `is_deleted` is pinned to false on INSERT by the `Send messages` policy, so a message can only be *born* live and non-blank |
| `created_at` | timestamptz | **NOT NULL**, `now()`, part of PK |
| `id` | uuid | `gen_random_uuid()`, part of PK |
| `updated_at` | timestamptz | edit timestamp |
| `is_deleted` | boolean | soft-delete (default `false`). **Pinned to false on INSERT** by the `Send messages` policy since 0010 — deletion is an UPDATE, and letting a row arrive pre-deleted was the escape hatch in `conversation_messages_message_not_blank` (blank + `is_deleted = true` satisfies the CHECK). The UPDATE policy deliberately does *not* pin it, or nothing could ever be deleted |
| `reply_to` | uuid | references another message id (no FK) |
| `reactions` | jsonb | `{ "emoji": [userId, …] }`, default `{}` |
| `is_announcement` | boolean | **NOT NULL**, default `false` (2026-08-08). Operator notice rather than a peer message; rendered on `/messages` as an amber `Megaphone` notice with no reply/react/edit affordances. **Only `post_batch_announcement()` can set it** — both write policies pin it to `false`, so a trekker cannot forge one through PostgREST. Consequence: an announcement is immutable through the table API, soft-delete included. |

### `user_stats` — per-user aggregate (1:1)
`treks_completed`, `treks_organised` (int ≥ 0), `total_distance_km` (≥ 0), `last_updated` (touched by trigger). **PK** `user_id`. **System-managed: read-only to clients** (SELECT own row only; no INSERT/UPDATE policy). Rebuilt from source by `recompute_user_stats()` (triggers + daily pg_cron). `treks_completed`/`total_distance_km` = **confirmed** joined batches whose `batch_date` has passed (follow-up #2). `treks_organised` stays 0 (no organiser column yet); `avg_rating` was dropped (no per-user source).

### `user_monthly_activity` — per-user monthly counters
**PK (`user_id`, `month`)**; `month` `CHECK extract(day) = 1`. Counters: `treks_joined`, `photos_shared`, `reviews_written`, `distance_km` (all `CHECK ≥ 0`). **System-managed: read-only to clients** (same model as `user_stats`).

### `user_achievements` — earned badges (gamification)
**PK (`user_id`, `achievement_key`)**; `earned_at` timestamptz. **Append-only, system-managed: read-only to clients** (SELECT own rows only; INSERT/UPDATE/DELETE revoked — written exclusively by `award_user_achievements()`, chained off `recompute_user_stats()`). Badge catalog (key → name/icon/description) lives in `src/lib/achievements.ts`; criteria thresholds live in `award_user_achievements()`. 15 badges keyed on treks joined (entry-level "Trailblazer"), completed-trek count, total distance, distinct locations, Hard/Expert completions, distinct active months, reviews written, and photos shared.

### `rate_events` — append-only rate-limit counter (added 2026-08-05)
`id` bigint identity **PK**, `actor` uuid **NOT NULL** FK → `auth.users(id)` ON DELETE CASCADE, `action` text **NOT NULL** (`'join'` | `'invite'` | `'trek_email'` | the storage actions from `storage_rate_rule()`), `at` timestamptz default `now()`. Indexed `(actor, action, at desc)`. **Invisible to clients: RLS on with ZERO policies *and* all grants revoked from `anon`/`authenticated`**, so it is not reachable through PostgREST at all — a user can neither read their own counter nor delete it to reset a limit. Written only by the SECURITY DEFINER functions in §6 (which bypass RLS). Logged **only** where the evidence of an action does not survive (leaving a trek deletes the `trek_participants` row; a failed invite lookup writes nothing) — chat flood counts real `conversation_messages` rows instead, since they are soft-deleted and never removed. Pruned hourly by the `prune-rate-events` pg_cron job (keeps 1 day; only the last hour is ever read).

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
| `mark_conversation_read(uuid)` | void | **DEFINER** | pinned (`public`) | Advances the caller's `conversation_participants.last_read_at` to `now()`. DEFINER because the table has no UPDATE policy; the `user_id = auth.uid()` predicate is what scopes the write. Called by `markConversationRead()` in `src/lib/chat.ts`. |
| `get_unread_counts()` | setof (`conversation_id`, `unread`) | **DEFINER** | pinned (`public`) | Per-conversation unread badge counts: other users' non-deleted messages newer than `last_read_at`. Called by `getUnreadCounts()` in `src/lib/chat.ts`. Anon holds EXECUTE (default PUBLIC grant) but gets an empty set — `auth.uid()` is null so the join matches nothing (§11). |
| `is_approved_company_member(uuid)` | boolean | **DEFINER** | pinned | `is_company_member()` AND the company is `approved`. **The publishing tier** (2026-08-08): backs the `treks` + `trek_batches` write policies and the `trek-images` bucket. Orphaned from the multi-tenant migration until then. |
| `is_company_writable(uuid)` | boolean | **DEFINER** | pinned | The frozen/not-frozen test (2026-08-08): company `status ∈ (pending, approved)`. About the **company only** — composed with `is_company_member`/`is_company_admin` at each call site rather than forking those into status-aware twins. Backs `companies` UPDATE, `company_members` UPDATE/DELETE, the `company-logos` bucket, `invite_company_member` and `accept_company_invite`. DEFINER because two callers can't see the `companies` row under RLS: the invitee in `accept_company_invite()`, and the `companies` UPDATE policy itself (which must not recurse into `view companies`). Mirrored in the app as `isCompanyFrozen()` in `src/lib/company.ts`. |
| `handle_new_user()` | trigger | **DEFINER** | pinned | Creates `profiles` row on signup. ⚠️ exposed via RPC (revoke EXECUTE). |
| `join_trek_and_chat(uuid,uuid,date)` | jsonb | **DEFINER** | pinned | The one write path for joining; derives caller from `auth.uid()`, refuses acting for others. Enforces per-batch capacity under a `FOR UPDATE` row lock — full batches return `status:'waitlisted'` (no chat seat) with a `waitlist_position` (FIFO, tie-broken by `(joined_at, id)` — follow-up #5); otherwise `'confirmed'`. |
| `get_trek_participant_count(uuid)` | integer | INVOKER | pinned | **Confirmed** participant count across a trek's batches (excludes waitlisted). |
| `promote_waitlist_on_leave()` | trigger | **DEFINER** | pinned | After a confirmed participant leaves, promotes the oldest waitlisted joiner (FIFO) to confirmed and adds them to the batch chat. EXECUTE revoked from anon/authenticated. |
| `get_trek_avg_rating(uuid)` | numeric | INVOKER | pinned | Live average of a trek's `trek_reviews.rating`, rounded to 1 dp; `null` when unrated. Single-trek card views (home page). Granted to anon + authenticated. |
| `search_treks(…, p_company_id uuid)` — 12 args | setof rows | INVOKER | pinned | Explore page read path: FTS + filters (location/difficulty/distance/price/date) + sort + pagination in one call. `rating` is the live average of `trek_reviews` (numeric, 1 dp, `null` when unrated); the `rating` sort orders by it. Returns `total_count` per row (window count). A search that sanitizes to empty (e.g. punctuation-only `!!!`) returns **no matches** rather than the whole catalog (follow-up #3). **Rewritten 2026-07-02 (multi-tenant):** only returns treks that are `is_active` with an `approved` company; returns `company_id`/`company_name`/`company_slug`; optional `p_company_id` filter for the `/company/[slug]` storefront. The old 11-arg overload was dropped. Granted to anon + authenticated. |
| `is_platform_admin()` | boolean | **DEFINER** | pinned | Caller ∈ `platform_admins`? Gates moderation RPCs + `/admin` layout. Granted to authenticated. |
| `is_company_member(uuid)` / `is_company_admin(uuid)` | boolean | **DEFINER** | pinned | Membership / owner-or-admin checks; back every company-scoped RLS policy (same no-recursion pattern as `is_chat_participant`). |
| `is_trek_visible(uuid)` | boolean | **DEFINER** | pinned | Single source of truth for trek visibility: `(is_active AND company approved) OR company member OR platform admin OR caller has a booking on one of the trek's batches`. The participant arm keeps a user's own booking readable after archive/suspension; it doesn't re-list the trek publicly (`search_treks` filters active+approved directly). Used by `treks` + `trek_batches` SELECT policies. Granted to anon + authenticated (policies run as the caller). |
| `apply_for_company(text,text,text,text,text,text)` | jsonb | **DEFINER** | pinned | The ONLY way to create a company: forces `status='pending'`, makes the caller the `owner` member atomically. Raises user-facing errors (blank name, bad slug, duplicate pending/slug). |
| `approve_company(uuid)` / `reject_company(uuid,text)` / `suspend_company(uuid,text)` | void | **DEFINER** | pinned | Platform-admin-only moderation (checked **inside** each function, not just via grants). Approve sets `approved_by/at`; reject/suspend record a reason. |
| `get_company_batch_participants(uuid)` | setof rows | **DEFINER** | pinned | The ONLY path for company staff to see participant PII (name/phone/emergency). Re-checks the caller's membership against the batch's owning company; returns an **empty set** (not an error) for foreign batches. |
| `get_trek_batch_confirmed_counts(uuid)` | setof rows | **DEFINER** | pinned | Confirmed-participant count per batch for one trek — **no PII** (batch id + integer). Powers the departure list without fanning out the roster RPC per batch. Same membership re-check; **empty set** for non-members/foreign treks. |
| `get_company_members(uuid)` | setof rows | **DEFINER** | pinned | Team roster (name/email/avatar/role) for a company the caller belongs to. `profiles` is self-only under RLS, so the roster is mediated here. Returns an **empty set** for non-members. Added Phase C. |
| `invite_company_member(uuid,text)` | jsonb | **DEFINER** | pinned | Owner/admin-only; re-checks `is_company_admin()` internally and raises for non-admins. **Since 2026-08-06 it writes a pending `company_invites` row instead of a membership** — there was no consent step, and once accepting converts an account, inviting someone would have ended their account without asking. Sweeps expired pendings to `revoked` first (the partial unique index would otherwise make a timed-out invitee permanently un-invitable). Returns `{invite_id}`, or `{already_member}` / `{error:'already_invited'}` / `{error:'not_found'}` / `{error:'rate_limited'}` / `{error:'company_frozen'}` (2026-08-08 — a rejected/suspended company can't invite; checked **before** the rate-limit insert, since a frozen caller is refused before it learns anything and there's nothing to meter). **Rate-limited 20 probes/hour/user (2026-08-05)** — it answers whether an email has a Trekker account, so uncapped it enumerates a mailing list; the unknown-email case **returns** rather than raises, because a raise would roll back the `rate_events` row recording the attempt and every failed probe would erase its own evidence. |
| `get_my_invites()` | setof rows | **DEFINER** | pinned | The invitee's side: pending, unexpired invites addressed to the caller's **own** `profiles.email` (derived server-side, never an argument or a JWT claim), with company name/slug/logo and the inviter's name. DEFINER because the invitee is not a member yet — `companies` hides an unapproved company from them and `profiles` is self-only, the same wall `get_company_members()` exists to get around. Signed out → empty. Added 2026-08-06. |
| `accept_company_invite(uuid)` | jsonb | **DEFINER** | pinned | **The only client path from `trekker` to `company`.** Validates the invite is pending, unexpired and addressed to the caller's own email, so an invite id is not a bearer token. Branches on the **raw `account_type`**, deliberately not `is_trekker()` (true for platform admins whatever the column says): already-`company` just gains the membership; `trekker` runs the upcoming-trek refusal, then flips via the `app.account_type_change` GUC and inserts the membership in one transaction. Refuses while the caller holds **any** participation (confirmed *or* waitlisted — `promote_waitlist_on_leave()` ignores `account_type`, so a waitlisted row can activate itself post-conversion) on a batch dated today or later. **Also re-checks the company is not frozen, at ACCEPT time** (2026-08-08): an invite issued while approved stays a live row after a reject/suspend, and accepting it would trade a trekker's account irreversibly for a seat on a tenant that can do nothing. Checked *after* the invite lookup, so a non-owner still gets `no longer valid` and learns nothing about the company's status. Returns `{company_id, converted}`. Added 2026-08-06. |
| `decline_company_invite(uuid)` | jsonb | **DEFINER** | pinned | Same ownership rule as accept (matched on the caller's own email). Sets `declined`. Added 2026-08-06. |
| `revoke_company_invite(uuid)` | jsonb | **DEFINER** | pinned | The company's side; gated on `is_company_admin()` of the invite's company. Sets `revoked`. Added 2026-08-06. |
| `post_batch_announcement(uuid,text)` | jsonb | **DEFINER** | pinned | The **only** writer that can set `is_announcement` — both `conversation_messages` write policies pin it to `false`, and this function bypasses them (owned by `postgres`, which owns the table, no `FORCE ROW LEVEL SECURITY`). Gated on `is_approved_company_member()` of the batch's owning company (the manage-departures tier, not the looser roster tier). Restates the 2000-char cap server-side. Refuses in two distinct cases, with distinct messages the client shows verbatim: no conversation → *No one has booked this departure yet*; conversation with **zero participants** → *Everyone has left this departure…* (added 2026-08-12 — the conversation outlives its members, so existence is not readership and a vacated departure was accepting announcements no one would read). Inherits the 30/min chat cap free: the AFTER STATEMENT trigger reads `auth.uid()`, which inside a definer function is still the caller. Added 2026-08-08. |
| `get_batch_announcements(uuid)` | setof rows | **DEFINER** | pinned | Dashboard read-back, because the author cannot `SELECT` the row it just wrote — that policy is `is_chat_participant()` and the company user is never a participant. Gated on the looser `is_company_member()` (a frozen company can still review what it sent); **empty set**, not an error, for non-members. Added 2026-08-08. |
| `enforce_message_rate_limit()` | trigger | **DEFINER** | pinned | Chat flood cap, **30 messages/minute/user**. Counts real `conversation_messages` rows (soft-deleted, never removed). Statement-level so PostgREST bulk inserts are covered. No-ops when `auth.uid()` is null (service-role writes). |
| `enforce_join_rate_limit()` | trigger | **DEFINER** | pinned | Join cap, **10 joins/hour/user** — the cost is outbound email (`notify_trek_participation()` fires on INSERT *and* DELETE, so a join/leave cycle mails real people twice). Counts `rate_events` because leaving deletes the participant row. No-ops when `auth.uid()` is null (waitlist promotion). |
| `enforce_storage_rate_limit()` | trigger | **DEFINER** | pinned | Upload cap on `storage.objects`, **6/hour/user** (`avatars`/`company-logos`/`trek-images`) and **20/hour** (`trek-reviews`, whose form uploads N photos per submit). Fires on INSERT **and** UPDATE — `avatars` upserts to a fixed path, so every write after the first is an UPDATE; skips UPDATEs whose `version` is unchanged (renames, metadata touches). Counts `rate_events` because avatars are one row forever and review photos are user-deletable. Lives in `public` because `postgres` lacks `CREATE` on the `storage` schema. **Identifies the user from `new.owner`, not `auth.uid()`** — `auth.uid()` is NULL inside this trigger on the storage-api path (verified live 2026-08-05) even though RLS policies on the same INSERT resolve it, which made the first version silently inert; no-ops when both are null so service-role/seeded writes are never blocked. |
| `enforce_trek_email_rate_limit()` | trigger | **DEFINER** | pinned | **Added 2026-09-02 (`0012`).** Notification-email cap, **10 trek emails/hour/recipient**, on `rate_events` itself — `BEFORE INSERT ... WHEN (new.action = 'trek_email')`. The two edge functions used to enforce this in TypeScript, but both hold the SECRET key and bypass RLS on `rate_events`, so the count was a policy the caller applied to itself; making the insert the gate means a send cannot be recorded without being counted. Takes a `pg_advisory_xact_lock` on the recipient first: check-then-insert let ten concurrent webhook calls each read a count of 9 and each send. BEFORE, not AFTER, so the row being inserted is not in its own count. |
| `storage_rate_rule(text)` | `(v_action text, v_limit int)` | INVOKER (immutable) | pinned | The bucket → (action, limit) mapping, in one place because `enforce_storage_rate_limit()` and `upload_rate_limited()` both read it — two copies of "6" would drift on the first tuning pass and the app would report a limit that isn't the one enforced. Returns NULLs for an uncovered bucket (`trek-profile`, anything new); both callers treat that as "not covered". EXECUTE revoked from `public`/`anon`/`authenticated` — both callers are DEFINER and owned by `postgres`. |
| `upload_rate_limited(text)` | boolean | **DEFINER** (stable) | pinned | **Added 2026-08-08.** Answers "is the caller out of upload budget for this bucket right now?". Exists because **storage-api does not forward a database error message** — it answers a trigger raise with 500 and a body of `{}`, which supabase-js turns into the message `"{}"`, so a rate-limited upload was indistinguishable from any other failure and the user was told to retry (impossible for another hour). No errcode avoids this: storage-api maps 42501 to its own RLS text, 23505/23503 to key/bucket errors, everything else to an opaque 500. [src/lib/uploadErrors.ts](src/lib/uploadErrors.ts) calls it **only after an upload has already failed** with an unrecognised error, so the happy path costs no round trip. Read-only and consumes no budget, so probing after a rejection can't push the caller further into the limit. Returns one boolean about the caller's **own** counter — `rate_events` keeps zero policies and zero grants, so no count, timestamp or other actor leaks. EXECUTE: `authenticated` only. `auth.uid()` **is** reliable here (ordinary PostgREST call, not the storage-api trigger context). |
| `admin_list_companies(text)` / `admin_get_company(uuid)` | setof `companies` | **DEFINER** | pinned | Platform-admin-only reads that return the audit columns (`created_by`/`approved_by`/`approved_at`) the base-table client SELECT grant excludes. Raise for non-admins. EXECUTE revoked from PUBLIC + `anon`, granted to `authenticated`. |
| `protect_company_admin_fields()` | trigger | **DEFINER** | pinned | BEFORE UPDATE on `companies`: pins `slug`/`status`/`approved_by`/`approved_at`/`rejection_reason`/`created_by` to OLD unless caller is a platform admin (blocks self-approval + slug hijack). EXECUTE revoked from clients. |
| `update_user_stats_timestamp()` | trigger | INVOKER | pinned | Touch `user_stats.last_updated`. |
| `recompute_user_stats(uuid)` | void | **DEFINER** | pinned | Rebuilds a user's `user_stats` + `user_monthly_activity` from source (idempotent), then calls `award_user_achievements()`. Aggregates **confirmed participations only** (follow-up #2). EXECUTE revoked from clients; called by triggers + daily pg_cron. |
| `award_user_achievements(uuid)` | void | **DEFINER** | pinned | Evaluates the 15-badge catalog from source metrics (**confirmed participations only** — follow-up #2) and appends newly-qualifying badges to `user_achievements` (idempotent, on conflict do nothing — never removes). EXECUTE revoked from clients; called by `recompute_user_stats()`. |
| `get_user_profile(uuid)` | jsonb | INVOKER | pinned | One read path for the profile page: `{ stats, current_month, achievements[] }` in a single round trip. INVOKER so own-row RLS still applies; `p_user_id` defaults to `auth.uid()`. Granted to `authenticated`. |
| `trg_recompute_user_stats()` | trigger | **DEFINER** | pinned | Trigger glue → `recompute_user_stats()` for the affected user. |
| `on_user_join_trek()` | trigger | INVOKER | pinned | No-op (legacy). |
| `create_trek_initial_message()` | trigger | INVOKER | pinned | Inserts into non-existent `trek_messages` — its trigger was **dropped 2026-07-02** (multi-tenant migration), so trek creation no longer errors. Function kept, unused. |
| `update_participants_count()` | trigger | **DEFINER** | pinned | Recomputes `treks.participants_joined` on join/leave; counts **confirmed only** as of follow-up #1 (2026-06-22). Attached & enabled via `trek_participants_count_trigger`. (Replaced the old dead version that referenced `trek_participants.trek_id`.) |
| ~~`notify_trek_join()` / `notify_trek_remove()`~~ | ~~trigger~~ | ~~INVOKER~~ | — | ❌ **dropped 2026-08-26 in `0007`.** `pg_net` POST to a `trek-email-notification` edge fn that was never deployed (EDGE-001); redundant with the webhook triggers, and carried a hard-coded legacy anon key in the live bodies. |
| `notify_trek_participation()` | trigger | **DEFINER** | pinned | The **only** notification path on `trek_participants` — `pg_net` POST to `send-trek-notification` (INSERT) / `send-trek-leave-notification` (DELETE). DEFINER so it can read the webhook secret from `vault.decrypted_secrets` (`edge_function_token`), sent on `x-trek-webhook-secret`; **no `apikey` header and no key literal in the body as of `0008`** (applied + read back in `pg_proc` 2026-08-26) — the gateway routes `verify_jwt=false` functions without one, so an embedded key was only a rotation trap. Skips silently when the Vault secret is missing, and `exception when others` keeps a failed notification from rolling back the join/leave. |

---

## 7. Triggers

| Table | Trigger | Timing/Event | Calls | Status |
|---|---|---|---|---|
| `auth.users` | `on_auth_user_created` | AFTER INSERT | `handle_new_user()` | ✅ active |
| `user_stats` | `trg_update_user_stats_timestamp` | BEFORE UPDATE | `update_user_stats_timestamp()` | ✅ active |
| `trek_participants` | `trg_participant_stats` | AFTER INSERT/DELETE | `trg_recompute_user_stats()` | ✅ active |
| `trek_participants` | `trek_participants_count_trigger` | AFTER INSERT/DELETE | `update_participants_count()` | ✅ active — maintains `treks.participants_joined` (confirmed only) |
| `trek_reviews` | `trg_review_stats` | AFTER INSERT/UPDATE/DELETE | `trg_recompute_user_stats()` | ✅ active |
| `treks` | ~~`trg_initial_trek_message`~~ | ~~AFTER INSERT~~ | `create_trek_initial_message()` | ❌ **dropped 2026-07-02** (multi-tenant migration) — used to error every trek insert |
| `companies` | `trg_protect_company_admin_fields` | BEFORE UPDATE | `protect_company_admin_fields()` | ✅ active — blocks self-approval + slug rename |
| `profiles` | `trg_protect_profile_account_type` | BEFORE UPDATE | `protect_profile_account_type()` | ✅ active (2026-08-06) — pins `account_type`. Two exemptions: `auth.uid() is null` (SQL Editor) and platform admins; plus the `app.account_type_change='allow'` GUC hatch used only by `accept_company_invite()` |
| `trek_participants` | `trek-join-notification` | AFTER INSERT | webhook → `send-trek-notification` | ✅ active |
| `trek_participants` | `trek-leave-notification` | AFTER DELETE | webhook → `send-trek-leave-notification` | ✅ active |
| `trek_participants` | ~~`trek_join_email_trigger`~~ | ~~AFTER INSERT~~ | `notify_trek_join()` | ❌ **dropped 2026-08-26 in `0007`** — posted to an edge fn that was never deployed |
| `trek_participants` | ~~`trek_remove_email_trigger`~~ | ~~AFTER DELETE~~ | `notify_trek_remove()` | ❌ **dropped 2026-08-26 in `0007`** — same |
| `trek_participants` | `trek_participants_waitlist_promote` | AFTER DELETE | `promote_waitlist_on_leave()` | ✅ active — FIFO waitlist promotion |
| `conversation_messages` | `conversation_messages_rate_limit` | AFTER INSERT — **FOR EACH STATEMENT** | `enforce_message_rate_limit()` | ✅ active (2026-08-05) — 30 msg/min. Statement-level on purpose: a per-row check can't see its own statement's siblings, so a PostgREST array insert would pass every row through a count of 0 |
| `trek_participants` | `trek_participants_rate_limit` | AFTER INSERT — FOR EACH ROW | `enforce_join_rate_limit()` | ✅ active (2026-08-05) — 10 joins/hr. A trigger, not a check inside `join_trek_and_chat()`, because the "Users can join treks" policy permits a direct INSERT that skips the RPC |
| `rate_events` | `rate_events_trek_email_rate_limit` | BEFORE INSERT — FOR EACH ROW, `WHEN (new.action = 'trek_email')` | `enforce_trek_email_rate_limit()` | ✅ active (2026-09-02, `0012`) — 10 notification emails/hr/recipient. On the log table rather than a table the app writes: the sender is an edge function holding the SECRET key, so the only write it cannot skip is the one that records the send |

> `trek_participants` had **two** INSERT and **two** DELETE notification triggers — one working webhook pair plus one dead `pg_net` pair. The dead pair was dropped in `0007`; `trek-join-notification` / `trek-leave-notification` are now the only notification triggers on the table.

---

## 8. RLS policy matrix

RLS is enabled on all 16 public tables. `auth.uid() = …` checks appear under both the `public` and `authenticated` roles in the live DB; effect is the same (anon has no `uid`).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | own (`id = uid`) | own | own | — |
| `treks` | **two policies, OR'd.** `to public`: `is_trek_visible(id)` (public rule: active + company approved; members/platform admins see own/all; participants keep read access to treks they've booked). `to authenticated`: `is_approved_company_member(company_id)` — added 2026-08-13 so `INSERT … RETURNING` can be satisfied (see note below); grants nothing new | **approved** company member | **approved** company member, or platform admin | — (soft-delete via `is_active`; closed too while frozen) |
| `trek_batches` | `is_trek_visible(trek_id)` | **approved** company member (of parent trek) | **approved** company member | **approved** company member **AND no participants AND no chat conversation** (`batch_has_participants` / `batch_has_conversation`, both DEFINER; a lingering conversation FK would otherwise reject the delete) |
| `companies` | approved, or own-company member, or platform admin | — (RPC only) | company owner/admin **of a writable company**, or platform admin (workflow columns trigger-pinned) | — (suspend, never delete) |
| `company_members` | own-company members + platform admins | **— (no policy, INSERT revoked; RPC-only since 2026-08-06)** | company owner/admin **of a writable company**, non-owner rows, target role ∈ admin/staff | company owner/admin **of a writable company**, non-owner rows |
| `company_invites` | own-company members + platform admins | — (RPC only) | — (RPC only) | — (RPC only) |
| `platform_admins` | — | — | — | — (**grants revoked + zero policies — SQL Editor only; `0003`**) |
| `trek_participants` | **own** (`user_id = uid`) | own | own | own |
| `trek_reviews` | **public `true`** | own **AND joined the trek** | own | own |
| `favorites` | own | own | — | own |
| `conversations` | `is_chat_participant(id)` *(`to authenticated`)* | — | — | — |
| `conversation_participants` | `is_chat_participant(cid)` *(`to authenticated`)* | `service_role` only | — | own (`user_id = uid`) |
| `conversation_messages` | `is_chat_participant(cid)` *(`to authenticated`)* | own **AND** participant **AND** `is_announcement = false` *(`to authenticated`)* | own **AND** `is_announcement = false` | own |
| `realtime.messages` | exists a `conversations` row where `'conversation:' || id = realtime.topic()` **AND** `is_chat_participant(id)` *(`to authenticated`; 0004 — owned by `supabase_realtime_admin`, managed via Dashboard → Database → Realtime → Policies, not a migration)* | same qual, `with check` | — | — |
| `user_stats` | own | — (system) | — (system) | — |
| `user_monthly_activity` | own | — (system) | — (system) | — |
| `user_achievements` | own | — (system) | — (system) | — (system) |
| `rate_events` | — | — | — | — (**zero policies + grants revoked — DEFINER functions only**) |

Key design points:
- **No public read of `profiles`** — PII is protected; cross-user names/avatars come from `public_profiles`.
- **`trek_participants` is own-row only** (NEW-4) — closes the logged-out + cross-user social-graph leak.
- **Reviews require participation** (NEW-3) — the INSERT `WITH CHECK` verifies a matching `trek_participants → trek_batches` row for the trek.
- **Chat writes** are membership-gated; `conversation_participants` INSERT is `service_role`-only, so users are added only via the `join_trek_and_chat` RPC (SECURITY DEFINER).
- **Trek/batch writes are company-scoped** (2026-07-02): every policy goes through the company helpers, never a client-supplied flag — the IDOR/cross-tenant boundary. Participants still join batches only via `join_trek_and_chat`.
- **Company writes carry a status tier** (2026-08-08): `is_company_writable()` = `pending`+`approved` (settings, team, logos); `is_approved_company_member()` = `approved` only (treks, batches, trek images). Rejected and suspended tenants are **read-only** — before this, status gated reads only, so a rejected company kept full write access to its own tenant. Bare `is_company_member`/`is_company_admin` in a **write** policy is now a bug: it silently un-freezes. SELECT is deliberately never status-gated (`is_trek_visible` handles read visibility, and staff plus existing bookers must keep reading a hidden trek), and neither are the `is_platform_admin()` arms — freezing must not lock out the role that un-freezes.
- **No client path to owner or platform-admin**: `role='owner'` is written only by `apply_for_company()`; the INSERT policy allows `'staff'` only and UPDATE's WITH CHECK excludes `'owner'`. `platform_admins` is default-deny with zero policies.
- **PII stays out of company hands**: staff never get SELECT on `profiles`; rosters come only from `get_company_batch_participants()`, which re-checks membership per batch.
- **A SELECT policy whose predicate reads its own table cannot satisfy `INSERT … RETURNING`** (2026-08-13). Postgres applies the SELECT policy to rows returned by `RETURNING`, and `is_trek_visible()` is `stable` with a body that selects from `public.treks` — so it evaluates against the statement's *pre-insert* snapshot and cannot see the row being created. It returns false and the insert is rejected with a `with_check`-shaped error naming the wrong policy. This broke `createTrek()` for every caller, platform admins included. Fixed with a **second** permissive SELECT policy scoped `to authenticated`, whose predicate reads `company_members`/`companies` and never `treks`. ⚠️ It could **not** be folded into `view treks` as an `or` arm: that policy is `to public`, and `is_approved_company_member` is revoked from `anon`, so every anonymous `/explore` read would raise `permission denied for function`.
- **A policy's role list and its predicate's EXECUTE grant must agree** (2026-08-13). A `to public` policy is evaluated for `anon`, so if its qual calls a DEFINER function `anon` cannot execute, anonymous access raises `permission denied for function` instead of returning an empty set. It fails closed, but the shape resolves in **both** directions here: `is_trek_visible`/`is_company_member`/`is_platform_admin` keep their `anon` grant because `/explore` genuinely needs them, while the four chat policies calling `is_chat_participant` were re-scoped `to authenticated` because chat has no anonymous read path. Check both halves when adding either.
- **Rate limits live in Postgres, not the app** (2026-08-05): the publishable key ships in the client bundle, so a limit enforced in a Route Handler is bypassed by calling PostgREST directly — only Postgres sees every path. See §7's three rate-limit triggers and `invite_company_member`'s inline cap, plus the per-upload size/MIME caps on the buckets in §9.

---

## 9. Storage

Buckets (all **public**; **all five** capped at **3 MiB / `image/jpeg`,`image/png`,`image/webp`** — four since 2026-08-05, `trek-profile` since 2026-08-25 in `0005`, applied and read back over MCP at 11:18:08+00, no exceptions left):

| Bucket | Read | Write | Notes |
|---|---|---|---|
| `avatars` | **own prefix** SELECT (`0006`) | owner-scoped INSERT/UPDATE/DELETE | path `{uid}/file` **or** `{uid}.ext` — the SELECT policy accepts **both**, because `foldername()` returns `{}` for a flat name and 1 live object still uses that layout |
| `trek-reviews` | **own prefix** SELECT (`0006`) | owner-scoped INSERT/DELETE (no UPDATE) | path `{uid}/file` |
| `trek-profile` | — | — | public bucket, **no object policies**; reachable only by public URL. Likely unused (14 legacy objects). Was deliberately uncapped for that reason; capped in `0005` so "every bucket restricts Content-Type" is an invariant with no exceptions — see the nosniff note below. |
| `company-logos` | **own company** SELECT (`0006`, `is_company_member`) | company-member-scoped INSERT/UPDATE/DELETE, **writable companies only** | added 2026-07-02; path `{company_id}/file` — first segment must be a company UUID the caller belongs to |
| `trek-images` | **own company** SELECT (`0006`, `is_company_member`) | company-member-scoped INSERT/UPDATE/DELETE, **approved companies only** | added 2026-07-02; path `{company_id}/…` (convention: `{company_id}/{trek_id}/file`) |

⚠️ **Advisor `public_bucket_allows_listing` — CLOSED 2026-08-25 in [`0006`](supabase/migrations/0006_scope-storage-select-to-own-prefix.sql).** All four buckets shipped with `using (bucket_id = '<bucket>')` for `authenticated`, which blocked *anon* listing but let **any signed-in account list every other account's folder** — every user UID and filename in `avatars`/`trek-reviews`, every company UUID in `company-logos`/`trek-images` — because storage-api's list endpoint is a plain SELECT over `storage.objects`. `0006` narrows each to the caller's own prefix. Nothing broke: all five buckets are public, so images resolve through the CDN path with no session and no RLS (`getPublicUrl()` builds a string and makes no request), and the app has **no `list()`, `download()` or `createSignedUrl()` call anywhere** — the only authenticated read is the upload's own `RETURNING`, which every writer still satisfies for its own prefix. Only `trek-profile` remains flagged, and it has no SELECT policy to narrow. Pinned by `tests/db/storage-listing.test.ts`, whose last case fails any future SELECT policy whose qual tests nothing but `bucket_id`.

⚠️ **The company buckets cast `foldername(name)[1]` to `uuid` on read.** A non-uuid *folder* under `company-logos`/`trek-images` would raise `22P02` for every authenticated reader instead of filtering the row out. Nothing client-side can create one — the INSERT policies carry the same cast, so such a write is rejected before the row exists, and a flat name yields NULL rather than an error. Only a `service_role` write (a manual dashboard upload into e.g. `temp/`) could introduce one. Verified 0 such objects live at the time `0006` was written.

⚠️ **`allowed_mime_types` is the nosniff substitute, not just a size guardrail.** Public objects are served by storage-api on `*.supabase.co` **without `X-Content-Type-Options: nosniff`**, and there is no configuration for that header — the nosniff in `next.config.mjs` applies to the Next.js origin only, which is not where any image resolves (STORAGE-002). Browsers sniff a missing, generic (`application/octet-stream`, `text/plain`) or unknown Content-Type and take a concrete `image/*` at its word, so restricting every bucket to real image types produces the same end state nosniff would. **A new bucket without an allowlist reopens the finding** — `tests/db/storage-content-type.test.ts` fails until it has one. Residual: storage-api validates the *declared* type and never inspects the bytes, so HTML uploaded as `image/png` is stored and served as `image/png`; current engines render that as a broken image, and it lands on the `supabase.co` origin where no app session cookie is reachable.

**Write policies carry the same status tier as the table each bucket feeds (2026-08-08).** `company-logos` → writable (`pending`+`approved`, so an applicant can upload branding while it waits); `trek-images` → approved-only, matching `treks`. This is not redundant with the table gates: both buckets are **public**, so a write policy left on bare membership lets a frozen company overwrite its logo and cover at the exact CDN paths the storefront already links to — changing what the public sees without any `companies` row changing. SELECT deliberately does **not** carry the tier — `0006` scopes it with `is_company_member`, not `is_company_writable`/`is_approved_company_member`, so a frozen tenant can still read back its own files (and re-upload, since `upsert` checks `RETURNING` against SELECT). Public delivery is unaffected either way: existing images resolve over the CDN for anyone holding a booking, with no session involved.

**Upload rate limit (2026-08-05).** `storage.objects` carries `storage_objects_rate_limit`, an `AFTER INSERT OR UPDATE FOR EACH ROW` trigger running `public.enforce_storage_rate_limit()` — **6 uploads/hour/user** across `avatars`/`company-logos`/`trek-images`, **20/hour** for `trek-reviews`. It fires on UPDATE as well as INSERT because `avatars` uses the fixed path `{uid}.ext` with `upsert:true`, so after the first upload every avatar write is an UPDATE; a version check keeps renames and metadata touches from consuming budget. Counted in `rate_events` (not from `storage.objects`) because avatars are one row forever and review photos are user-deletable. The function lives in `public`, not `storage`: `postgres` holds `TRIGGER` on `storage.objects` but not `CREATE` on the `storage` schema. Client-side, [src/lib/uploadErrors.ts](src/lib/uploadErrors.ts) maps the 413 / 415 / rate-limit rejections to actionable text. **The rate-limit case needs a round trip** (2026-08-08): storage-api answers the trigger's raise with 500 and a body of `{}`, so the message never reaches the browser — `uploadErrorMessage()` calls `upload_rate_limited()` (§7) after an upload fails with an unrecognised error rather than parsing a reason the response will never carry.

---

## 10. Edge Functions (deployed)

| Slug | verify_jwt | Invoked by |
|---|---|---|
| `send-trek-notification` | **false** | `trek-join-notification` trigger (on join) |
| `send-trek-leave-notification` | **false** | `trek-leave-notification` trigger (on leave) |

**`verify_jwt` is `false` on both** — read back over the MCP `list_edge_functions` (2026-08-26); this table said `true` until then. That is deliberate, not a gap: the caller is a Postgres trigger, which has no user JWT to send. Authorization is the shared secret in Vault (`edge_function_token`), sent on `x-trek-webhook-secret` and compared in constant time inside each function. It also means the gateway routes these two **without any `apikey` header**, which is why `0008` could delete the embedded publishable key from `notify_trek_participation()` rather than move it to Vault. A *wrong* `apikey` is worse than none — the gateway answers `401 {"message":"Invalid API key"}` before the function runs, and the trigger swallows it.

**Both are rate-limited to 10 notification emails/hour per recipient** (EDGE-003), sharing one `'trek_email'` counter so alternating the two endpoints cannot double the rate. Since `0012` the cap is the `rate_events` trigger in §7, not the functions' own count — they log the attempt first and turn the trigger's `P0001` into a 429, so a leaked secret meets the limit in Postgres rather than in code it is already past.

Source for both lives in [supabase/functions/](supabase/functions/). These two are the **only** functions on the project — confirmed via `list_edge_functions` over the read-only MCP (2026-08-25, EDGE-001). `trek-email-notification` was never deployed; the `notify_trek_*` triggers that referenced it were dropped in `0007`.

---

## 11. Known issues / advisors

Security advisor (live, re-checked **2026-07-02** after the multi-tenant migration):

- **ERROR** `security_definer_view` — `public_profiles`. Intentional (documented above). [ref](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)
- **INFO** `rls_enabled_no_policy` — `platform_admins`. **Intentional**: zero policies = default-deny; the only write path is the SQL Editor. [ref](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- ~~**WARN** `public_bucket_allows_listing` — `company-logos`, `trek-images` (and historically `avatars`, `trek-reviews`). Deliberate pattern: authenticated-only SELECT blocks anon listing; CDN URLs still work.~~ **Fixed 2026-08-25 in `0006`.** The "deliberate pattern" only ever addressed *anon* listing; any signed-in account could still enumerate every other account's UID/filenames. SELECT is now scoped to the caller's own prefix in all four; `trek-profile` (no SELECT policy at all) is the only bucket the lint can still name. See §9. [ref](https://supabase.com/docs/guides/database/database-linter?lint=0025_public_bucket_allows_listing)
- **WARN** `anon/authenticated_security_definer_function_executable` — the multi-tenant RPCs (`apply_for_company`, `approve/reject/suspend_company`, `get_company_batch_participants`, `get_company_members`, `invite_company_member`, the `is_*` helpers) plus pre-existing `join_trek_and_chat`, `is_chat_participant`, `get_unread_counts`, `mark_conversation_read` are callable via `/rest/v1/rpc`, including by `anon` (default PUBLIC grant). **All fail safely** — each checks `auth.uid()` / `is_company_member()` / `is_company_admin()` / `is_platform_admin()` internally (`get_company_members` returns an empty set for anon, `invite_company_member` raises — both verified live 2026-07-02) — **and the anon EXECUTE grant was revoked 2026-08-08** (`supabase/phases/fix-anon-execute-definer-rpcs.sql`): 18 of the 21 flagged functions now carry `revoke … from public, anon` paired with `grant execute … to authenticated`, taking the `anon_…` lint 21 → 3. ⚠️ The surviving 3 — `is_trek_visible`, `is_company_member`, `is_platform_admin` — **must keep the anon grant**: they are called from PUBLIC-role SELECT policies on `treks`/`trek_batches`/`companies`, so every anonymous page view executes them. They are load-bearing, not inert; see `FEATURES.md` Known Gotchas. The rest of this entry is the pre-fix history, kept for the reasoning. **The four invite RPCs added 2026-08-06** (`get_my_invites`, `accept_company_invite`, `decline_company_invite`, `revoke_company_invite`) already carried an explicit `revoke … from public, anon`, so they were `authenticated`-only and appeared under the `authenticated_…` lint only — that is the shape the 18 revoked functions now take. `invite_company_member` used to show under the `anon_…` lint (`create or replace` preserves the original ACL, and the original never revoked the default PUBLIC grant); it was inert for `anon` (`auth.uid()` is NULL → `is_company_admin()` false → raises before any read), and the 2026-08-08 pass closed it. [ref](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- **WARN** `auth_leaked_password_protection` — disabled. The built-in toggle is **Pro-only**, so it's handled in app code instead: `isPasswordPwned()` in [src/lib/auth.ts](src/lib/auth.ts) checks signups/password-updates against HaveIBeenPwned's range API (k-anonymity). The advisor will still flag this since it only inspects the Auth toggle. [ref](https://supabase.com/docs/guides/auth/password-security)
- **WARN** `vulnerable_postgres_version` — `supabase-postgres-17.4.1.069` has patches available. Manual upgrade is **Pro-only**; on the free plan this is acknowledged (Supabase patches free-tier infra on their own schedule). [ref](https://supabase.com/docs/guides/platform/upgrading)

Correctness bugs (in DB):

- ~~`create_trek_initial_message()` + `trg_initial_trek_message` insert into non-existent `trek_messages` → creating a trek errors.~~ **FIXED 2026-07-02** — the multi-tenant migration dropped the trigger; the (unused) function remains.
- `treks.participants_joined` is kept in sync by `trek_participants_count_trigger` → `update_participants_count()` on every join/leave (NEW-5); it counts **confirmed only** (follow-up #1), so it now agrees with `get_trek_participant_count()`.
- ~~Duplicate dead notification triggers (`notify_trek_join/remove` → non-existent edge fn).~~ **FIXED 2026-08-26 in `0007`** — both triggers and both functions dropped; `notify_trek_participation()` is now the only notification path on `trek_participants`.
- ~~Publishable key embedded as a literal in `notify_trek_participation()`, kept in sync only by an inline comment.~~ **FIXED 2026-08-26 in `0008`** — not a disclosure (the key is public by design) but a rotation trap: a stale key 401s at the gateway and the trigger swallows it, so trek emails stop silently. The header was never needed (`verify_jwt=false`; the gateway rejects an *invalid* `apikey`, not an *absent* one), so it was deleted rather than moved to Vault. Enforced by `tests/db/no-embedded-credentials.test.ts`, and 0 functions in `public` hold a key or JWT literal live.
- ~~App-side dead code: `src/lib/database.ts` targets a non-existent `reviews` table and `trek_participants.trek_id` column and the non-existent `increment_participants` RPC.~~ **FIXED 2026-08-12** — the file was deleted (199 lines, zero importers). The live join path is and was [src/lib/joinTrek.ts](src/lib/joinTrek.ts).

See [SECURITY_AUDIT_ISSUE.md](SECURITY_AUDIT_ISSUE.md) for the full hardening backlog and history, and [supabase/security-fixes.sql](supabase/security-fixes.sql) for the rationale behind each applied fix. Both are dated records, not current state — `SECURITY_AUDIT_ISSUE.md` still describes findings since fixed (e.g. `src/lib/database.ts`, deleted 2026-08-12). New hardening SQL goes in a [migration](supabase/migrations/README.md).

---

## 12. How to apply

Every change is a numbered, append-only file in [supabase/migrations/](supabase/migrations/README.md) — that README is the full workflow. Write the next `NNNN_*.sql`, prove it with `npx vitest run --project db`, paste it into the SQL editor, then `npm run db:schema`. After DDL changes, re-run the security advisor (`get_advisors`) to catch missing RLS.

`supabase/schema.sql` is **generated** from those migrations — do not hand-edit it. On a fresh project, run it top-to-bottom (SQL editor or `psql`); it is every migration concatenated in order.

### `supabase_migrations.schema_migrations` — what is actually deployed

| Column | Type | Notes |
|---|---|---|
| `version` | `text` PK | Zero-padded migration number, e.g. `0001` |
| `name` | `text` | Description from the filename |
| `statements` | `text[]` | Unused here; present so the Supabase CLI recognises the table |
| `applied_at` | `timestamptz` | Defaults to `now()` |

Each migration inserts its own row as its last statement. This table — not a comment in a SQL file — is the answer to "is it applied?"; trusting a comment produced a false 🔴 critical in `CODE_REVIEW.md` §1.3. Three locks, in order of what actually stops a client: it sits outside `public` on purpose (PostgREST exposes `public`, so a ledger there would be anon-readable); `anon` and `authenticated` hold no privileges on it; and RLS is on with no policies, which is a no-op today but holds if the schema is ever exposed. Deny-all is safe because every role that must read it bypasses RLS — `postgres` and `supabase_read_only_user` (the MCP reader) both have `rolbypassrls`, and the owner is exempt absent `FORCE ROW LEVEL SECURITY`.

```sql
select version, name, applied_at from supabase_migrations.schema_migrations order by version;
```
