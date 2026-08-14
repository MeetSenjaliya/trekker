import { describe, expect, it } from 'vitest'
import { createTestDb } from './harness/load'

/**
 * The suite's foundation: every other db test is worthless if the schema does
 * not load. Kept as its own file so a migration syntax error reports as one
 * clear failure here rather than as an identical beforeAll crash in every file.
 */
describe('the migrations replay into an empty PGlite', () => {
  it('applies cleanly and creates the expected objects', async () => {
    const db = await createTestDb()

    const tables = await db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    )
    const names = tables.rows.map((r) => r.tablename)
    expect(names).toContain('treks')
    expect(names).toContain('trek_participants')
    expect(names).toContain('companies')
    expect(names).toContain('company_members')

    // Every public table must have RLS on. This one assertion is the cheapest
    // guard in the suite against the classic mistake: adding a table and
    // forgetting `enable row level security`, which leaves it world-readable.
    const rlsOff = await db.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
        order by c.relname`,
    )
    expect(rlsOff.rows.map((r) => r.relname)).toEqual([])

    await db.close()
  })
})
