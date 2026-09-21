import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, asSuperuser, asUser, getDb, ids, type Actor } from './harness'

/**
 * 0027 — login_events, filled by a trigger on auth.sessions.
 * 0028 — ended_at (session DELETE), method (auth.mfa_amr_claims trigger),
 *        account_type snapshot and is_new_device.
 *
 * GoTrue is the only writer of auth.sessions and auth.mfa_amr_claims, so a
 * superuser INSERT stands in for a sign-in here and a superuser DELETE for a
 * sign-out. The rows it produces are read back under RLS as the platform
 * admin, the user who signed in, a stranger, and anon.
 */

const SESSION = '00000000-0000-4000-8000-00000005e001'
const SESSION_2 = '00000000-0000-4000-8000-00000005e002'
const IP = '203.0.113.7'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36'
const UA_NEXT_CHROME = UA.replace('Chrome/151.0.0.0', 'Chrome/152.0.6099.71')
const UA_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0'

async function signIn(
  tx: Actor,
  userId: string,
  sessionId = SESSION,
  { ip = IP, ua = UA }: { ip?: string; ua?: string } = {},
) {
  await tx.query(
    `insert into auth.sessions (id, user_id, ip, user_agent, created_at)
     values ($1, $2, $3, $4, now() - interval '1 hour')`,
    [sessionId, userId, ip, ua],
  )
}

async function claim(tx: Actor, sessionId: string, method: string) {
  await tx.query(
    `insert into auth.mfa_amr_claims (session_id, authentication_method) values ($1, $2)`,
    [sessionId, method],
  )
}

async function readMethod(tx: Actor, sessionId: string) {
  return (
    await tx.query<{ method: string | null }>(
      `select method from public.login_events where session_id = $1`,
      [sessionId],
    )
  ).rows[0].method
}

async function readEvents(tx: Actor) {
  return (
    await tx.query<{ session_id: string; email: string; ip: string; user_agent: string }>(
      `select session_id, email, ip, user_agent from public.login_events order by id`,
    )
  ).rows
}

