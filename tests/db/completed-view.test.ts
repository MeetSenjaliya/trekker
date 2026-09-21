import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asSuperuser, getDb, ids } from './harness'
import type { Actor } from './harness'

/**
 * user_completed_treks must agree with recompute_user_stats() about what
 * "completed" means (0026 aligned it with 0020). The oracle is therefore the
 * function, not a hand-written expectation: for every scenario the view's row
 * count for the user equals user_stats.treks_completed after a recompute.
 *
 * Read as superuser: no client role holds SELECT on the view, and RLS on the
 * underlying tables is not what is under test here.
 */
describe('user_completed_treks agrees with recompute_user_stats (0026)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const trek = '00000000-0000-4000-8000-00000d7e0026'
  const batch = '00000000-0000-4000-8000-00000ba70026'

  /**
   * Same clock-faking as badge-farming.test.ts: book while the departure is
   * still ahead, backdate joined_at to stand in for time passing, then move
   * the departure into the past and recompute.
   */
  const scenario = (opts: {
    durationHours: number | null
    departedDaysAgo: number
    status: 'confirmed' | 'waitlisted'
    bookedBeforeDeparture: boolean
  }) => `
    insert into public.treks (id, title, description, location, difficulty,
                              distance_km, duration_hours, estimated_cost,
                              max_participants, company_id, is_active)
    values ('${trek}', 'View Route', 'x', 'Nowhere', 'Easy', 10,
            ${opts.durationHours ?? 'null'}, 1, 10, '${ids.company.approved}', true);
    insert into public.trek_batches (id, trek_id, batch_date, max_participants)
    values ('${batch}', '${trek}', current_date + 30, 10);
    insert into public.trek_participants (user_id, batch_id, status)
    values ('${ids.user.trekkerB}', '${batch}', '${opts.status}');
    ${
      opts.bookedBeforeDeparture
        ? `update public.trek_participants set joined_at = now() - interval '30 days'
             where user_id = '${ids.user.trekkerB}' and batch_id = '${batch}';`
        : ''
    }
    update public.trek_batches set batch_date = current_date - ${opts.departedDaysAgo}
     where id = '${batch}';
    select public.recompute_user_stats('${ids.user.trekkerB}');`

  const viewAndStats = async (tx: Actor) => {
    const view = await tx.query<{ n: number }>(
      `select count(*)::int as n from public.user_completed_treks where user_id = $1`,
      [ids.user.trekkerB],
    )
    const stats = await tx.query<{ n: number }>(
      `select treks_completed::int as n from public.user_stats where user_id = $1`,
      [ids.user.trekkerB],
    )
    return { view: view.rows[0].n, stats: stats.rows[0]?.n ?? 0 }
  }

  const run = (opts: Parameters<typeof scenario>[0]) =>
    asSuperuser(db, async (tx) => {
      await tx.exec(scenario(opts))
      return viewAndStats(tx)
    })

  it('lists a one-day trek that departed yesterday', async () => {
    const r = await run({
      durationHours: null,
      departedDaysAgo: 1,
      status: 'confirmed',
      bookedBeforeDeparture: true,
    })
    expect(r).toEqual({ view: 1, stats: 1 })
  })

  it('does not list a three-day trek that is still under way', async () => {
    // Departed yesterday, ends tomorrow. 0001's bare `batch_date < current_date`
    // listed this; 0020 does not count it.
    const r = await run({
      durationHours: 72,
      departedDaysAgo: 1,
      status: 'confirmed',
      bookedBeforeDeparture: true,
    })
    expect(r).toEqual({ view: 0, stats: 0 })
  })

  it('lists a three-day trek once its last day has passed', async () => {
    const r = await run({
      durationHours: 72,
      departedDaysAgo: 3,
      status: 'confirmed',
      bookedBeforeDeparture: true,
    })
    expect(r).toEqual({ view: 1, stats: 1 })
  })

  it('does not list a waitlisted booking on an ended trek', async () => {
    const r = await run({
      durationHours: null,
      departedDaysAgo: 1,
      status: 'waitlisted',
      bookedBeforeDeparture: true,
    })
    expect(r).toEqual({ view: 0, stats: 0 })
  })

  it('does not list a booking made after the trek departed', async () => {
    const r = await run({
      durationHours: null,
      departedDaysAgo: 1,
      status: 'confirmed',
      bookedBeforeDeparture: false,
    })
    expect(r).toEqual({ view: 0, stats: 0 })
  })
})
