#!/usr/bin/env node
/**
 * Rebuild supabase/schema.sql by concatenating supabase/migrations/*.sql in
 * version order.
 *
 * schema.sql used to be hand-edited alongside every SQL Editor change, which
 * meant nothing but discipline kept it honest. It is now an artifact: the
 * migrations are the input, `npm run db:schema` is the build, and
 * `npm run db:check` (also asserted by tests/db/schema-is-generated.test.ts)
 * fails if the two disagree.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')
const SCHEMA = join(ROOT, 'supabase', 'schema.sql')

const NAME = /^(\d{4})_[a-z0-9-]+\.sql$/

export function migrationFiles() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))

  const bad = files.filter((f) => !NAME.test(f))
  if (bad.length) {
    throw new Error(
      `migrations must be named NNNN_kebab-description.sql — rename: ${bad.join(', ')}`,
    )
  }

  files.sort()

  // A duplicated version number means two people (or two branches) claimed the
  // same slot and one of them will silently not be applied.
  const seen = new Map()
  for (const f of files) {
    const version = NAME.exec(f)[1]
    if (seen.has(version)) throw new Error(`duplicate version ${version}: ${seen.get(version)} and ${f}`)
    seen.set(version, f)
  }

  return files
}

export function buildSchema() {
  const files = migrationFiles()
  const head = [
    '-- ============================================================================',
    '-- TREKKER — DATABASE SCHEMA (GENERATED FILE — DO NOT EDIT)',
    '-- ============================================================================',
    '-- Built by scripts/build-schema.mjs from supabase/migrations/*.sql, in order.',
    '-- To change the schema: add the next migration, apply it in the Supabase SQL',
    '-- Editor, then run `npm run db:schema`. Hand edits here are overwritten and',
    '-- `npm test` fails while this file and the migrations disagree.',
    '--',
    '-- Running this whole file top-to-bottom builds an empty project up to the',
    '-- current state. Against a database that already has some of these',
    '-- migrations, run the individual missing ones instead.',
    '--',
    '-- ⚠️ A later migration can supersede an earlier one, so an object may appear',
    '-- here more than once and only the LAST occurrence is live. When looking up',
    '-- the current definition of a policy or function, read the last match, not',
    '-- the first.',
    '--',
    '-- Migrations folded in:',
    ...files.map((f) => `--   ${f}`),
    '-- ============================================================================',
    '',
  ]

  const bodies = files.map((f) => {
    const banner = '-- ' + '#'.repeat(74)
    return [
      '',
      banner,
      `-- # ${f}`,
      banner,
      '',
      readFileSync(join(MIGRATIONS, f), 'utf8').trim(),
      '',
    ].join('\n')
  })

  return head.join('\n') + bodies.join('\n')
}

// Guarded: the test suite imports buildSchema() and must not write the file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const built = buildSchema()

  if (process.argv.includes('--check')) {
    if (readFileSync(SCHEMA, 'utf8') !== built) {
      console.error(
        'supabase/schema.sql is out of date with supabase/migrations/.\n' +
          'Run `npm run db:schema` and commit the result.',
      )
      process.exit(1)
    }
    console.log(`schema.sql is up to date (${migrationFiles().length} migrations).`)
  } else {
    writeFileSync(SCHEMA, built)
    console.log(`Wrote supabase/schema.sql from ${migrationFiles().length} migrations.`)
  }
}
