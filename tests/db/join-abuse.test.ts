import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, asSuperuser, asUser, getDb, ids } from './harness'
import type { Actor } from './harness'

/**
 * The guards inside join_trek_and_chat(), which no RLS test can reach.
 *
 * The RPC is SECURITY DEFINER, so once execution is inside it every policy the
 * rest of this suite asserts is bypassed. The `if … raise exception` lines at
 * the top of its body are all that stands between a caller and (a) a booking
 * written under another user's id, (b) a fresh trek_batches + conversations
 * row per call for any date it is handed, and (c) an unbounded number of
 * bookings an hour. catalogue-writes and chat both assert that the direct
 * inserts fail and name this RPC as the path that is supposed to succeed — so
 * until now nothing exercised the guards on it. All three were verified by
 * hand once (FEATURES §2 "H — behavioural verification"); this is what
 * survives the next restatement of the body.
 *
 * trekkerB is the caller throughout: signed in, booked nothing.
 */
describe('join_trek_and_chat guards', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  type JoinResult = {
    batch_id: string
    participant_id: string
    conversation_id: string
    status: string
    waitlist_position: number | null
  }

  const join = async (
    tx: Actor,
    userId: string | null,
    trekId: string,
    date = 'current_date + 30',
  ) => {
    const { rows } = await tx.query<{ join_trek_and_chat: JoinResult }>(
      `select public.join_trek_and_chat($1, $2, ${date})`,
      [userId, trekId],
    )
    return rows[0]!.join_trek_and_chat
  }

  // ---- 1 ---------------------------------------------------------------------
  // p_user_id exists for the client's convenience and the function ignores it
  // in favour of auth.uid() — but only because of one comparison. Drop it and
  // every write below lands under whatever id the request body carried.
  describe('the caller books as themselves and nobody else', () => {
    it('refuses a p_user_id naming another user', async () => {
      await expect(
        asUser(db, ids.user.trekkerB, (tx) => join(tx, ids.user.trekkerA, ids.trek.approvedActive)),
      ).rejects.toThrow(/p_user_id must equal the authenticated user/)
    })

    it('refuses a null p_user_id', async () => {
      // `null <> uid` is null, not true, so a guard written as `if p_user_id <>
      // v_uid` lets NULL straight through. The guard checks `is null` first.
      await expect(
        asUser(db, ids.user.trekkerB, (tx) => join(tx, null, ids.trek.approvedActive)),
      ).rejects.toThrow(/p_user_id must equal the authenticated user/)
    })

    it('refuses an anonymous caller before the body runs', async () => {
      // anon has no EXECUTE grant (acl.test.ts pins the grant table), so this
      // is refused at the door rather than by the `Not authenticated` guard.
      // Both are wanted: the grant is the guard's backstop if it ever slips.
      await expect(
        asAnon(db, (tx) => join(tx, ids.user.trekkerB, ids.trek.approvedActive)),
      ).rejects.toThrow(/permission denied for function join_trek_and_chat/)
    })

    it('books the caller under their own id', async () => {
      // The control: the guard has to let the honest call through, and the row
      // it writes has to carry the caller's id rather than the parameter's.
      const owner = await asUser(db, ids.user.trekkerB, async (tx) => {
        const { participant_id } = await join(tx, ids.user.trekkerB, ids.trek.approvedActive)
        const { rows } = await tx.query<{ user_id: string }>(
          `select user_id from public.trek_participants where id = $1`,
          [participant_id],
        )
        return rows[0]?.user_id
      })
      expect(owner).toBe(ids.user.trekkerB)
    })
  })

  // ---- 2 ---------------------------------------------------------------------
  // Every accepted date the trek has no batch for costs a trek_batches row and
  // a conversations row, created on demand. The window is what makes that
  // finite: yesterday (UTC/IST slack, which badge-farming relies on) through
  // one year out.
  describe('the batch date is bounded to a window', () => {
    it('refuses a date two days back', async () => {
      await expect(
        asUser(db, ids.user.trekkerB, (tx) =>
          join(tx, ids.user.trekkerB, ids.trek.approvedActive, 'current_date - 2'),
        ),
      ).rejects.toThrow(/in the past/)
    })

    it('still accepts yesterday', async () => {
      const { status } = await asUser(db, ids.user.trekkerB, (tx) =>
        join(tx, ids.user.trekkerB, ids.trek.approvedActive, 'current_date - 1'),
      )
      expect(status).toBe('confirmed')
    })

    it('refuses a date a year and a day out', async () => {
      await expect(
        asUser(db, ids.user.trekkerB, (tx) =>
          join(
            tx,
            ids.user.trekkerB,
            ids.trek.approvedActive,
            `(current_date + interval '1 year' + interval '1 day')::date`,
          ),
        ),
      ).rejects.toThrow(/too far in the future/)
    })

    it('still accepts exactly a year out', async () => {
      const { status } = await asUser(db, ids.user.trekkerB, (tx) =>
        join(
          tx,
          ids.user.trekkerB,
          ids.trek.approvedActive,
          `(current_date + interval '1 year')::date`,
        ),
      )
      expect(status).toBe('confirmed')
    })

    it('refuses a null date', async () => {
      await expect(
        asUser(db, ids.user.trekkerB, (tx) =>
          join(tx, ids.user.trekkerB, ids.trek.approvedActive, 'null::date'),
        ),
      ).rejects.toThrow(/Batch date is required/)
    })

    it('creates the batch and its chat on demand for a date inside the window', async () => {
      // What the window is guarding: a date nothing has been scheduled for is
      // not refused, it is *built*. The fixture's only Ridge Walk batch is at
      // +30, so +31 must come back as a batch and a conversation that did not
      // exist before the call.
      const result = await asUser(db, ids.user.trekkerB, (tx) =>
        join(tx, ids.user.trekkerB, ids.trek.approvedActive, 'current_date + 31'),
      )
      expect(result.batch_id).not.toBe(ids.batch.approvedActive)
      expect(result.conversation_id).not.toBe(ids.conversation.approvedActive)
      expect(result.status).toBe('confirmed')
    })
  })

  // ---- 3 ---------------------------------------------------------------------
  // Ten bookings an hour. Each call here uses a different date on Ridge Walk,
  // so each is a genuine new booking — a repeat on a batch the caller already
  // holds returns the existing row without inserting, and it is the INSERT the
  // trigger counts.
  describe('a user may make ten bookings an hour', () => {
    const joinDays = async (tx: Actor, userId: string, days: number[]) => {
      for (const d of days) {
        await join(tx, userId, ids.trek.approvedActive, `current_date + ${d}`)
      }
    }
    const tenDays = Array.from({ length: 10 }, (_, i) => i + 1)
    const capped = /too many treks in the last hour/

    it('lets the first ten through and refuses the eleventh', async () => {
      await expect(
        asUser(db, ids.user.trekkerB, (tx) => joinDays(tx, ids.user.trekkerB, [...tenDays, 11])),
      ).rejects.toThrow(capped)
    })

    it('counts the direct insert that skips the RPC', async () => {
      // The limit is a trigger on trek_participants, not a line in the RPC,
      // precisely so a POST straight at the table pays the same toll.
      await expect(
        asUser(db, ids.user.trekkerB, async (tx) => {
          await joinDays(tx, ids.user.trekkerB, tenDays)
          await tx.query(
            `insert into public.trek_participants (user_id, batch_id) values ($1, $2)`,
            [ids.user.trekkerB, ids.batch.approvedActive],
          )
        }),
      ).rejects.toThrow(capped)
    })

    it('does not count a repeat join on a batch already held', async () => {
      // The eleventh *call* is fine when it is not an eleventh *booking*: the
      // already-a-participant branch returns the first row untouched.
      const { status } = await asUser(db, ids.user.trekkerB, async (tx) => {
        await joinDays(tx, ids.user.trekkerB, tenDays)
        return join(tx, ids.user.trekkerB, ids.trek.approvedActive, 'current_date + 1')
      })
      expect(status).toBe('confirmed')
    })

    it('is per user, so one at the cap does not block another', async () => {
      const { status } = await asUser(db, ids.user.trekkerB, async (tx) => {
        await joinDays(tx, ids.user.trekkerB, tenDays)
        // Same transaction, other seat: trekkerA's first new booking of the hour.
        await tx.exec(
          `set local request.jwt.claims = '${JSON.stringify({ sub: ids.user.trekkerA, role: 'authenticated' })}'`,
        )
        return join(tx, ids.user.trekkerA, ids.trek.approvedActive, 'current_date + 1')
      })
      expect(status).toBe('confirmed')
    })

    it('counts only the trailing hour', async () => {
      // Ten bookings two hours ago must not hold the window shut now. The stale
      // events are seeded as superuser and the attempt runs as trekkerB in the
      // same transaction, since separate asSuperuser/asUser calls roll back
      // independently.
      const { status } = await asSuperuser(db, async (tx) => {
        await tx.query(
          `insert into public.rate_events (actor, action, at)
           select $1, 'join', now() - interval '2 hours' from generate_series(1, 10)`,
          [ids.user.trekkerB],
        )
        await tx.exec(`set local role authenticated`)
        await tx.exec(
          `set local request.jwt.claims = '${JSON.stringify({ sub: ids.user.trekkerB, role: 'authenticated' })}'`,
        )
        return join(tx, ids.user.trekkerB, ids.trek.approvedActive)
      })
      expect(status).toBe('confirmed')
    })

    it('is a trigger on the bookings table, not something the RPC opts into', async () => {
      const { rows } = await db.query<{ tgenabled: string; tgtype: number }>(`
        select tgenabled, tgtype
          from pg_trigger
         where tgrelid = 'public.trek_participants'::regclass
           and tgname = 'trek_participants_rate_limit'
      `)
      expect(rows).toHaveLength(1)
      // 5 = ROW | INSERT, i.e. AFTER INSERT. The count runs before the log row
      // is written either way; what matters is that it fires per booking row.
      expect(rows[0]!.tgtype).toBe(5)
      expect(rows[0]!.tgenabled).toBe('O')
    })
  })
})
