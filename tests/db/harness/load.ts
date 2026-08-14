import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '..', '..', '..')
const SHIM = join(HERE, 'shim.sql')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')

// Extensions the platform provides and PGlite does not ship. Nothing in the
// migrations calls a pgcrypto or uuid-ossp function (gen_random_uuid() is core
// Postgres since 13); pg_net and pg_cron are stood up as plain schemas in
// shim.sql instead. Verified by grep — re-check if a migration adds an extension.
const SHIMMED_EXTENSIONS = /^[ \t]*create extension[^;]*;/gim

/**
 * Split on semicolons that are not inside a string, a dollar-quoted body, or a
 * comment. Postgres itself would happily take the whole file in one exec(), but
 * then a failure anywhere reports only its own message with no location, and
 * this file is 3k lines. Splitting buys "statement #N, starting `create policy
 * ...`" in the error.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let buf = ''
  let i = 0
  let dollarTag: string | null = null
  let inSingle = false
  let inLineComment = false
  let inBlockComment = 0

  while (i < sql.length) {
    const ch = sql[i]
    const rest = sql.slice(i)

    if (inLineComment) {
      buf += ch
      if (ch === '\n') inLineComment = false
      i++
      continue
    }
    if (inBlockComment > 0) {
      if (rest.startsWith('/*')) { inBlockComment++; buf += '/*'; i += 2; continue }
      if (rest.startsWith('*/')) { inBlockComment--; buf += '*/'; i += 2; continue }
      buf += ch; i++; continue
    }
    if (dollarTag) {
      if (rest.startsWith(dollarTag)) { buf += dollarTag; i += dollarTag.length; dollarTag = null; continue }
      buf += ch; i++; continue
    }
    if (inSingle) {
      if (ch === "'" && sql[i + 1] === "'") { buf += "''"; i += 2; continue }
      if (ch === "'") { inSingle = false }
      buf += ch; i++; continue
    }

    if (rest.startsWith('--')) { inLineComment = true; buf += '--'; i += 2; continue }
    if (rest.startsWith('/*')) { inBlockComment = 1; buf += '/*'; i += 2; continue }
    if (ch === "'") { inSingle = true; buf += ch; i++; continue }

    const dollar = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(rest)
    if (dollar) { dollarTag = dollar[0]; buf += dollarTag; i += dollarTag.length; continue }

    if (ch === ';') { out.push(buf); buf = ''; i++; continue }
    buf += ch; i++
  }
  if (buf.trim()) out.push(buf)

  return out.map((s) => s.trim()).filter((s) => s.length > 0 && !/^(--|\/\*)/.test(stripComments(s)))
}

function stripComments(s: string): string {
  return s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()
}

function firstLine(sql: string): string {
  const meaningful = stripComments(sql).replace(/\s+/g, ' ').trim()
  return meaningful.length > 110 ? meaningful.slice(0, 110) + '…' : meaningful
}

async function run(db: PGlite, sql: string, label: string) {
  const statements = splitStatements(sql)
  for (let n = 0; n < statements.length; n++) {
    try {
      await db.exec(statements[n])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`${label}: statement ${n + 1}/${statements.length} failed\n  ${firstLine(statements[n])}\n  → ${msg}`)
    }
  }
}

/**
 * Boot an in-process Postgres carrying the real schema.
 *
 * Migrations are replayed in version order, not loaded from the generated
 * `schema.sql` — so every boot of this suite is also a proof that the
 * migrations rebuild a database from nothing. A migration that only works
 * against the author's already-populated database fails here.
 *
 * IMPORTANT — what this does and does not prove. The migrations are what we
 * intend production to be; the live database is still the source of truth,
 * because changes are pasted into the SQL Editor by hand. A green suite proves
 * the policies as committed are sound. It does not prove production matches
 * them — `supabase_migrations.schema_migrations` is what you read to check
 * that, and CLAUDE.md's rule is what keeps the two converging.
 */
export async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create()
  await run(db, readFileSync(SHIM, 'utf8'), 'shim.sql')

  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  if (files.length === 0) throw new Error(`no migrations found in ${MIGRATIONS}`)

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(
      SHIMMED_EXTENSIONS,
      (m) => `-- [shimmed by tests] ${m.replace(/\s+/g, ' ')}`,
    )
    await run(db, sql, file)
  }

  return db
}
