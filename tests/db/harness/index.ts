import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from './load'
import { seed } from './fixtures'

export { asAnon, asSuperuser, asUser } from './actor'
export type { Actor } from './actor'
export { ids } from './fixtures'

let booting: Promise<PGlite> | undefined

/**
 * A booted, seeded database, built once per test file. Vitest gives each file
 * its own worker, so this memo is per-file: files stay isolated from each other
 * and tests within a file share one ~1.5s boot instead of paying it each.
 *
 * Sharing is safe because asUser/asAnon roll back everything they do.
 */
export function getDb(): Promise<PGlite> {
  if (!booting) {
    booting = createTestDb().then(async (db) => {
      await seed(db)
      return db
    })
  }
  return booting
}
