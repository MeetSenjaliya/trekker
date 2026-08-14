import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, asUser, getDb, ids } from './harness'

/**
 * Chat is the highest-consequence read surface in the product: free text
 * written by users who believe the audience is their own departure. Every
 * policy here routes through is_chat_participant(), a SECURITY DEFINER
 * predicate — so if that one function is wrong, all four tables open at once.
 */
describe('chat isolation', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const conv = ids.conversation.approvedActive

  describe('reads', () => {
    it('lets a member read the conversation, its roster and its messages', async () => {
      const seen = await asUser(db, ids.user.trekkerA, async (tx) => ({
        conversations: (await tx.query(`select id from public.conversations`)).rows.length,
        participants: (await tx.query(`select user_id from public.conversation_participants`)).rows
          .length,
        messages: (await tx.query(`select id from public.conversation_messages`)).rows.length,
      }))
      expect(seen).toEqual({ conversations: 1, participants: 1, messages: 2 })
    })

    it('shows a non-member nothing, even scraping every table unfiltered', async () => {
      const seen = await asUser(db, ids.user.trekkerB, async (tx) => ({
        conversations: (await tx.query(`select id from public.conversations`)).rows,
        participants: (await tx.query(`select user_id from public.conversation_participants`)).rows,
        messages: (await tx.query(`select message from public.conversation_messages`)).rows,
      }))
      expect(seen).toEqual({ conversations: [], participants: [], messages: [] })
    })

    it('shows an anonymous visitor nothing, across all three tables', async () => {
      // Until 2026-08-13 these policies were `to public`, which includes anon,
      // while their qual calls is_chat_participant() — a function anon does not
      // hold EXECUTE on. So anon got `permission denied for function`, not an
      // empty set. It failed closed either way; re-scoping the four policies
      // `to authenticated` (FEATURES.md §1.8) makes the denial ordinary.
      //
      // Asserting an empty result rather than a raised error is the point: if
      // someone re-scopes these back to `to public`, this test fails.
      const seen = await asAnon(db, async (tx) => ({
        conversations: (await tx.query(`select id from public.conversations`)).rows,
        participants: (await tx.query(`select user_id from public.conversation_participants`)).rows,
        messages: (await tx.query(`select message from public.conversation_messages`)).rows,
      }))
      expect(seen).toEqual({ conversations: [], participants: [], messages: [] })
    })

    it("hides the chat from the operating company's own staff", async () => {
      // Worth pinning explicitly: owning the trek does not buy a seat in the
      // participants' chat. Only a conversation_participants row does.
      const rows = await asUser(db, ids.user.ownerApproved, async (tx) =>
        (await tx.query(`select message from public.conversation_messages`)).rows,
      )
      expect(rows).toEqual([])
    })

    it('hides the chat from a platform admin', async () => {
      // There is deliberately no admin arm on the chat policies. If someone
      // adds one, that is a product decision that should break this test first.
      const rows = await asUser(db, ids.user.platformAdmin, async (tx) =>
        (await tx.query(`select message from public.conversation_messages`)).rows,
      )
      expect(rows).toEqual([])
    })
  })

  describe('writes', () => {
    it('lets a member post to their own conversation', async () => {
      const rows = await asUser(db, ids.user.trekkerA, async (tx) =>
        (await tx.query(
          `insert into public.conversation_messages (conversation_id, user_id, message)
           values ($1, $2, 'hello') returning id`,
          [conv, ids.user.trekkerA],
        )).rows,
      )
      expect(rows).toHaveLength(1)
    })

    it('refuses a message from a non-member', async () => {
      await expect(
        asUser(db, ids.user.trekkerB, (tx) =>
          tx.query(
            `insert into public.conversation_messages (conversation_id, user_id, message)
             values ($1, $2, 'let me in')`,
            [conv, ids.user.trekkerB],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('refuses a message attributed to another user', async () => {
      // user_id = auth.uid() in the with_check. Without it a member could post
      // as anyone else in their own chat.
      await expect(
        asUser(db, ids.user.trekkerA, (tx) =>
          tx.query(
            `insert into public.conversation_messages (conversation_id, user_id, message)
             values ($1, $2, 'not me')`,
            [conv, ids.user.trekkerB],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('refuses a forged operator announcement', async () => {
      // is_announcement = false is pinned in the with_check. Without it any
      // trekker could post a notice that renders as coming from the operator —
      // "the meeting point has changed to ..." is a real-world attack, not a
      // theoretical one.
      await expect(
        asUser(db, ids.user.trekkerA, (tx) =>
          tx.query(
            `insert into public.conversation_messages (conversation_id, user_id, message, is_announcement)
             values ($1, $2, 'Trip cancelled, do not come', true)`,
            [conv, ids.user.trekkerA],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('refuses to promote an existing own message into an announcement', async () => {
      // The same pin on the UPDATE with_check. Posting normally and editing the
      // flag afterwards is the obvious way around an insert-only guard.
      await expect(
        asUser(db, ids.user.trekkerA, async (tx) => {
          const ins = await tx.query<{ id: string; created_at: string }>(
            `insert into public.conversation_messages (conversation_id, user_id, message)
             values ($1, $2, 'ordinary') returning id, created_at`,
            [conv, ids.user.trekkerA],
          )
          return tx.query(
            `update public.conversation_messages set is_announcement = true
              where id = $1 and created_at = $2`,
            [ins.rows[0].id, ins.rows[0].created_at],
          )
        }),
      ).rejects.toThrow(/row-level security/i)
    })

    it("cannot edit another user's message", async () => {
      const updated = await asUser(db, ids.user.trekkerB, async (tx) =>
        (await tx.query(
          `update public.conversation_messages set message = 'tampered' returning id`,
        )).rows,
      )
      expect(updated).toEqual([])
    })

    it('cannot add itself to a conversation', async () => {
      // Chat membership is granted only by join_trek_and_chat(), which runs as
      // service_role. A direct insert is the shortest path to reading a chat
      // you were never in, so it must fail.
      await expect(
        asUser(db, ids.user.trekkerB, (tx) =>
          tx.query(
            `insert into public.conversation_participants (conversation_id, user_id) values ($1, $2)`,
            [conv, ids.user.trekkerB],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('cannot remove another user from a conversation', async () => {
      const removed = await asUser(db, ids.user.trekkerB, async (tx) =>
        (await tx.query(
          `delete from public.conversation_participants where user_id = $1 returning user_id`,
          [ids.user.trekkerA],
        )).rows,
      )
      expect(removed).toEqual([])
    })

    it('lets a member remove themself', async () => {
      const removed = await asUser(db, ids.user.trekkerA, async (tx) =>
        (await tx.query(
          `delete from public.conversation_participants where user_id = $1 returning user_id`,
          [ids.user.trekkerA],
        )).rows,
      )
      expect(removed).toHaveLength(1)
    })
  })
})
