import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asSuperuser, getDb, ids } from './harness'
import type { Actor } from './harness'

/**
 * Leaving a trek and leaving its chat are one act.
 *
 * Threat: leaveTrek() used to issue two unrelated deletes from the browser —
 * conversation_participants, then trek_participants — with nothing in the
 * database holding them together. Sending only the second (a plain PostgREST
 * call the "Users can leave treks" policy allows) took the leaver off the
 * roster while leaving them in the group chat, reading a trip they had
 * publicly quit. The same state arrived by accident whenever the chat delete
 * failed, because the client logged it and removed the booking anyway.
 *
 * 0019 moves the guarantee into the schema, both ways: a trigger drops the chat
 * seat with the booking, and the conversation_participants delete policy
 * refuses to drop a seat a confirmed booking is still holding.
 *
 * The fixture already has trekkerA confirmed on Ridge Walk's batch AND seated
 * in Ridge Walk's chat, which is exactly the state under test.
 *
 * Every assertion about who holds a seat reads as `postgres`, not as the actor.
 * That is load-bearing: conversation_participants' SELECT policy is
 * is_chat_participant(), so a leaver reading their own handiwork gets an empty
 * result whether the trigger fired or not — the first draft of this file
 * "passed" on exactly that illusion.
 */
describe('leaving a trek binds to leaving its chat', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  /**
   * Seed as superuser, then drop to `userId` inside the SAME transaction —
   * conversation_participants admits inserts from service_role only, so the
   * setup cannot run as the user, and separate calls roll back independently.
   */
  const actingAs = <T>(
    userId: string,
    setup: string,
    fn: (tx: Actor) => Promise<T>,
  ): Promise<T> =>
    asSuperuser(db, async (tx) => {
      if (setup) await tx.exec(setup)
      await tx.exec(`set local role authenticated`)
      await tx.exec(
        `set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`,
      )
      return fn(tx)
    })

  /** The one call the client now makes to leave. */
  const leaveTrek = (tx: Actor, userId: string) =>
    tx.query(`delete from public.trek_participants where user_id = $1 and batch_id = $2`, [
      userId,
      ids.batch.approvedActive,
    ])

  const dropOwnSeat = (tx: Actor, userId: string) =>
    tx.query(
      `delete from public.conversation_participants
        where conversation_id = $1 and user_id = $2`,
      [ids.conversation.approvedActive, userId],
    )

  /** Who is in Ridge Walk's chat, read past RLS. Ground truth, never access. */
  const seats = async (tx: Actor): Promise<string[]> => {
    await tx.exec(`set local role postgres`)
    const r = await tx.query<{ user_id: string }>(
      `select user_id from public.conversation_participants
        where conversation_id = $1 order by user_id`,
      [ids.conversation.approvedActive],
    )
    return r.rows.map((x) => x.user_id)
  }

  const { trekkerA, trekkerB } = ids.user

  // ---- 1 ---------------------------------------------------------------------
  // The headline bug, written as the attacker would send it.
  it('drops the chat seat when only the booking row is deleted', async () => {
    const [before, after] = await actingAs(trekkerA, '', async (tx) => {
      const before = await seats(tx)
      await tx.exec(`set local role authenticated`)
      await leaveTrek(tx, trekkerA)
      return [before, await seats(tx)]
    })

    expect(before).toEqual([trekkerA])
    expect(after).toEqual([])
  })

  it('leaves the ex-participant unable to read the group afterwards', async () => {
    const readable = (tx: Actor) =>
      tx
        .query(`select id from public.conversation_messages where conversation_id = $1`, [
          ids.conversation.approvedActive,
        ])
        .then((r) => r.rows.length)

    const [before, after] = await actingAs(trekkerA, '', async (tx) => {
      const before = await readable(tx)
      await leaveTrek(tx, trekkerA)
      return [before, await readable(tx)]
    })

    expect(before).toBeGreaterThan(0)
    expect(after).toBe(0)
  })

  // ---- 2 ---------------------------------------------------------------------
  // The trigger is scoped to the leaver, and to the batch they left.
  it('does not disturb the seats of everyone still on the trek', async () => {
    const after = await actingAs(
      trekkerA,
      `insert into public.trek_participants (user_id, batch_id, status)
         values ('${trekkerB}', '${ids.batch.approvedActive}', 'confirmed');
       insert into public.conversation_participants (conversation_id, user_id)
         values ('${ids.conversation.approvedActive}', '${trekkerB}');`,
      async (tx) => {
        await leaveTrek(tx, trekkerA)
        return seats(tx)
      },
    )

    expect(after).toEqual([trekkerB])
  })

  it('is a harmless no-op for a waitlisted leaver, who never held a seat', async () => {
    const after = await actingAs(
      trekkerB,
      `insert into public.trek_participants (user_id, batch_id, status)
         values ('${trekkerB}', '${ids.batch.approvedActive}', 'waitlisted');`,
      async (tx) => {
        await leaveTrek(tx, trekkerB)
        return seats(tx)
      },
    )

    expect(after).toEqual([trekkerA])
  })

  // ---- 3 ---------------------------------------------------------------------
  // The mirror. Dropping the seat on its own stranded a paying participant:
  // join_trek_and_chat() returns the existing membership without re-inserting
  // the seat, so nothing in the UI could put them back in the chat.
  //
  // A DELETE blocked by a USING clause filters the row rather than raising, so
  // these assert on the row count and on the seat still being there — the
  // rejects.toThrow() that fits a denied INSERT would never fire here.
  it('refuses to drop a seat that a confirmed booking is holding', async () => {
    const { deleted, after } = await actingAs(trekkerA, '', async (tx) => {
      const r = await dropOwnSeat(tx, trekkerA)
      return { deleted: r.affectedRows, after: await seats(tx) }
    })

    expect(deleted).toBe(0)
    expect(after).toEqual([trekkerA])
  })

  it('still admits a seat with no confirmed booking behind it', async () => {
    const after = await actingAs(
      trekkerA,
      `update public.trek_participants set status = 'waitlisted'
         where user_id = '${trekkerA}' and batch_id = '${ids.batch.approvedActive}';`,
      async (tx) => {
        await dropOwnSeat(tx, trekkerA)
        return seats(tx)
      },
    )

    expect(after).toEqual([])
  })

  it("never lets one user delete another's seat", async () => {
    const after = await actingAs(
      trekkerB,
      `insert into public.conversation_participants (conversation_id, user_id)
         values ('${ids.conversation.approvedActive}', '${trekkerB}');`,
      async (tx) => {
        await dropOwnSeat(tx, trekkerA)
        return seats(tx)
      },
    )

    expect(after).toEqual([trekkerA, trekkerB])
  })

  // ---- 4 ---------------------------------------------------------------------
  // Both AFTER DELETE triggers on trek_participants run on the same leave and
  // must not fight: one evicts the leaver, the other seats their replacement.
  it('evicts the leaver and seats the promoted waitlister in one delete', async () => {
    const after = await actingAs(
      trekkerA,
      `update public.trek_batches set max_participants = 1
         where id = '${ids.batch.approvedActive}';
       insert into public.trek_participants (user_id, batch_id, status)
         values ('${trekkerB}', '${ids.batch.approvedActive}', 'waitlisted');`,
      async (tx) => {
        await leaveTrek(tx, trekkerA)
        return seats(tx)
      },
    )

    expect(after).toEqual([trekkerB])
  })
})
