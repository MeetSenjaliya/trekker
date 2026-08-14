import type { PGlite, Transaction } from '@electric-sql/pglite'

/**
 * The connection a test sees inside asUser/asAnon. It is a transaction, not the
 * raw db, and that is deliberate — see asUser().
 */
export type Actor = Transaction

/**
 * Run `fn` with the database believing it is serving a request from `userId`.
 *
 * Two things together make this faithful rather than approximate:
 *
 *  1. `set local role authenticated` — PGlite connects as a superuser, and
 *     superusers bypass RLS unconditionally. Without this every policy test
 *     would pass while proving nothing.
 *  2. `set local request.jwt.claims` — this is the exact GUC PostgREST sets
 *     from a verified JWT, and shim.sql defines auth.uid() to read it exactly
 *     as Supabase does. A policy cannot distinguish this from a real request.
 *
 * Everything runs in a transaction that is ALWAYS rolled back. Tests therefore
 * cannot leak state into each other and can be read in any order. The cost is
 * that a write made in one asUser() call is not visible in the next — if a test
 * needs write-then-read, do both inside the same callback.
 *
 * A denied INSERT/UPDATE raises rather than returning empty, so assert those
 * with `await expect(asUser(...)).rejects.toThrow(...)`. A denied SELECT does
 * not raise: RLS filters rows, so the assertion is on an empty result.
 */
export async function asUser<T>(
  db: PGlite,
  userId: string,
  fn: (tx: Actor) => Promise<T>,
): Promise<T> {
  return runRolledBack(db, async (tx) => {
    await tx.exec(`set local role authenticated`)
    await tx.exec(
      `set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`,
    )
    return fn(tx)
  })
}

/**
 * Run `fn` as a signed-out visitor: the `anon` role with no JWT claims, so
 * auth.uid() is null. This is what a scraper hitting the REST endpoint with
 * only the publishable key gets.
 */
export async function asAnon<T>(db: PGlite, fn: (tx: Actor) => Promise<T>): Promise<T> {
  return runRolledBack(db, async (tx) => {
    await tx.exec(`set local role anon`)
    return fn(tx)
  })
}

/**
 * Run `fn` with no role change: superuser, RLS bypassed. Seeding only. Never
 * use this to make an assertion about access — it can read everything by
 * definition, so it can only ever tell you the row exists.
 */
export async function asSuperuser<T>(db: PGlite, fn: (tx: Actor) => Promise<T>): Promise<T> {
  return runRolledBack(db, fn)
}

async function runRolledBack<T>(db: PGlite, fn: (tx: Actor) => Promise<T>): Promise<T> {
  let result!: T
  let captured: unknown

  await db.transaction(async (tx) => {
    try {
      result = await fn(tx)
    } catch (e) {
      captured = e
    }
    // Unconditional, including on success: the point is that no test can
    // change what the next test sees.
    await tx.rollback()
  })

  if (captured !== undefined) throw captured
  return result
}
