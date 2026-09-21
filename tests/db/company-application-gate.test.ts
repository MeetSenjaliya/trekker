import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, getDb, ids } from './harness'
import type { Actor } from './harness'

/**
 * apply_for_company() only serves company accounts.
 *
 * The RPC is SECURITY DEFINER and the only way a companies row is created, so
 * the account-type check at the top of its body is the whole rule. Production
 * has had it since phase F; the migrations lost it when phase F was folded
 * into 0001 (0029 restores it). This is what keeps the two from drifting
 * apart again.
 */
describe('apply_for_company account gate', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const apply = (tx: Actor, slug: string) =>
    tx.query<{ apply_for_company: { company_id: string; status: string } }>(
      `select public.apply_for_company('New Co', $1)`,
      [slug],
    )

  it('refuses a trekker account', async () => {
    await expect(
      asUser(db, ids.user.trekkerA, (tx) => apply(tx, 'new-co-trekker')),
    ).rejects.toThrow(/Only company accounts can apply/)
  })

  it('lets a company account apply', async () => {
    // outsiderCompany's only company is rejected, so the one-pending-per-creator
    // index does not get in the way.
    const { rows } = await asUser(db, ids.user.outsiderCompany, (tx) => apply(tx, 'new-co-company'))
    expect(rows[0]!.apply_for_company.status).toBe('pending')
  })
})
