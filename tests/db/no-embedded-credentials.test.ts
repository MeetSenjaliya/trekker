import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { getDb } from './harness'

/**
 * Key material in DDL, not policies.
 *
 * `notify_trek_participation()` used to carry the project's publishable key as
 * a literal in its body, with a comment asking whoever rotates the key to come
 * back and edit the function. Nothing enforced that, and the trigger swallows
 * every error — so a rotation would have stopped join/leave emails silently
 * (0008). A comment is not a control; this file is.
 *
 * The rule is "no credential-shaped literal in any function body", broader than
 * the one key that prompted it, because the failure is generic: a key pasted
 * into DDL outlives its own rotation and is invisible to every other check
 * here, none of which read `prosrc`.
 *
 * If this fails on a function you just wrote: read the value from Vault at call
 * time (`vault.decrypted_secrets`, as this function does for the webhook
 * secret) rather than embedding it.
 */
describe('no function body embeds credential material', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  // Supabase publishable/secret keys (`sb_publishable_…`, `sb_secret_…`) and
  // anything JWT-shaped, which is what the legacy anon/service_role keys were.
  const CREDENTIAL_PATTERN = 'sb_(publishable|secret)_[A-Za-z0-9_-]{8}|eyJ[A-Za-z0-9_-]{10}'

  it('no public function contains a Supabase key or a JWT literal', async () => {
    const { rows } = await db.query<{ proname: string; hit: string }>(
      `
      select p.proname,
             (regexp_match(p.prosrc, $1))[0] as hit
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosrc ~ $1
       order by p.proname
    `,
      [CREDENTIAL_PATTERN],
    )

    expect(rows.map((r) => `${r.proname}: ${r.hit}`)).toEqual([])
  })

  it('the notification trigger still sends the Vault secret and no apikey', async () => {
    // The positive half: 0008 removed the apikey header, so a future edit that
    // re-adds one (or drops the header the edge functions actually authorize
    // on) is caught here rather than by the emails quietly stopping.
    const { rows } = await db.query<{ prosrc: string }>(`
      select prosrc from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'notify_trek_participation'
    `)

    expect(rows).toHaveLength(1)
    expect(rows[0].prosrc).toContain('x-trek-webhook-secret')
    expect(rows[0].prosrc).not.toContain("'apikey'")
  })
})
