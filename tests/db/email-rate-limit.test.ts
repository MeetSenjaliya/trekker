import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asSuperuser, getDb, ids } from './harness'
import type { Actor } from './harness'

/**
 * The 10/hour cap on trek notification emails (EDGE-003), as enforced by the
 * database rather than by the edge functions that send them.
 *
 * Everything here runs as `service_role` on purpose. That is the role the
 * SECRET key gets, it has BYPASSRLS, and it is exactly what a leaked webhook
 * secret would be calling PostgREST with — so a cap that holds under this role
 * is a cap no caller can talk its way out of. The functions' own count is a
 * fast path; the trigger is the control.
 */
describe('trek notification email rate limit', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const asServiceRole = <T>(fn: (tx: Actor) => Promise<T>) =>
    asSuperuser(db, async (tx) => {
      await tx.exec(`set local role service_role`)
      return fn(tx)
    })

  const log = (tx: Actor, actor: string, action = 'trek_email') =>
    tx.query(`insert into public.rate_events (actor, action) values ($1, $2)`, [actor, action])

  it('lets the first ten emails through and refuses the eleventh', async () => {
    await expect(
      asServiceRole(async (tx) => {
        for (let i = 0; i < 10; i++) await log(tx, ids.user.trekkerA)
        await log(tx, ids.user.trekkerA)
      }),
    ).rejects.toThrow(/too many trek notification emails/i)
  })

  it('is per recipient, so one user at the cap does not silence another', async () => {
    await expect(
      asServiceRole(async (tx) => {
        for (let i = 0; i < 10; i++) await log(tx, ids.user.trekkerA)
        return log(tx, ids.user.trekkerB)
      }),
    ).resolves.toBeDefined()
  })

  it('counts only the trailing hour', async () => {
    // Ten sends yesterday must not hold the window shut today; pg_cron prunes
    // rate_events daily, so rows do outlive the window they are counted in.
    await expect(
      asServiceRole(async (tx) => {
        await tx.query(
          `insert into public.rate_events (actor, action, at)
           select $1, 'trek_email', now() - interval '2 hours' from generate_series(1, 10)`,
          [ids.user.trekkerA],
        )
        return log(tx, ids.user.trekkerA)
      }),
    ).resolves.toBeDefined()
  })

  it('leaves the other rate-limit counters alone', async () => {
    // The trigger is scoped WHEN (new.action = 'trek_email'). Their caps live in
    // their own triggers, on the tables being written — a cap here would count
    // them twice.
    await expect(
      asServiceRole(async (tx) => {
        let last
        for (let i = 0; i < 20; i++) last = await log(tx, ids.user.trekkerA, 'join')
        return last
      }),
    ).resolves.toBeDefined()
  })

  it('is a trigger on the log table, not something the writer opts into', async () => {
    const { rows } = await db.query<{ tgenabled: string; tgtype: number }>(`
      select tgenabled, tgtype
        from pg_trigger
       where tgrelid = 'public.rate_events'::regclass
         and tgname = 'rate_events_trek_email_rate_limit'
    `)
    expect(rows).toHaveLength(1)
    // 7 = ROW | BEFORE | INSERT. BEFORE matters: the count must not include the
    // row being inserted, or the cap would be nine.
    expect(rows[0].tgtype).toBe(7)
    expect(rows[0].tgenabled).toBe('O')
  })
})
