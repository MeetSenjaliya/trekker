import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, asUser, getDb, ids } from './harness'
import type { Actor } from './harness'

/**
 * record_upload(p_bucket) — the upload rate limit as the R2 route sees it
 * (0030). The route calls it before every PUT and turns false into a 429, so
 * this is the whole of the cap: a wrong answer here is either an open door or
 * a user locked out of their own avatar.
 *
 * The limits themselves come from storage_rate_rule() (0001 §13.4), which is
 * why the numbers below match the storage trigger's.
 */
describe('record_upload', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const record = async (tx: Actor, bucket: string) => {
    const { rows } = await tx.query<{ record_upload: boolean }>(`select public.record_upload($1)`, [bucket])
    return rows[0]!.record_upload
  }

  // rate_events has no client grants, so the counter is read and reset as
  // superuser inside the (rolled-back) transaction. The reset matters: the
  // fixtures seed storage.objects rows, and until 0031 those still fire the
  // storage trigger, which has already spent part of each seeded owner's budget.
  const fresh = async (tx: Actor, actor: string) => {
    await tx.exec(`reset role`)
    await tx.query(`delete from public.rate_events where actor = $1`, [actor])
    await tx.exec(`set local role authenticated`)
  }

  const rowsFor = async (tx: Actor, actor: string, action: string) => {
    await tx.exec(`reset role`)
    const { rows } = await tx.query<{ n: number }>(
      `select count(*)::int as n from public.rate_events where actor = $1 and action = $2`,
      [actor, action],
    )
    return rows[0]!.n
  }

  it('allows six avatar uploads in an hour and refuses the seventh', async () => {
    const answers = await asUser(db, ids.user.trekkerA, async (tx) => {
      await fresh(tx, ids.user.trekkerA)
      const out: boolean[] = []
      for (let i = 0; i < 7; i++) out.push(await record(tx, 'avatars'))
      return out
    })
    expect(answers).toEqual([true, true, true, true, true, true, false])
  })

  it('writes one rate_events row per allowed upload and none for a refusal', async () => {
    const n = await asUser(db, ids.user.trekkerA, async (tx) => {
      await fresh(tx, ids.user.trekkerA)
      for (let i = 0; i < 7; i++) await record(tx, 'avatars')
      return rowsFor(tx, ids.user.trekkerA, 'upload')
    })
    expect(n).toBe(6)
  })

  it('shares the 6/hour counter across avatars, company-logos and trek-images', async () => {
    const answers = await asUser(db, ids.user.ownerApproved, async (tx) => {
      await fresh(tx, ids.user.ownerApproved)
      return [
        await record(tx, 'avatars'),
        await record(tx, 'avatars'),
        await record(tx, 'company-logos'),
        await record(tx, 'company-logos'),
        await record(tx, 'trek-images'),
        await record(tx, 'trek-images'),
        await record(tx, 'trek-images'),
      ]
    })
    expect(answers).toEqual([true, true, true, true, true, true, false])
  })

  it('gives trek-reviews its own 20/hour counter', async () => {
    const answers = await asUser(db, ids.user.trekkerA, async (tx) => {
      await fresh(tx, ids.user.trekkerA)
      for (let i = 0; i < 6; i++) await record(tx, 'avatars')
      const reviews: boolean[] = []
      for (let i = 0; i < 21; i++) reviews.push(await record(tx, 'trek-reviews'))
      return reviews
    })
    expect(answers.slice(0, 20).every(Boolean)).toBe(true)
    expect(answers[20]).toBe(false)
  })

  it('is per user, so one user at the cap does not block another', async () => {
    const answer = await asUser(db, ids.user.trekkerA, async (tx) => {
      await fresh(tx, ids.user.trekkerA)
      await fresh(tx, ids.user.trekkerB)
      for (let i = 0; i < 6; i++) await record(tx, 'avatars')
      await tx.exec(
        `set local request.jwt.claims = '${JSON.stringify({ sub: ids.user.trekkerB, role: 'authenticated' })}'`,
      )
      return record(tx, 'avatars')
    })
    expect(answer).toBe(true)
  })

  it('counts only the trailing hour', async () => {
    const answer = await asUser(db, ids.user.trekkerA, async (tx) => {
      await fresh(tx, ids.user.trekkerA)
      await tx.exec(`reset role`)
      await tx.query(
        `insert into public.rate_events (actor, action, at)
         select $1, 'upload', now() - interval '2 hours' from generate_series(1, 6)`,
        [ids.user.trekkerA],
      )
      await tx.exec(`set local role authenticated`)
      return record(tx, 'avatars')
    })
    expect(answer).toBe(true)
  })

  it('refuses a bucket with no rule and writes nothing', async () => {
    const result = await asUser(db, ids.user.trekkerA, async (tx) => {
      await fresh(tx, ids.user.trekkerA)
      const legacy = await record(tx, 'trek-profile')
      const unknown = await record(tx, 'anything-else')
      return { legacy, unknown, rows: await rowsFor(tx, ids.user.trekkerA, 'upload') }
    })
    expect(result).toEqual({ legacy: false, unknown: false, rows: 0 })
  })

  it('cannot be called by anon', async () => {
    await expect(asAnon(db, (tx) => record(tx, 'avatars'))).rejects.toThrow(/permission denied/i)
  })

  it('is granted to authenticated and to nobody else', async () => {
    const { rows } = await db.query<{ role: string; ok: boolean }>(`
      select r.role, has_function_privilege(r.role, 'public.record_upload(text)', 'EXECUTE') as ok
        from (values ('anon'), ('authenticated')) as r(role)
    `)
    expect(rows).toEqual([
      { role: 'anon', ok: false },
      { role: 'authenticated', ok: true },
    ])
  })
})
