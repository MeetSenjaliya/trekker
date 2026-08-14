import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs build script, no types
import { buildSchema, migrationFiles } from '../../scripts/build-schema.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

/**
 * `supabase/schema.sql` is generated from `supabase/migrations/`. Without this
 * test the rule is a comment in a header, and comments are exactly what
 * CODE_REVIEW.md §1.3 showed cannot be trusted: someone edits schema.sql
 * directly, the next `npm run db:schema` silently reverts it, and the change
 * is lost with no error anywhere.
 */
describe('supabase/schema.sql', () => {
  it('matches what the migrations generate', () => {
    const built: string = buildSchema()
    const current = readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8')

    expect(
      current === built
        ? 'in sync'
        : 'stale — edit the migration, not schema.sql, then run `npm run db:schema`',
    ).toBe('in sync')
  })

  it('has a migration for every version, in order, with no gaps', () => {
    const versions: number[] = migrationFiles().map((f: string) => Number(f.slice(0, 4)))
    expect(versions).toEqual(versions.map((_: number, i: number) => i + 1))
  })
})
