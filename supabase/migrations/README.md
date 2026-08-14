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

## Rebuilding a dev database from scratch

Run the generated `supabase/schema.sql` top-to-bottom on a fresh project — it is
every migration concatenated in order.

## What about `phases/` and `security-fixes.sql`?

Historical record, kept for the rationale they carry. Everything in them is
folded into `0001_baseline.sql`. **Nothing new goes in them** — new work is a
migration. `security-fixes.sql` stays the place to write down *why* a hardening
step was needed; the SQL that implements it lives in a migration.
