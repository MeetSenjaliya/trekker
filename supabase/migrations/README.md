# Migrations

Every database change is a new numbered file here. The files are **append-only**:
once a migration has been applied to production, it is history — fix it with the
next migration, never by editing it.

`supabase/schema.sql` is **generated** from this folder (`npm run db:schema`).
Do not hand-edit it.

## Naming

```
NNNN_kebab-case-description.sql
0001_baseline.sql
0002_add-cancellation-window.sql
```

Four digits, zero-padded, no gaps. `scripts/build-schema.mjs` enforces the shape
and rejects duplicate numbers; `tests/db/schema-is-generated.test.ts` rejects
gaps.

## Adding one

1. **Write it.** Create the next `NNNN_*.sql`. It must be safe to run
   top-to-bottom on an empty database (`if not exists` / `or replace` /
   `drop policy if exists`), because the test suite does exactly that on every
   run. End the file with its ledger row:

   ```sql
   insert into supabase_migrations.schema_migrations (version, name)
   values ('0002', 'add-cancellation-window')
   on conflict (version) do nothing;
   ```

2. **Test it before it touches production.** `npx vitest run --project db`
   replays every migration in order into a real in-process Postgres. A syntax
   error, a wrong dependency order, or a table left without RLS fails here, not
   in the SQL Editor.

3. **Apply it.** Paste the whole file into the Supabase SQL Editor and run it.
   The MCP server is read-only; there is no other path.

4. **Confirm it landed.** Over the read-only MCP server:

   ```sql
   select version, name, applied_at
     from supabase_migrations.schema_migrations
    order by version;
   ```

   This table is the answer to "is it deployed?". A `⚠️ NOT YET APPLIED` comment
   in a SQL file is not — that mistake produced a false critical finding in
   CODE_REVIEW.md §1.3.

5. **Regenerate and commit.** `npm run db:schema`, then commit the migration and
   the regenerated `schema.sql` together. Update `DATABASE.md` and `FEATURES.md`
   in the same change, per CLAUDE.md.

## One-time production bootstrap — done 2026-08-13

`0001_baseline.sql` is the live database as of 2026-08-13 — it is **already
applied**. Do not re-run it. The ledger below was run once on production and
verified live; it is kept here as the record of what `0001` installed, and for
standing up a new project.

```sql
create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  name       text,
  statements text[],
  applied_at timestamptz not null default now()
);

revoke all on schema supabase_migrations from public, anon, authenticated;
revoke all on all tables in schema supabase_migrations from public, anon, authenticated;

alter table supabase_migrations.schema_migrations enable row level security;

insert into supabase_migrations.schema_migrations (version, name)
values ('0001', 'baseline')
on conflict (version) do nothing;
```

## `0002` — applied before it was a migration

`0002_trek-returning-and-chat-policy-roles.sql` was applied to production on
2026-08-13 as `phases/fix-trek-returning-and-chat-policy-roles.sql`, hours after
`0001` was recorded. It was first folded back into `0001_baseline.sql` by editing
it — which is exactly what append-only forbids, and it left the ledger unable to
distinguish a database built from the edited `0001` from one built by the `0001`
that actually ran. Split back out on 2026-08-14, so `0001` is again the file that
ran and `0002` is the fix that followed.

**Recorded on production 2026-08-14 09:36:11+00**, read back over the read-only MCP
server: the ledger now returns both rows, all five re-scoped policies are
`{authenticated}` with quals intact (`is_announcement = false` still pinned on
"Send messages"), and the four chat policies that must stay `{public}` are
unchanged. Note `0002`'s `applied_at` is the day it was *recorded*, not the day it
took effect — the SQL went live 2026-08-13 as the `phases/` file.

## Exception: `realtime.*` cannot go through the SQL Editor

Every other Supabase-provisioned schema this repo touches (`auth`, `storage`)
grants `postgres` enough rights that its objects can be altered from the SQL
Editor like anything else. `realtime.messages` — what Realtime's `private:
true` channels check RLS against — does not: it's owned by
`supabase_realtime_admin`, and `postgres` holds no membership in that role
(confirmed via `pg_auth_members` over the read-only MCP, 2026-08-25). Any
`ALTER TABLE realtime.messages ...` or `CREATE POLICY ... ON realtime.messages`
pasted into the SQL Editor fails with `must be owner of table messages`,
regardless of project. The only supported path is the Dashboard: **Database →
Realtime → Policies**.

That means a `realtime.*` migration file is documentation, not something to
run step 3 (above) against — see `0004_realtime-private-channel-authorization.sql`
for the pattern: write what's live, verify it against `pg_class`/`pg_policy`
over MCP rather than trusting the file, and only its ledger `INSERT` (which
targets `supabase_migrations.schema_migrations`, a table this repo does own)
is actually meant to run in the SQL Editor.

⚠️ **Run that ledger `INSERT` anyway — it is easy to skip the whole file.**
`0004` was written, its policies confirmed live, and the file set aside as
"nothing to run" — which skipped the one statement in it that *was* meant to
run. The ledger sat at `0001, 0002, 0003, 0005` until 2026-08-25, and a gap
there is exactly the ambiguity step 4 exists to prevent: nothing distinguishes
"record-only, already true via the Dashboard" from "never applied". A
record-only migration is still a migration; only its DDL is inert.

**Order the ledger by `version`, never `applied_at`.** Two rows already break
the correlation: `0002` (recorded a day after its SQL went live as a `phases/`
file) and `0004` (recorded 11:26:56+00, eight minutes *after* `0005`'s
11:18:08+00, while its policies predate both). `applied_at` records when the row
was written, not when the change took effect.

## Rebuilding a dev database from scratch

Run the generated `supabase/schema.sql` top-to-bottom on a fresh project — it is
every migration concatenated in order. One exception per the note above: the
`realtime.messages` policies in `0004` will fail with `must be owner of table
messages` on a fresh project too — recreate those two policies via Dashboard →
Database → Realtime → Policies afterward (current definitions are in `0004`'s
comments).

## What about `phases/` and `security-fixes.sql`?

Historical record, kept for the rationale they carry. Everything in them is
folded into `0001_baseline.sql`. **Nothing new goes in them** — new work is a
migration. `security-fixes.sql` stays the place to write down *why* a hardening
step was needed; the SQL that implements it lives in a migration.
