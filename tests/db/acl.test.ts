import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asUser, getDb, ids } from './harness'

/**
 * Grants, not policies.
 *
 * RLS is only half the security model. A SECURITY DEFINER function runs as its
 * owner and bypasses RLS entirely, so for those the EXECUTE grant is the outer
 * perimeter — and Postgres's default is to grant EXECUTE to PUBLIC. `create or
 * replace` preserves the ACL, so a definer RPC that was ever created without an
 * explicit revoke stays anon-callable forever, silently, with no policy visible
 * anywhere to suggest otherwise.
 *
 * That is a failure mode you cannot see by reading policies, which is why it
 * gets its own file. This suite's first run found 20 functions in this state.
 */
describe('EXECUTE grants on SECURITY DEFINER functions', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  /**
   * The three that MUST keep anon EXECUTE. They are called from PUBLIC-role
   * SELECT policies on treks / trek_batches / companies, and RLS quals evaluate
   * as the querying role — so every anonymous page view on /explore,
   * /trek/[id] and /company/[slug] executes them. Revoking these is a
   * production outage, not a hardening win. See FEATURES.md Known Gotchas.
   */
  const ANON_EXECUTABLE_BY_DESIGN = ['is_company_member', 'is_platform_admin', 'is_trek_visible']

  it('no SECURITY DEFINER function is anon-executable except the load-bearing trio', async () => {
    const { rows } = await db.query<{ proname: string }>(`
      select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosecdef
         and has_function_privilege('anon', p.oid, 'EXECUTE')
       order by p.proname
    `)
    expect(rows.map((r) => r.proname)).toEqual(ANON_EXECUTABLE_BY_DESIGN)
  })

  it('the load-bearing trio really is still anon-executable', async () => {
    // The inverse guard. Without it, someone "fixing" the advisor warnings to
    // zero would make the test above pass and take the public site down.
    for (const fn of ANON_EXECUTABLE_BY_DESIGN) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_function_privilege('anon', ('public.' || $1 || '(uuid)')::text, 'EXECUTE') as ok`,
        [fn],
      ).catch(async () =>
        db.query<{ ok: boolean }>(
          `select has_function_privilege('anon', ('public.' || $1 || '()')::text, 'EXECUTE') as ok`,
          [fn],
        ),
      )
      expect(rows[0].ok, `${fn} lost its anon EXECUTE grant`).toBe(true)
    }
  })

  it('every definer RPC revoked from anon still reaches authenticated', async () => {
    // A revoke that overshoots is an outage that looks like a security win in
    // the advisor output: strip authenticated along with anon and the
    // dashboard, admin panel and chat break. This catches that direction.
    const { rows } = await db.query<{ proname: string }>(`
      select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosecdef
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
       order by p.proname
    `)
    // Trigger functions and system-internal helpers legitimately reach nobody:
    // Postgres checks EXECUTE at CREATE TRIGGER time, not at fire time.
    expect(rows.map((r) => r.proname)).toEqual([
      'award_user_achievements',
      'handle_new_user',
      'notify_trek_participation',
      'promote_waitlist_on_leave',
      'protect_company_admin_fields',
      'protect_profile_account_type',
      'recompute_user_stats',
      'trg_recompute_user_stats',
      'update_participants_count',
    ])
  })

  it('platform_admins is unreachable by clients', async () => {
    // The table grants are wide open here — RLS enabled with deliberately ZERO
    // policies is what denies everyone, so this asserts behaviour rather than
    // privileges. An advisor INFO flags it as rls_enabled_no_policy; that is
    // the design. Adding a policy to silence the lint would create the
    // client-reachable "make me an admin" path that must not exist.
    const { rows } = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from pg_policies where tablename = 'platform_admins'`,
    )
    expect(rows[0].cnt, 'platform_admins gained a policy').toBe(0)

    // Seeded with a real admin row, so an empty read is the policy working, not
    // an empty table.
    const seen = await asUser(db, ids.user.trekkerB, async (tx) =>
      (await tx.query(`select user_id from public.platform_admins`)).rows,
    )
    expect(seen).toEqual([])

    const asAdminItself = await asUser(db, ids.user.platformAdmin, async (tx) =>
      (await tx.query(`select user_id from public.platform_admins`)).rows,
    )
    expect(asAdminItself, 'even a platform admin cannot read the table').toEqual([])

    await expect(
      asUser(db, ids.user.trekkerB, (tx) =>
        tx.query(`insert into public.platform_admins (user_id) values ($1)`, [ids.user.trekkerB]),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('rate_events is revoked from clients outright', async () => {
    // Unlike platform_admins, this one is defended by grants: no policy, no
    // privilege. Writes happen only inside SECURITY DEFINER rate-limit triggers.
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['SELECT', 'INSERT']) {
        const r = await db.query<{ ok: boolean }>(
          `select has_table_privilege($1, 'public.rate_events', $2) as ok`,
          [role, priv],
        )
        expect(r.rows[0].ok, `${role} can ${priv} rate_events`).toBe(false)
      }
    }
  })

  it('company_invites is read-only to clients and invisible to anon', async () => {
    for (const priv of ['INSERT', 'UPDATE', 'DELETE']) {
      const r = await db.query<{ ok: boolean }>(
        `select has_table_privilege('authenticated', 'public.company_invites', $1) as ok`,
        [priv],
      )
      expect(r.rows[0].ok, `authenticated can ${priv} company_invites directly`).toBe(false)
    }
    const anonRead = await db.query<{ ok: boolean }>(
      `select has_table_privilege('anon', 'public.company_invites', 'SELECT') as ok`,
    )
    expect(anonRead.rows[0].ok).toBe(false)
  })

  it('audit columns on companies are not selectable by clients', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const col of ['created_by', 'approved_by']) {
        const r = await db.query<{ ok: boolean }>(
          `select has_column_privilege($1, 'public.companies', $2, 'SELECT') as ok`,
          [role, col],
        )
        expect(r.rows[0].ok, `${role} can read companies.${col}`).toBe(false)
      }
      // ...while the storefront columns remain readable.
      const r = await db.query<{ ok: boolean }>(
        `select has_column_privilege($1, 'public.companies', 'name', 'SELECT') as ok`,
        [role],
      )
      expect(r.rows[0].ok).toBe(true)
    }
  })
})
