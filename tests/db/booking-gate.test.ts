import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, getDb, ids } from './harness'
import type { Actor } from './harness'

/**
 * Whose treks can still be sold.
 *
 * Threat: suspending a company took its treks out of the catalogue and nothing
 * else. join_trek_and_chat() was handed a trek id and re-derived neither the
 * company's status nor is_active, and the "Users can join treks" policy asked
 * only `auth.uid() = user_id and is_trekker()` — so anyone still holding a
 * /trek/[id] link could book a frozen tenant's departure through either path.
 * 0021 gives both the same predicate the public catalogue already uses.
 *
 * The fixture carries the three interesting treks: Ridge Walk (approved,
 * active), Old Pass (approved, archived) and Taken Down (suspended company).
 * trekkerB is the outsider — signed in, booked nothing.
 */
describe('booking gate', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const join = (tx: Actor, userId: string, trekId: string) =>
    tx.query(`select public.join_trek_and_chat($1, $2, current_date + 30)`, [userId, trekId])

  const insertBooking = (tx: Actor, userId: string, batchId: string) =>
    tx.query(`insert into public.trek_participants (user_id, batch_id) values ($1, $2)`, [
      userId,
      batchId,
    ])

  const closed = /not open for booking/
  const denied = /row-level security/i

  // ---- 1 ---------------------------------------------------------------------
  // The headline bug, run exactly as reported: the link still works.
  describe('a suspended company cannot take a booking', () => {
    it('refuses the RPC for a frozen tenant trek', async () => {
      await expect(
        asUser(db, ids.user.trekkerB, (tx) =>
          join(tx, ids.user.trekkerB, ids.trek.suspendedActive),
        ),
      ).rejects.toThrow(closed)
    })

    it('refuses the direct insert that skips the RPC', async () => {
      // The publishable key ships in the client bundle, so the policy — not the
      // RPC — is what actually stands between a POST and a confirmed seat.
      await expect(
        asUser(db, ids.user.trekkerB, (tx) =>
          insertBooking(tx, ids.user.trekkerB, ids.batch.suspendedActive),
        ),
      ).rejects.toThrow(denied)
    })

    it('refuses an existing participant a second departure on the same trek', async () => {
      // trekkerA booked Taken Down while Summit's rival was still approved, so
      // is_trek_visible still shows them the trek. Reading it is not buying it.
      await expect(
        asUser(db, ids.user.trekkerA, (tx) =>
          join(tx, ids.user.trekkerA, ids.trek.suspendedActive),
        ),
      ).rejects.toThrow(closed)
    })

  })

  // ---- 2 ---------------------------------------------------------------------
  // Same door, other latch: is_active is the schema's only delete path for a
  // trek, so a soft-deleted trek that still sells is the identical bug.
  describe('an archived trek cannot be booked', () => {
    it('refuses the RPC for a trek its own company retired', async () => {
      await expect(
        asUser(db, ids.user.trekkerB, (tx) =>
          join(tx, ids.user.trekkerB, ids.trek.approvedArchived),
        ),
      ).rejects.toThrow(closed)
    })

    it('refuses the direct insert on an archived trek batch', async () => {
      await expect(
        asUser(db, ids.user.trekkerB, (tx) =>
          insertBooking(tx, ids.user.trekkerB, ids.batch.approvedArchived),
        ),
      ).rejects.toThrow(denied)
    })
  })

  // ---- 3 ---------------------------------------------------------------------
  // A company that has never been approved has no storefront to link to, but it
  // does have trek rows, and the RPC will build the batch on demand.
  it('refuses a booking for a pending company that never launched', async () => {
    await expect(
      asUser(db, ids.user.trekkerB, (tx) => join(tx, ids.user.trekkerB, ids.trek.pendingActive)),
    ).rejects.toThrow(closed)
  })

  // ---- 4 ---------------------------------------------------------------------
  // The control. A gate that refuses everything proves nothing, and both of
  // these were working paths before 0021.
  describe('an approved company still sells', () => {
    it('confirms a fresh booking through the RPC', async () => {
      const status = await asUser(db, ids.user.trekkerB, async (tx) => {
        const { rows } = await join(tx, ids.user.trekkerB, ids.trek.approvedActive)
        return (rows[0] as { join_trek_and_chat: { status: string } }).join_trek_and_chat.status
      })
      expect(status).toBe('confirmed')
    })

    it('accepts the direct insert on a live departure', async () => {
      const inserted = await asUser(db, ids.user.trekkerB, async (tx) => {
        await insertBooking(tx, ids.user.trekkerB, ids.batch.approvedActive)
        return (
          await tx.query(`select id from public.trek_participants where user_id = $1`, [
            ids.user.trekkerB,
          ])
        ).rows.length
      })
      expect(inserted).toBe(1)
    })
  })

  // ---- 5 ---------------------------------------------------------------------
  // 0001 recorded phase F's guard at §14.5 as a comment describing an in-place
  // edit, so a database rebuilt from the migrations alone had a join RPC that
  // accepted company accounts. 0021 re-states the function in full, gate
  // included; this is what stops that drift reopening.
  it('still refuses a company account at the RPC, not just at the policy', async () => {
    await expect(
      asUser(db, ids.user.ownerApproved, (tx) =>
        join(tx, ids.user.ownerApproved, ids.trek.approvedActive),
      ),
    ).rejects.toThrow(/Company accounts cannot join treks/)
  })
})
