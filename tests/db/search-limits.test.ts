import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, asSuperuser, getDb, ids } from './harness'
import type { Actor } from './harness'

/**
 * search_treks() does a bounded amount of work per call, whatever the caller
 * asks for.
 *
 * It is the one RPC anon may call, and before 0023 it honoured any p_limit —
 * `limit greatest(p_limit, 0)` only stopped negatives — so a single request
 * could ask for the whole catalogue. The seed has one visible trek, which would
 * let the cap be deleted with every assertion still green; each case below
 * first grows the approved company's catalogue past the cap inside the same
 * rolled-back transaction, then drops to `anon` for the call — the role the
 * scraper actually has.
 */
describe('search_treks bounds its own work', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const CATALOGUE = 130
  const CAP = 100

  type Row = { title: string; total_count: string }

  const asAnonOnABigCatalogue = <T>(fn: (tx: Actor) => Promise<T>): Promise<T> =>
    asSuperuser(db, async (tx) => {
      await tx.exec(`
        insert into public.treks (title, description, location, difficulty, distance_km,
                                  estimated_cost, max_participants, company_id, is_active)
        select 'Bulk ' || lpad(n::text, 3, '0'), 'seeded for the cap test', 'Manali', 'Easy',
               n, n * 10, 10, '${ids.company.approved}', true
          from generate_series(1, ${CATALOGUE}) as n;
      `)
      await tx.exec(`set local role anon`)
      return fn(tx)
    })

  const search = (tx: Actor, args: string) =>
    tx.query<Row>(`select title, total_count from public.search_treks(${args})`)

  it('the seed really is bigger than the cap, so the cap is what the assertions below read', async () => {
    const rows = await asAnonOnABigCatalogue(
      async (tx) => (await search(tx, `p_limit => ${CAP}`)).rows,
    )
    expect(rows).toHaveLength(CAP)
    expect(Number(rows[0].total_count)).toBe(CATALOGUE + 1)
  })

  it('returns at most 100 rows however large p_limit is', async () => {
    const rows = await asAnonOnABigCatalogue(
      async (tx) => (await search(tx, `p_limit => 2147483647`)).rows,
    )
    expect(rows).toHaveLength(CAP)
  })

  it('still reports the true total on a capped page, so pagination stays honest', async () => {
    // A cap that also truncated total_count would make the Explore page think
    // the catalogue ends at 100.
    const rows = await asAnonOnABigCatalogue(
      async (tx) => (await search(tx, `p_limit => 2147483647`)).rows,
    )
    expect(Number(rows[0].total_count)).toBe(CATALOGUE + 1)
  })

  it('returns nothing for a negative p_limit', async () => {
    const rows = await asAnon(db, async (tx) => (await search(tx, `p_limit => -1`)).rows)
    expect(rows).toEqual([])
  })

  it('answers a huge p_offset with an empty page', async () => {
    // The offset clamp changes the work, not the answer: past the catalogue the
    // page is empty with or without it, so this pins the behaviour rather than
    // detecting the clamp's removal. Only the p_limit case above does that.
    const rows = await asAnonOnABigCatalogue(
      async (tx) => (await search(tx, `p_limit => 6, p_offset => 2147483647`)).rows,
    )
    expect(rows).toEqual([])
  })

  it('treats a negative p_offset as page one', async () => {
    const rows = await asAnonOnABigCatalogue(
      async (tx) => (await search(tx, `p_limit => 6, p_offset => -50, p_sort => 'price_asc'`)).rows,
    )
    expect(rows).toHaveLength(6)
    expect(rows[0].title).toBe('Bulk 001')
  })

  it('still pages the way the Explore page expects inside the bound', async () => {
    // The positive case: 6 per page, page 2, price ascending — the seeded
    // 'Ridge Walk' costs 2000, so it sorts after the 130 bulk treks (10..1300)
    // and page 2 is Bulk 007..012.
    const rows = await asAnonOnABigCatalogue(
      async (tx) => (await search(tx, `p_limit => 6, p_offset => 6, p_sort => 'price_asc'`)).rows,
    )
    expect(rows.map((r) => r.title)).toEqual([
      'Bulk 007', 'Bulk 008', 'Bulk 009', 'Bulk 010', 'Bulk 011', 'Bulk 012',
    ])
  })
})
