---
name: db-migration
description: Write, test, apply, and sync a Trekker Supabase database migration — the append-only migrations workflow plus the reference files to update after the user applies it. Use for any schema, RLS, policy, function, or storage change.
---

# Trekker DB migration workflow

The Supabase MCP server is connected in read-only mode. **All database changes must be applied manually** by the user through the Supabase SQL Editor (dashboard → SQL Editor → run the SQL).

## Every DB change is a migration

`supabase/migrations/NNNN_description.sql`, append-only. Full workflow in `supabase/migrations/README.md`. The short version:

1. **Write the next migration.** Never edit an applied one — fix it with a new one. It must run top-to-bottom on an empty database, and must end by recording itself in `supabase_migrations.schema_migrations`.
2. **Test it:** `npx vitest run --project db` replays every migration into a real in-process Postgres.
3. **Give the user the file to paste** into the SQL Editor (dashboard → SQL Editor → run).
4. **After they confirm**, run `npm run db:schema` to regenerate `schema.sql`, and update the reference files below.

**Never claim a migration is applied because a file says so.** Comments outlive their truth — that produced a false 🔴 critical in `CODE_REVIEW.md` §1.3. Check the ledger over the read-only MCP server:

```sql
select version, name, applied_at from supabase_migrations.schema_migrations order by version;
```

## Reference files (not source of truth)

These document the live database state but **do not reflect changes automatically**. Update them manually after any schema, RLS, or storage policy change is applied on Supabase:

| File | What it tracks |
|------|---------------|
| `supabase/schema.sql` | **Generated — do not hand-edit.** Every migration concatenated in order (`npm run db:schema`); `npm test` fails on drift. Run it whole to build a fresh project. |
| `supabase/security-fixes.sql` | Rationale for each security hardening step. Append new entries; don't rewrite history. The SQL itself now lives in a migration. |
| `CONTEXT.md` | High-level architecture, flows, known issues. Update on significant structural changes. |
| `DATABASE.md` | Human-readable DB reference (tables, columns, RLS summary). Update alongside `schema.sql`. |
| `FEATURES.md` | Feature status (built / partial / pending). Update whenever a feature is added, changed, or completed. |

**When a user applies a change on Supabase, immediately update these files** so the next conversation starts with accurate context.
