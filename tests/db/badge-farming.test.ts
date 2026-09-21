import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asSuperuser, getDb, ids } from './harness'
import type { Actor } from './harness'

/**
 * Badges must cost a trek you actually held.
 *
 * Threat (#8): join_trek_and_chat accepts a batch dated yesterday (UTC/IST
 * slack) and every completion metric read `batch_date < current_date`, so a
 * trek was completed the instant it was joined. Badges only ever inserted, so
 * leaving reset user_stats to zero and left the badges standing. One join +
 * one leave on a 500 km Expert trek bought six of the fifteen.
 *
 * 0020 makes a badge a pure function of the bookings held right now.
 */
describe('badge farming', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  /** A 500 km Expert trek in a location no fixture uses. */
  const farmTrek = '00000000-0000-4000-8000-00000d7e0009'
  const farmBatch = '00000000-0000-4000-8000-00000ba70009'

  /**
   * The honest path a real trekker takes, with the clock faked in both places
   * the clock actually moves: book a departure while it is still in the future,
   * let the date pass, let the nightly pg_cron catch-up recompute.
   *
   * The two setup UPDATEs stand in for 30 days elapsing. Backdating joined_at
   * is not a shortcut past the 0020 gate — it is the half of "time passed" that
   * a moved batch_date alone cannot express, and it runs as superuser because
   * the column is pinned against exactly this from the client seat (part 2).
   * The recompute call is likewise the real mechanism: trg_participant_stats
   * fires on insert/delete only, so nothing recomputes when a date crosses into
   * the past.
   */
  const bookedThenFinished = (departedDaysAgo: number) => `
    insert into public.trek_batches (id, trek_id, batch_date, max_participants)
      values ('${farmBatch}', '${farmTrek}', current_date + 30, 10);
    insert into public.trek_participants (user_id, batch_id, status)
      values ('${ids.user.trekkerB}', '${farmBatch}', 'confirmed');
    update public.trek_participants set joined_at = now() - interval '30 days'
      where user_id = '${ids.user.trekkerB}' and batch_id = '${farmBatch}';
    update public.trek_batches set batch_date = current_date - ${departedDaysAgo}
      where id = '${farmBatch}';
    select public.recompute_user_stats('${ids.user.trekkerB}');`

  /**
   * Seed, then drop to trekkerB inside the SAME transaction — the setup has to
   * be visible to the attempt, and separate asSuperuser/asUser calls roll back
   * independently. trekkerB starts with no bookings, so every badge observed
   * here was bought by the case that ran.
   */
  const asTrekkerB = <T>(setup: string, fn: (tx: Actor) => Promise<T>): Promise<T> =>
    asSuperuser(db, async (tx) => {
      await tx.exec(`
        insert into public.treks (id, title, description, location, difficulty,
                                  distance_km, duration_hours, estimated_cost,
                                  max_participants, company_id, is_active)
        values ('${farmTrek}', 'Farm Route', 'x', 'Nowhere', 'Expert', 500, null, 1, 10,
                '${ids.company.approved}', true);
        ${setup}
      `)
      await tx.exec(`set local role authenticated`)
      await tx.exec(
        `set local request.jwt.claims = '${JSON.stringify({ sub: ids.user.trekkerB, role: 'authenticated' })}'`,
      )
      return fn(tx)
    })

  const badges = async (tx: Actor) =>
    (
      await tx.query<{ achievement_key: string }>(
        `select achievement_key from public.user_achievements
          where user_id = $1 order by 1`,
        [ids.user.trekkerB],
      )
    ).rows.map((r) => r.achievement_key)

  const stats = async (tx: Actor) =>
    (
      await tx.query(
        `select treks_completed, total_distance_km::float8 as km
           from public.user_stats where user_id = $1`,
        [ids.user.trekkerB],
      )
    ).rows

  const join = (tx: Actor, date: string) =>
    tx.query(`select public.join_trek_and_chat($1, $2, ${date})`, [
      ids.user.trekkerB,
      farmTrek,
    ])

  // ---- 1 ---------------------------------------------------------------------
  // The headline bug, run exactly as the report describes it.
  describe('a trek joined after it happened earns nothing', () => {
    it('grants no completion badge for a yesterday-dated join', async () => {
      const earned = await asTrekkerB('', async (tx) => {
        await join(tx, 'current_date - 1')
        return badges(tx)
      })
      // trailblazer is "booked one trek" and is honestly earned by the join.
      expect(earned).toEqual(['trailblazer'])
    })

    it('leaves stats at zero for a yesterday-dated join', async () => {
      const rows = await asTrekkerB('', async (tx) => {
        await join(tx, 'current_date - 1')
        return stats(tx)
      })
      expect(rows).toEqual([{ treks_completed: 0, km: 0 }])
    })

    it('still counts a booking made before the trek departed', async () => {
      // Guards against a gate tightened into uselessness: if this fails, every
      // assertion above passes for the wrong reason.
      const earned = await asTrekkerB(bookedThenFinished(1), badges)
      expect(earned).toEqual(
        expect.arrayContaining([
          'first_steps',
          'warming_up',
          'centurion',
          'ultra_explorer',
          'peak_conqueror',
        ]),
      )
    })
  })

  // ---- 2 ---------------------------------------------------------------------
  // joined_at is what part 1 rests on, and the INSERT policy checks only
  // `auth.uid() = user_id and is_trekker()` — nothing pinned the column, so a
  // direct PostgREST insert could backdate it and re-open the whole hole.
  describe('joined_at cannot be dictated by the client', () => {
    it('overwrites a backdated joined_at on a direct insert', async () => {
      const rows = await asTrekkerB(
        `insert into public.trek_batches (id, trek_id, batch_date, max_participants)
           values ('00000000-0000-4000-8000-00000ba70009', '${farmTrek}', current_date - 1, 10);`,
        async (tx) =>
          (
            await tx.query<{ backdated: boolean }>(
              `insert into public.trek_participants (user_id, batch_id, status, joined_at)
               values ($1, '00000000-0000-4000-8000-00000ba70009', 'confirmed',
                       now() - interval '400 days')
               returning joined_at < now() - interval '1 hour' as backdated`,
              [ids.user.trekkerB],
            )
          ).rows,
      )
      expect(rows).toEqual([{ backdated: false }])
    })

    it('earns no completion badge from that backdated insert', async () => {
      const earned = await asTrekkerB(
        `insert into public.trek_batches (id, trek_id, batch_date, max_participants)
           values ('00000000-0000-4000-8000-00000ba70009', '${farmTrek}', current_date - 1, 10);`,
        async (tx) => {
          await tx.query(
            `insert into public.trek_participants (user_id, batch_id, status, joined_at)
             values ($1, '00000000-0000-4000-8000-00000ba70009', 'confirmed',
                     now() - interval '400 days')`,
            [ids.user.trekkerB],
          )
          return badges(tx)
        },
      )
      expect(earned).toEqual(['trailblazer'])
    })
  })

  // ---- 3 ---------------------------------------------------------------------
  // The half that made farming repeatable: badges outlived the evidence, so the
  // price of a permanent badge was one join and one leave.
  describe('leaving takes back what it un-earns', () => {
    it('revokes every distance and completion badge on leave', async () => {
      const earned = await asTrekkerB(bookedThenFinished(1), async (tx) => {
        await tx.query(`delete from public.trek_participants where user_id = $1`, [
          ids.user.trekkerB,
        ])
        return badges(tx)
      })
      expect(earned).toEqual([])
    })

    it('keeps badges and stats telling the same story', async () => {
      // The visible tell of the old bug: ultra_explorer beside 0 km.
      const rows = await asTrekkerB(bookedThenFinished(1), async (tx) => {
        await tx.query(`delete from public.trek_participants where user_id = $1`, [
          ids.user.trekkerB,
        ])
        return stats(tx)
      })
      expect(rows).toEqual([{ treks_completed: 0, km: 0 }])
    })
  })

  // ---- 4 ---------------------------------------------------------------------
  // duration_hours is hours, not days. The old `batch_date < current_date` also
  // banked a multi-day trek mid-trip — the same defect 0018 fixed for reviews
  // and never reached these two functions.
  describe('a multi-day trek is not completed until its last day is over', () => {
    const midTrip = (departedDaysAgo: number) =>
      `update public.treks set duration_hours = 35 where id = '${farmTrek}';` +
      bookedThenFinished(departedDaysAgo)

    it('does not bank a 35-hour trek that departed yesterday', async () => {
      expect(await asTrekkerB(midTrip(1), badges)).toEqual(['trailblazer'])
    })

    it('banks the same trek once it departed two days ago', async () => {
      expect(await asTrekkerB(midTrip(2), badges)).toContain('first_steps')
    })
  })
})
