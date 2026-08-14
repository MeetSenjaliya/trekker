# Database security tests

These test the part of the app that has no code: RLS policies, SECURITY DEFINER
RPCs, and EXECUTE grants. A regression here is silent and catastrophic — no
exception, no 500, just a row someone should not have been able to read.

```bash
npm test                      # everything
npx vitest run --project db   # just these (~9s, boots Postgres 4×)
```

## How it works

[PGlite](https://github.com/electric-sql/pglite) is real Postgres 18 compiled to
WebAssembly, running in-process. No Docker, no Supabase CLI, no network.

1. `harness/shim.sql` creates what the Supabase platform normally provides:
   `auth.users`, `auth.uid()`, the `anon` / `authenticated` roles, `storage.*`,
   and stubs for `net.http_post` / `cron.schedule`.
2. `harness/load.ts` replays `supabase/migrations/*.sql` in version order,
   **verbatim**, statement by statement so a failure names the file and the
   statement. Building from the migrations rather than the generated
   `schema.sql` means every run also proves they rebuild a database from
   nothing.
3. `harness/fixtures.ts` seeds two companies-worth of world (see the comment on
   `seed()` for the map).
4. `harness/actor.ts` gives you `asUser()` / `asAnon()`.

## Writing a test

```ts
const rows = await asUser(db, ids.user.trekkerB, async (tx) =>
  (await tx.query(`select id from public.trek_participants`)).rows,
)
expect(rows).toEqual([])
```

Three things to know:

- **Everything rolls back.** A write in one `asUser()` call is invisible to the
  next. If you need write-then-read, do both inside one callback.
- **Denied SELECT returns `[]`; denied INSERT/UPDATE throws.** RLS filters reads
  rather than refusing them. Assert reads with `toEqual([])` and writes with
  `await expect(...).rejects.toThrow(/row-level security/i)`.
- **Some guards rewrite instead of rejecting.** `companies.slug`,
  `companies.status` and `profiles.account_type` are pinned by BEFORE UPDATE
  triggers that set `new.x := old.x`. The UPDATE *succeeds* and reports a row.
  Asserting "the write failed" would pass against a completely removed trigger.
  **Re-read the column.**

Always write the positive case next to the negative one. A policy tightened into
uselessness makes every negative test pass.

## ⚠️ These tests are only as true as `supabase/migrations/`

The Supabase MCP server is read-only and all DB changes are applied by hand in
the SQL Editor, so the migrations are what we *intend* production to be — the
live database is still the source of truth. A green run proves the policies **as
committed** are sound. It does not prove production matches them.

So: write the migration, run these tests, apply it in the SQL Editor, then run
`npm run db:schema` — all in the same change. That was already the rule in
`CLAUDE.md`; these tests are what make breaking it visible. The first run of this
suite found 20 functions whose live EXECUTE grants the file could not reproduce,
one of them guarding participant phone numbers and emergency contacts.

To check what production actually has:

```sql
select version, name, applied_at
  from supabase_migrations.schema_migrations order by version;
```

When a test's expectation and production disagree, check production first
(`has_table_privilege`, `has_function_privilege`, `pg_policies` via the read-only
MCP server) and fix whichever is actually wrong. Do not "fix" the test to match
a stale file.
