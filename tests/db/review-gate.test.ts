import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asSuperuser, getDb, ids } from './harness'
import type { Actor } from './harness'

/**
 * Who is allowed to say a trek was good.
 *
 * Threat: the original NEW-3 gate asked only "does this user hold a row on any
 * batch of this trek?", which let two people review a trip they had not been
 * on — a 'waitlisted' booker who never got a seat, and anyone who booked a
 * departure months out and reviewed it the same afternoon. Nothing in the
 * schema marks a batch cancelled (no status column, and a batch with bookings
 * cannot be deleted), so a finished date is the only end-of-trip signal there
 * is. 0018 adds both missing questions.
 *
 * Every case reshapes Ridge Walk's one batch rather than adding fixtures, so
 * the date under test is always visible in the test itself. asSuperuser rolls
 * back, so the reshaping never escapes the case that did it.
 */
describe('review gate', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  /**
   * Seed, then drop to `userId` inside the SAME transaction — the setup has to
   * be visible to the attempt, and separate asSuperuser/asUser calls roll back
   * independently.
   */
  const afterReshaping = <T>(
    setup: string,
    userId: string,
    fn: (tx: Actor) => Promise<T>,
  ): Promise<T> =>
    asSuperuser(db, async (tx) => {
      await tx.exec(setup)
      await tx.exec(`set local role authenticated`)
      await tx.exec(
        `set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`,
      )
      return fn(tx)
    })

  /** Ridge Walk departs `batchDate` and runs `duration` hours (null = unset). */
  const ridgeWalk = (batchDate: string, duration: number | null = null) => `
    update public.trek_batches set batch_date = ${batchDate}
      where id = '${ids.batch.approvedActive}';
    update public.treks set duration_hours = ${duration ?? 'null'}
      where id = '${ids.trek.approvedActive}';
  `

  const postReview = (tx: Actor, userId: string) =>
    tx.query(
      `insert into public.trek_reviews (trek_id, user_id, rating, comment)
       values ($1, $2, 5, 'Great trek') returning id`,
      [ids.trek.approvedActive, userId],
    )

  const denied = /row-level security/

  // ---- 1 ---------------------------------------------------------------------
  // The headline bug: a booking for a trip that has not happened yet.
  describe('a trek that has not happened cannot be reviewed', () => {
    it('rejects a confirmed booker while the departure is 30 days out', async () => {
      // The fixture default. Booked today, reviewed today — the exact abuse.
      await expect(
        afterReshaping(ridgeWalk('current_date + 30'), ids.user.trekkerA, (tx) =>
          postReview(tx, ids.user.trekkerA),
        ),
      ).rejects.toThrow(denied)
    })

    it('rejects a confirmed booker on the morning of the trek itself', async () => {
      // The boundary that decides whether "after it ends" means what it says.
      await expect(
        afterReshaping(ridgeWalk('current_date'), ids.user.trekkerA, (tx) =>
          postReview(tx, ids.user.trekkerA),
        ),
      ).rejects.toThrow(denied)
    })

    it('accepts a confirmed booker the day after a day-trek', async () => {
      // Guards against a gate tightened into uselessness: if this fails, every
      // rejection above passes for the wrong reason.
      const rows = await afterReshaping(
        ridgeWalk('current_date - 1'),
        ids.user.trekkerA,
        (tx) => postReview(tx, ids.user.trekkerA),
      )
      expect(rows.rows).toHaveLength(1)
    })
  })

  // ---- 2 ---------------------------------------------------------------------
  // duration_hours is hours, not days, and 5 of 14 live treks exceed 24. A
  // plain `batch_date < current_date` would unlock these mid-trip.
  describe('a multi-day trek stays closed until its last day is over', () => {
    it('rejects a 35-hour trek that departed yesterday and ends today', async () => {
      await expect(
        afterReshaping(ridgeWalk('current_date - 1', 35), ids.user.trekkerA, (tx) =>
          postReview(tx, ids.user.trekkerA),
        ),
      ).rejects.toThrow(denied)
    })

    it('accepts the same 35-hour trek once it departed two days ago', async () => {
      const rows = await afterReshaping(
        ridgeWalk('current_date - 2', 35),
        ids.user.trekkerA,
        (tx) => postReview(tx, ids.user.trekkerA),
      )
      expect(rows.rows).toHaveLength(1)
    })

    it('treats a sub-24-hour duration as a single day', async () => {
      // 2h must behave exactly like the null case above, not round up to two.
      const rows = await afterReshaping(
        ridgeWalk('current_date - 1', 2),
        ids.user.trekkerA,
        (tx) => postReview(tx, ids.user.trekkerA),
      )
      expect(rows.rows).toHaveLength(1)
    })
  })

  // ---- 3 ---------------------------------------------------------------------
  // Threat: a waitlisted booker never held a seat. Promotion is FIFO via
  // promote_waitlist_on_leave(); until it happens they did not go.
  describe('a waitlisted booker cannot review even after the trek is over', () => {
    it('rejects them on a trek that finished yesterday', async () => {
      await expect(
        afterReshaping(
          ridgeWalk('current_date - 1') +
            `update public.trek_participants set status = 'waitlisted'
               where user_id = '${ids.user.trekkerA}'
                 and batch_id = '${ids.batch.approvedActive}';`,
          ids.user.trekkerA,
          (tx) => postReview(tx, ids.user.trekkerA),
        ),
      ).rejects.toThrow(denied)
    })
  })

  // ---- 4 ---------------------------------------------------------------------
  // The gate NEW-3 did get right, re-asserted so 0018 cannot regress it.
  describe('someone who never booked cannot review', () => {
    it('rejects a stranger on a trek that finished yesterday', async () => {
      await expect(
        afterReshaping(ridgeWalk('current_date - 1'), ids.user.trekkerB, (tx) =>
          postReview(tx, ids.user.trekkerB),
        ),
      ).rejects.toThrow(denied)
    })
  })

  // ---- 5 ---------------------------------------------------------------------
  // Threat: the UPDATE policy's WITH CHECK pinned only user_id, so trek_id was
  // rewritable — post a legitimate review on a finished trek, then move it onto
  // a trek departing next month. A WITH CHECK cannot see the OLD row, so the
  // gate has to be restated there rather than pinning the column. Same shape as
  // the trek_participants batch_id hole the M-update fix closed.
  describe('a review cannot be moved onto a trek the author has not finished', () => {
    it('rejects rewriting trek_id onto a future booking of theirs', async () => {
      // Taken Down is trekkerA's other confirmed booking, still 30 days out.
      // is_trek_visible's participant arm keeps it readable to them, so this
      // fails on the date gate and not on visibility.
      await expect(
        afterReshaping(ridgeWalk('current_date - 1'), ids.user.trekkerA, async (tx) => {
          await postReview(tx, ids.user.trekkerA)
          return tx.query(
            `update public.trek_reviews set trek_id = $1 where user_id = $2`,
            [ids.trek.suspendedActive, ids.user.trekkerA],
          )
        }),
      ).rejects.toThrow(denied)
    })

    it('still lets the author edit the review in place', async () => {
      const rows = await afterReshaping(
        ridgeWalk('current_date - 1'),
        ids.user.trekkerA,
        async (tx) => {
          await postReview(tx, ids.user.trekkerA)
          return tx.query(
            `update public.trek_reviews set rating = 3 where user_id = $1 returning rating`,
            [ids.user.trekkerA],
          )
        },
      )
      expect(rows.rows).toEqual([{ rating: 3 }])
    })
  })

  // ---- 6 ---------------------------------------------------------------------
  // 0031: the form's five-photo cap, restated where a direct API write cannot
  // skip it. The shutterbug badge sums photo counts, so this is what bounds it.
  describe('a review carries at most five photos', () => {
    const overCap = /trek_reviews_photo_urls_max/

    const postWithPhotos = (tx: Actor, userId: string, n: number) =>
      tx.query(
        `insert into public.trek_reviews (trek_id, user_id, rating, comment, photo_urls)
         values ($1, $2, 5, 'Great trek', array_fill('https://media.example/p.jpg'::text, array[${n}]))
         returning cardinality(photo_urls) as photos`,
        [ids.trek.approvedActive, userId],
      )

    it('accepts five', async () => {
      const rows = await afterReshaping(ridgeWalk('current_date - 1'), ids.user.trekkerA, (tx) =>
        postWithPhotos(tx, ids.user.trekkerA, 5),
      )
      expect(rows.rows).toEqual([{ photos: 5 }])
    })

    it('rejects six on insert', async () => {
      await expect(
        afterReshaping(ridgeWalk('current_date - 1'), ids.user.trekkerA, (tx) =>
          postWithPhotos(tx, ids.user.trekkerA, 6),
        ),
      ).rejects.toThrow(overCap)
    })

    it('rejects growing a posted review past five', async () => {
      await expect(
        afterReshaping(ridgeWalk('current_date - 1'), ids.user.trekkerA, async (tx) => {
          await postWithPhotos(tx, ids.user.trekkerA, 5)
          return tx.query(
            `update public.trek_reviews
                set photo_urls = photo_urls || 'https://media.example/six.jpg'::text
              where user_id = $1`,
            [ids.user.trekkerA],
          )
        }),
      ).rejects.toThrow(overCap)
    })
  })
})
