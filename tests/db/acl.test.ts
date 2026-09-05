import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asSuperuser, asUser, getDb, ids } from './harness'

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
      // The four rate-limit triggers joined this list in 0016: their revokes
      // named only public and anon, so authenticated kept a grant on a
      // `returns trigger` function it could never actually call.
      'enforce_join_rate_limit',
      'enforce_message_rate_limit',
      'enforce_storage_rate_limit',
      'enforce_trek_email_rate_limit',
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
    // Defended two ways since 0003: no client grant (below) AND RLS enabled with
    // deliberately ZERO policies. Either alone denies everyone; both together
    // mean disabling RLS does not silently open the admin allowlist. An advisor
    // INFO flags rls_enabled_no_policy; that is the design. Adding a policy to
    // silence the lint would create the client-reachable "make me an admin" path
    // that must not exist.
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['SELECT', 'INSERT']) {
        const r = await db.query<{ ok: boolean }>(
          `select has_table_privilege($1, 'public.platform_admins', $2) as ok`,
          [role, priv],
        )
        expect(r.rows[0].ok, `${role} can ${priv} platform_admins directly`).toBe(false)
      }
    }

    const { rows } = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from pg_policies where tablename = 'platform_admins'`,
    )
    expect(rows[0].cnt, 'platform_admins gained a policy').toBe(0)

    // The table is seeded with a real admin row (confirmed as superuser), so the
    // client-side refusals below are the lockdown working, not an empty table.
    const seed = await asSuperuser(db, (tx) =>
      tx.query(`select user_id from public.platform_admins`),
    )
    expect(seed.rows.length, 'platform_admins should be seeded with an admin').toBeGreaterThan(0)

    // A client read no longer leaks an empty array (the old 200 `[]` oracle) — it
    // is refused outright, because the SELECT grant is gone. This holds even for
    // the seeded platform admin: the /admin flow asks is_platform_admin() (a
    // SECURITY DEFINER function), never a direct select on this table.
    await expect(
      asUser(db, ids.user.trekkerB, (tx) =>
        tx.query(`select user_id from public.platform_admins`),
      ),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      asUser(db, ids.user.platformAdmin, (tx) =>
        tx.query(`select user_id from public.platform_admins`),
      ),
    ).rejects.toThrow(/permission denied/i)

    // With the grant revoked (0003), the privilege check now fails before RLS is
    // even consulted, so the block surfaces as "permission denied" rather than a
    // row-level-security violation. Either way the self-promotion is refused.
    await expect(
      asUser(db, ids.user.trekkerB, (tx) =>
        tx.query(`insert into public.platform_admins (user_id) values ($1)`, [ids.user.trekkerB]),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i)
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
