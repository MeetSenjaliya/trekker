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

    it('refuses a message that arrives already soft-deleted', async () => {
      // is_deleted is pinned on insert the same way is_announcement is (0010).
      // Without it the conversation_messages_message_not_blank CHECK is close to
      // decorative: its only escape hatch is a deleted row, so a blank flood
      // just sets the flag on the way past. Deletion stays an UPDATE.
      await expect(
        asUser(db, ids.user.trekkerA, (tx) =>
          tx.query(
            `insert into public.conversation_messages (conversation_id, user_id, message, is_deleted)
             values ($1, $2, '', true)`,
            [conv, ids.user.trekkerA],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('still lets a member soft-delete their own message', async () => {
      // The other side of the pin: blanking is legal as an UPDATE, which is the
      // only path that could ever have blanked a message. If this breaks, the
      // delete button in /messages is broken.
      const rows = await asUser(db, ids.user.trekkerA, async (tx) => {
        const ins = await tx.query<{ id: string; created_at: string }>(
          `insert into public.conversation_messages (conversation_id, user_id, message)
           values ($1, $2, 'to be deleted') returning id, created_at`,
          [conv, ids.user.trekkerA],
        )
        return (
          await tx.query<{ id: string }>(
            `update public.conversation_messages set is_deleted = true, message = ''
              where id = $1 and created_at = $2 returning id`,
            [ins.rows[0].id, ins.rows[0].created_at],
          )
        ).rows
      })
      expect(rows).toHaveLength(1)
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

  // REALTIME-002/003: private channels (presence + typing broadcast) are
  // gated by RLS on realtime.messages, not by anything else in the public
  // schema. Realtime sets the `realtime.topic` GUC per-message from the
  // connected client's channel name (see messages/page.tsx:289's
  // `conversation:${id}`); these two policies — already live in production,
  // see 0004 — require a real `conversations` row matching that topic AND
  // `is_chat_participant()` of it, same predicate the rest of chat uses.
  // They are NOT filtered by `extension`: any authenticated participant can
  // write/read any row shape on their own conversation's topic. That's fine
  // — `postgres_changes` never consults this table's RLS at all (a totally
  // separate, already-correct authorization path via conversation_messages),
  // so the omission has no exploitable effect; these tests don't assert it.
  describe('private channel authorization (realtime.messages)', () => {
    const asTopic = async (tx: import('./harness').Actor, topic: string) => {
      await tx.exec(`set local realtime.topic = '${topic}'`)
    }

    it('lets a member send a typing broadcast and track presence on their own conversation', async () => {
      const rows = await asUser(db, ids.user.trekkerA, async (tx) => {
        await asTopic(tx, `conversation:${conv}`)
        return (await tx.query(
          `insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'typing') returning id`,
          [`conversation:${conv}`],
        )).rows
      })
      expect(rows).toHaveLength(1)
    })

    it('refuses a non-member sending presence/broadcast on a conversation they are not in', async () => {
      await expect(
        asUser(db, ids.user.trekkerB, async (tx) => {
          await asTopic(tx, `conversation:${conv}`)
          return tx.query(
            `insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'typing')`,
            [`conversation:${conv}`],
          )
        }),
      ).rejects.toThrow(/row-level security/i)
    })

    it('refuses an anonymous visitor outright', async () => {
      await expect(
        asAnon(db, async (tx) => {
          await asTopic(tx, `conversation:${conv}`)
          return tx.query(
            `insert into realtime.messages (topic, extension, event) values ($1, 'presence', 'sync')`,
            [`conversation:${conv}`],
          )
        }),
      ).rejects.toThrow(/permission denied|row-level security/i)
    })

    it("refuses the operator's own staff, same as the rest of chat", async () => {
      // ownerApproved can post an announcement into this conversation (via
      // is_announcement, SECURITY DEFINER-adjacent) but holds no
      // conversation_participants row — same distinction the read tests above
      // already pin for conversation_messages. Presence/broadcast must follow.
      await expect(
        asUser(db, ids.user.ownerApproved, async (tx) => {
          await asTopic(tx, `conversation:${conv}`)
          return tx.query(
            `insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'typing')`,
            [`conversation:${conv}`],
          )
        }),
      ).rejects.toThrow(/row-level security/i)
    })

    it('refuses a channel topic naming a conversation that does not exist', async () => {
      // The EXISTS clause requires a real conversations row, not just a
      // plausible-looking uuid — a made-up topic must not be an easy in.
      await expect(
        asUser(db, ids.user.trekkerA, async (tx) => {
          await asTopic(tx, 'conversation:00000000-0000-4000-8000-000000000000')
          return tx.query(
            `insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'typing')`,
            ['conversation:00000000-0000-4000-8000-000000000000'],
          )
        }),
      ).rejects.toThrow(/row-level security/i)
    })

    it('a non-member SELECTing presence/broadcast on a real conversation sees nothing, not an error', async () => {
      // RLS on SELECT filters rows rather than raising. Both the write (as
      // the real member) and the read (as a non-member) happen inside one
      // transaction — asUser() rolls each call back, so a row inserted in one
      // call is never visible to the next; switching role mid-transaction is
      // the only way to prove the SELECT policy actually filters a row that
      // exists, rather than just observing an empty table.
      const rows = await asUser(db, ids.user.trekkerA, async (tx) => {
        await asTopic(tx, `conversation:${conv}`)
        await tx.query(
          `insert into realtime.messages (topic, extension, event) values ($1, 'broadcast', 'typing')`,
          [`conversation:${conv}`],
        )

        await tx.exec(`set local role authenticated`)
        await tx.exec(
          `set local request.jwt.claims = '${JSON.stringify({ sub: ids.user.ownerApproved, role: 'authenticated' })}'`,
        )
        return (await tx.query(`select 1 from realtime.messages`)).rows
      })
      expect(rows).toEqual([])
    })
  })
})
