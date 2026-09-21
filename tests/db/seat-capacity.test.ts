import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asSuperuser, asUser, getDb, ids } from './harness'
import type { Actor } from './harness'

/**
 * Who decides whether a booking is confirmed or waitlisted.
 *
 * Threat: `POST /rest/v1/trek_participants` with `status = 'confirmed'`. The
 * "Users can join treks" policy pinned user_id, the account kind and (0021)
 * bookability, and left status as the client wrote it — so the capacity check
 * in join_trek_and_chat() bound only the clients that chose to call it. On a
 * full departure a direct insert took a seat the RPC would have waitlisted;
 * so did one with no status at all, since the column defaults to 'confirmed'.
 * 0024 decides status in a BEFORE INSERT trigger, so both paths land the row
 * with the status the seat count allows, and the RPC reads that back instead
 * of computing its own.
 *
 * The guard rewrites rather than refuses, so per the README every case here
 * re-reads the column: an assertion that "the insert failed" would pass
 * against a removed trigger. `returning status` is the row as written, after
 * the trigger — badge-farming reads joined_at back the same way.
 *
 * Ridge Walk's batch (approvedActive) seats 10 and trekkerA holds one. "Full"
 * below means shrunk to that one seat.
 */
describe('a booking takes the status the seat count allows', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const { trekkerA, trekkerB } = ids.user
  const batch = ids.batch.approvedActive

  /**
   * Shrink the departure to the one seat trekkerA already holds, then drop to
   * `userId` in the SAME transaction — separate calls roll back independently.
   */
  const onAFullDeparture = <T>(userId: string, fn: (tx: Actor) => Promise<T>): Promise<T> =>
    asSuperuser(db, async (tx) => {
      await tx.exec(`update public.trek_batches set max_participants = 1 where id = '${batch}'`)
      await tx.exec(`set local role authenticated`)
      await tx.exec(
        `set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`,
      )
      return fn(tx)
    })

  /** The attacker's POST, status chosen by the client. Returns what landed. */
  const postBooking = async (tx: Actor, userId: string, status: string): Promise<string> => {
    const { rows } = await tx.query<{ status: string }>(
      `insert into public.trek_participants (user_id, batch_id, status)
       values ($1, $2, $3) returning status`,
      [userId, batch, status],
    )
    return rows[0]!.status
  }

  const join = async (tx: Actor, userId: string) => {
    const { rows } = await tx.query<{
      join_trek_and_chat: { status: string; waitlist_position: number | null }
    }>(`select public.join_trek_and_chat($1, $2, current_date + 30)`, [
      userId,
      ids.trek.approvedActive,
    ])
    return rows[0]!.join_trek_and_chat
  }

  /** Ground truth, read past RLS: the row's status and whether a chat seat exists. */
  const rowFor = async (tx: Actor, userId: string) => {
    await tx.exec(`set local role postgres`)
    const { rows } = await tx.query<{ status: string; seated: boolean }>(
      `select tp.status,
              exists (select 1 from public.conversation_participants cp
                       where cp.conversation_id = $2 and cp.user_id = tp.user_id) as seated
         from public.trek_participants tp
        where tp.user_id = $1 and tp.batch_id = $3`,
      [userId, ids.conversation.approvedActive, batch],
    )
    return rows[0]!
  }

  // ---- 1 ---------------------------------------------------------------------
  // The headline bug, sent exactly as the attacker would.
  describe('the direct insert', () => {
    it('is waitlisted when it asks for a confirmed seat on a full departure', async () => {
      const landed = await onAFullDeparture(trekkerB, (tx) =>
        postBooking(tx, trekkerB, 'confirmed'),
      )
      expect(landed).toBe('waitlisted')
    })

    it('is waitlisted on a full departure when it sends no status at all', async () => {
      // The column default is 'confirmed', so silence was as good as asking.
      const landed = await onAFullDeparture(trekkerB, async (tx) => {
        const { rows } = await tx.query<{ status: string }>(
          `insert into public.trek_participants (user_id, batch_id)
           values ($1, $2) returning status`,
          [trekkerB, batch],
        )
        return rows[0]!.status
      })
      expect(landed).toBe('waitlisted')
    })

    it('is confirmed on a departure with room, whatever it asked for', async () => {
      // The control, both ways: a trigger that waitlists everything would pass
      // the two above. And the column is derived, not validated — asking to be
      // waitlisted with seats free gets the seat too.
      const [asked, contrary] = await asUser(db, trekkerB, async (tx) => {
        const asked = await postBooking(tx, trekkerB, 'confirmed')
        await tx.query(`delete from public.trek_participants where user_id = $1`, [trekkerB])
        return [asked, await postBooking(tx, trekkerB, 'waitlisted')]
      })
      expect(asked).toBe('confirmed')
      expect(contrary).toBe('confirmed')
    })
  })

  // ---- 2 ---------------------------------------------------------------------
  // The RPC no longer decides; it reports what the trigger decided, and seats
  // the joiner in the chat only when that decision was 'confirmed'.
  describe('the RPC follows the row it wrote', () => {
    it('returns waitlisted, and no chat seat, on a full departure', async () => {
      const { returned, row } = await onAFullDeparture(trekkerB, async (tx) => ({
        returned: await join(tx, trekkerB),
        row: await rowFor(tx, trekkerB),
      }))
      expect(returned.status).toBe('waitlisted')
      expect(returned.waitlist_position).toBe(1)
      expect(row).toEqual({ status: 'waitlisted', seated: false })
    })

    it('returns confirmed, with a chat seat, on a departure with room', async () => {
      const { returned, row } = await asUser(db, trekkerB, async (tx) => ({
        returned: await join(tx, trekkerB),
        row: await rowFor(tx, trekkerB),
      }))
      expect(returned.status).toBe('confirmed')
      expect(returned.waitlist_position).toBeNull()
      expect(row).toEqual({ status: 'confirmed', seated: true })
    })
  })

  // ---- 3 ---------------------------------------------------------------------
  // A write with no session keeps the status it wrote. That is the SQL Editor's
  // branch, and it is what lets the other files in this folder seed a
  // 'waitlisted' row on a departure with room and mean it. A client cannot get
  // here: the INSERT policy requires auth.uid() = user_id.
  it('leaves an operator write alone', async () => {
    const landed = await asSuperuser(db, (tx) => postBooking(tx, trekkerB, 'waitlisted'))
    expect(landed).toBe('waitlisted')
  })

  // ---- 4 ---------------------------------------------------------------------
  // The seat count the trigger reads is the same one promotion frees. A leave
  // on a full departure still promotes the waitlister the trigger queued.
  it('still promotes the waitlisted joiner when the confirmed seat is freed', async () => {
    const row = await onAFullDeparture(trekkerB, async (tx) => {
      await join(tx, trekkerB)
      await tx.exec(`set local role postgres`)
      await tx.query(`delete from public.trek_participants where user_id = $1 and batch_id = $2`, [
        trekkerA,
        batch,
      ])
      return rowFor(tx, trekkerB)
    })
    expect(row).toEqual({ status: 'confirmed', seated: true })
  })
})
