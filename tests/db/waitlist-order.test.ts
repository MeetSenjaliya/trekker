import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asSuperuser, getDb, ids } from './harness'
import type { Actor } from './harness'

/**
 * The waitlist is promoted in the order the waitlist was numbered.
 *
 * join_trek_and_chat() numbers the queue with a row comparison,
 * `(joined_at, id) <= (…)` — follow-up #5 added the id because joined_at is
 * not unique. promote_waitlist_on_leave() ordered by joined_at alone, so among
 * rows sharing a timestamp it promoted whatever the plan returned first, which
 * is insertion order in practice and nothing in principle. 0022 gives the
 * trigger the same tie-break.
 *
 * Ties are the normal case here rather than a contrivance: 0020 pins joined_at
 * to now(), the transaction timestamp, so both waitlisted rows below carry
 * exactly the same one — what two joins in the same instant produce live.
 *
 * The tie-break is on trek_participants.id, which is a random uuid, so the
 * incumbent row is inserted with a chosen id: `ff…` to sort behind the joiner,
 * `00…` to sort ahead of them. Insertion order is the same in both scenarios —
 * only the id differs, so the id is the only thing either assertion can be
 * reading.
 */
describe('waitlist promotion follows the position shown', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const { trekkerA, trekkerB, platformAdmin } = ids.user
  const sortsLast = 'ffffffff-ffff-4fff-bfff-ffffffffffff'
  const sortsFirst = '00000000-0000-4000-8000-000000000001'

  /**
   * Seed and act in ONE transaction — both waitlisted rows have to share a
   * joined_at, which is only true within a transaction, and each asSuperuser
   * call rolls back independently.
   *
   * The departure is trekkerA's, shrunk to the one seat they already hold, so
   * the next joiner is waitlisted and deleting trekkerA frees exactly one seat.
   */
  const onAFullDeparture = <T>(incumbentId: string, fn: (tx: Actor) => Promise<T>): Promise<T> =>
    asSuperuser(db, async (tx) => {
      await tx.exec(`
        update public.trek_batches set max_participants = 1
         where id = '${ids.batch.approvedActive}';
        insert into public.trek_participants (id, user_id, batch_id, status)
        values ('${incumbentId}', '${platformAdmin}', '${ids.batch.approvedActive}', 'waitlisted');
      `)
      return fn(tx)
    })

  /** Joins as the client does, and returns the position the client is shown. */
  const joinAndReadPosition = async (tx: Actor, userId: string): Promise<number> => {
    await tx.exec(`set local role authenticated`)
    await tx.exec(
      `set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`,
    )
    const { rows } = await tx.query<{
      join_trek_and_chat: { status: string; waitlist_position: number }
    }>(`select public.join_trek_and_chat($1, $2, current_date + 30)`, [
      userId,
      ids.trek.approvedActive,
    ])
    await tx.exec(`set local role postgres`)
    const result = rows[0]!.join_trek_and_chat
    expect(result.status).toBe('waitlisted')
    return result.waitlist_position
  }

  /** Frees the one seat, which is what fires the promotion trigger. */
  const promotedAfterTrekkerALeaves = async (tx: Actor): Promise<string[]> => {
    await tx.query(`delete from public.trek_participants where user_id = $1 and batch_id = $2`, [
      trekkerA,
      ids.batch.approvedActive,
    ])
    const { rows } = await tx.query<{ user_id: string }>(
      `select user_id from public.trek_participants
        where batch_id = $1 and status = 'confirmed'`,
      [ids.batch.approvedActive],
    )
    return rows.map((r) => r.user_id)
  }

  // ---- 1 -----------------------------------------------------------------------
  // The reported bug: the joiner is told #1 and the row that was already there
  // is promoted instead, because it was inserted first and the timestamps tie.
  it('promotes the joiner who was numbered ahead of an equally-timed incumbent', async () => {
    const { position, promoted } = await onAFullDeparture(sortsLast, async (tx) => ({
      position: await joinAndReadPosition(tx, trekkerB),
      promoted: await promotedAfterTrekkerALeaves(tx),
    }))

    expect(position).toBe(1)
    expect(promoted).toEqual([trekkerB])
  })

  // ---- 2 -----------------------------------------------------------------------
  // Same tie, opposite id: the incumbent is genuinely first now, and the joiner
  // is told so. Without this, test 1 would still pass against a trigger that
  // simply always promoted the newest row.
  it('promotes the incumbent when the joiner is numbered behind them', async () => {
    const { position, promoted } = await onAFullDeparture(sortsFirst, async (tx) => ({
      position: await joinAndReadPosition(tx, trekkerB),
      promoted: await promotedAfterTrekkerALeaves(tx),
    }))

    expect(position).toBe(2)
    expect(promoted).toEqual([platformAdmin])
  })
})