describe('login_events — recorded from auth.sessions', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  it('a new session becomes one row with its ip, user-agent and the account email', async () => {
    const rows = await asSuperuser(db, async (tx) => {
      await signIn(tx, ids.user.trekkerA)
      return readEvents(tx)
    })
    expect(rows).toEqual([
      { session_id: SESSION, email: 'trekker.a@example.test', ip: '203.0.113.7', user_agent: UA },
    ])
  })

  it('a token refresh bumps last_seen_at; other session updates do not', async () => {
    const { afterRefresh, afterOther } = await asSuperuser(db, async (tx) => {
      await signIn(tx, ids.user.trekkerA)
      const seen = async () =>
        (
          await tx.query<{ bumped: boolean }>(
            `select last_seen_at > created_at as bumped from public.login_events where session_id = $1`,
            [SESSION],
          )
        ).rows[0].bumped

      await tx.query(`update auth.sessions set user_agent = 'other' where id = $1`, [SESSION])
      const afterOther = await seen()

      await tx.query(`update auth.sessions set refreshed_at = now() where id = $1`, [SESSION])
      const afterRefresh = await seen()

      return { afterRefresh, afterOther }
    })
    expect(afterOther).toBe(false)
    expect(afterRefresh).toBe(true)
  })

  it('the platform admin reads every row', async () => {
    const rows = await asSuperuser(db, async (tx) => {
      await signIn(tx, ids.user.trekkerA)
      await signIn(tx, ids.user.trekkerB, '00000000-0000-4000-8000-00000005e002')
      await tx.exec(`set local role authenticated`)
      await tx.exec(
        `set local request.jwt.claims = '${JSON.stringify({ sub: ids.user.platformAdmin, role: 'authenticated' })}'`,
      )
      return readEvents(tx)
    })
    expect(rows.map((r) => r.email)).toEqual(['trekker.a@example.test', 'trekker.b@example.test'])
  })

  it('the user who signed in and a stranger read nothing; anon is refused outright', async () => {
    const asClaims = (sub: string) =>
      `set local request.jwt.claims = '${JSON.stringify({ sub, role: 'authenticated' })}'`

    for (const sub of [ids.user.trekkerA, ids.user.trekkerB]) {
      const rows = await asSuperuser(db, async (tx) => {
        await signIn(tx, ids.user.trekkerA)
        await tx.exec(`set local role authenticated`)
        await tx.exec(asClaims(sub))
        return readEvents(tx)
      })
      expect(rows, `${sub} could read login_events`).toEqual([])
    }

    // No SELECT grant for anon at all, so this is the grant refusing, not RLS
    // filtering — the same posture as platform_admins.
    await expect(
      asSuperuser(db, async (tx) => {
        await signIn(tx, ids.user.trekkerA)
        await tx.exec(`set local role anon`)
        return readEvents(tx)
      }),
    ).rejects.toThrow(/permission denied/i)
  })

  it('no client role can insert, update or delete', async () => {
    await expect(
      asUser(db, ids.user.platformAdmin, (tx) =>
        tx.query(`insert into public.login_events (user_id, email) values ($1, 'x@example.test')`, [
          ids.user.platformAdmin,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      asUser(db, ids.user.platformAdmin, (tx) =>
        tx.query(`update public.login_events set email = 'x@example.test'`),
      ),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      asUser(db, ids.user.platformAdmin, (tx) => tx.query(`delete from public.login_events`)),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      asAnon(db, (tx) =>
        tx.query(`insert into public.login_events (user_id, email) values ($1, 'x@example.test')`, [
          ids.user.trekkerA,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('a broken trigger never blocks the sign-in, the sign-out or the amr claim', async () => {
    // The one invariant that matters more than the log: an exception inside
    // record_login_event() or record_login_method() would roll back GoTrue's
    // statement and turn every sign-in (or sign-out) into an error. Break the
    // table out from under both and prove all three statements still land.
    const { sessions, claims } = await asSuperuser(db, async (tx) => {
      await signIn(tx, ids.user.trekkerA)
      await tx.exec(`alter table public.login_events rename to login_events_gone`)
      await signIn(tx, ids.user.trekkerA, SESSION_2)
      await claim(tx, SESSION_2, 'password')
      await tx.query(`delete from auth.sessions where id = $1`, [SESSION])
      return {
        sessions: (await tx.query(`select id from auth.sessions order by id`)).rows,
        claims: (await tx.query(`select session_id from auth.mfa_amr_claims`)).rows,
      }
    })
    expect(sessions).toEqual([{ id: SESSION_2 }])
    expect(claims).toEqual([{ session_id: SESSION_2 }])
  })

  it('a session DELETE stamps ended_at on that row only', async () => {
    const rows = await asSuperuser(db, async (tx) => {
      await signIn(tx, ids.user.trekkerA)
      await signIn(tx, ids.user.trekkerA, SESSION_2)
      await tx.query(`delete from auth.sessions where id = $1`, [SESSION])
      return (
        await tx.query<{ session_id: string; ended: boolean }>(
          `select session_id, ended_at is not null as ended from public.login_events order by id`,
        )
      ).rows
    })
    expect(rows).toEqual([
      { session_id: SESSION, ended: true },
      { session_id: SESSION_2, ended: false },
    ])
  })

  it('the amr claim sets method once; a later claim on the same session does not overwrite it', async () => {
    const { before, afterFirst, afterSecond } = await asSuperuser(db, async (tx) => {
      await signIn(tx, ids.user.trekkerA)
      const before = await readMethod(tx, SESSION)
      await claim(tx, SESSION, 'password')
      const afterFirst = await readMethod(tx, SESSION)
      await claim(tx, SESSION, 'otp')
      const afterSecond = await readMethod(tx, SESSION)
      return { before, afterFirst, afterSecond }
    })
    expect(before).toBeNull()
    expect(afterFirst).toBe('password')
    expect(afterSecond).toBe('password')
  })

  it('the session INSERT picks up a claim that already exists', async () => {
    // GoTrue writes the claim after the session, so this ordering cannot
    // happen today (the FK forbids it). The fallback exists in case that ever
    // changes; drop the FK for the duration of this rolled-back transaction.
    const method = await asSuperuser(db, async (tx) => {
      await tx.exec(`alter table auth.mfa_amr_claims drop constraint mfa_amr_claims_session_id_fkey`)
      await claim(tx, SESSION, 'otp')
      await signIn(tx, ids.user.trekkerA)
      return readMethod(tx, SESSION)
    })
    expect(method).toBe('otp')
  })

  it('account_type is a snapshot: platform admin > company owner > company staff > trekker', async () => {
    const cases: [string, string][] = [
      [ids.user.platformAdmin, 'platform_admin'],
      [ids.user.ownerApproved, 'company_owner'],
      [ids.user.staffApproved, 'company_staff'],
      [ids.user.trekkerA, 'trekker'],
    ]
    for (const [userId, expected] of cases) {
      const type = await asSuperuser(db, async (tx) => {
        await signIn(tx, userId)
        return (
          await tx.query<{ account_type: string }>(
            `select account_type from public.login_events where session_id = $1`,
            [SESSION],
          )
        ).rows[0].account_type
      })
      expect(type, userId).toBe(expected)
    }
  })

  describe('is_new_device', () => {
    const flagged = async (
      priorSignIns: { ip?: string; ua?: string }[],
      next: { ip?: string; ua?: string },
    ) =>
      asSuperuser(db, async (tx) => {
        let n = 0
        for (const prior of priorSignIns) {
          await signIn(tx, ids.user.trekkerA, `00000000-0000-4000-8000-0000000ae00${n++}`, prior)
        }
        await signIn(tx, ids.user.trekkerA, SESSION, next)
        return (
          await tx.query<{ is_new_device: boolean }>(
            `select is_new_device from public.login_events where session_id = $1`,
            [SESSION],
          )
        ).rows[0].is_new_device
      })

    it('the first sign-in is a new device', async () => {
      expect(await flagged([], {})).toBe(true)
    })

    it('same ip + same browser is not', async () => {
      expect(await flagged([{}], {})).toBe(false)
    })

    it('same ip + new browser is not', async () => {
      expect(await flagged([{}], { ua: UA_FIREFOX })).toBe(false)
    })

    it('new ip + same browser is not', async () => {
      expect(await flagged([{}], { ip: '198.51.100.9' })).toBe(false)
    })

    it('new ip + new browser is', async () => {
      expect(await flagged([{}], { ip: '198.51.100.9', ua: UA_FIREFOX })).toBe(true)
    })

    it('a Chrome version bump alone does not count as a new browser', async () => {
      expect(await flagged([{}], { ip: '198.51.100.9', ua: UA_NEXT_CHROME })).toBe(false)
    })

    it("another user's history does not count", async () => {
      const flag = await asSuperuser(db, async (tx) => {
        await signIn(tx, ids.user.trekkerB, SESSION_2)
        await signIn(tx, ids.user.trekkerA, SESSION)
        return (
          await tx.query<{ is_new_device: boolean }>(
            `select is_new_device from public.login_events where session_id = $1`,
            [SESSION],
          )
        ).rows[0].is_new_device
      })
      expect(flag).toBe(true)
    })
  })

  it('the new columns are as unreadable as the old ones', async () => {
    const readNew = async (tx: Actor) =>
      (
        await tx.query(
          `select ended_at, method, account_type, is_new_device from public.login_events`,
        )
      ).rows

    for (const sub of [ids.user.trekkerA, ids.user.trekkerB]) {
      const rows = await asSuperuser(db, async (tx) => {
        await signIn(tx, ids.user.trekkerA)
        await claim(tx, SESSION, 'password')
        await tx.exec(`set local role authenticated`)
        await tx.exec(
          `set local request.jwt.claims = '${JSON.stringify({ sub, role: 'authenticated' })}'`,
        )
        return readNew(tx)
      })
      expect(rows, `${sub} could read login_events`).toEqual([])
    }

    await expect(
      asSuperuser(db, async (tx) => {
        await signIn(tx, ids.user.trekkerA)
        await tx.exec(`set local role anon`)
        return readNew(tx)
      }),
    ).rejects.toThrow(/permission denied/i)
  })

  it('the admin cannot end a session or rewrite its method from the client', async () => {
    await expect(
      asUser(db, ids.user.platformAdmin, (tx) =>
        tx.query(`update public.login_events set ended_at = now()`),
      ),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      asUser(db, ids.user.platformAdmin, (tx) =>
        tx.query(`update public.login_events set method = 'password'`),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('no client role can execute either trigger function', async () => {
    const { rows } = await db.query<{ fn: string; role: string; ok: boolean }>(`
      select p.proname as fn, r.role, has_function_privilege(r.role, p.oid, 'EXECUTE') as ok
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join (values ('anon'), ('authenticated')) as r(role)
       where n.nspname = 'public'
         and p.proname in ('record_login_event', 'record_login_method')
       order by 1, 2
    `)
    expect(rows).toHaveLength(4)
    for (const r of rows) expect(r.ok, `${r.role} can execute ${r.fn}`).toBe(false)
  })
})
