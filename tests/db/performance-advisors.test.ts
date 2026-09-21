import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { getDb } from './harness'

/**
 * The three performance-advisor findings 0025 closed, pinned so a later
 * migration cannot quietly reopen them. Catalog reads only — the behaviour of
 * every rewritten policy is proved by the rest of this suite.
 */
describe('performance advisors (0025)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  it('no policy calls auth.uid()/auth.role()/auth.jwt() per row', async () => {
    // A bare `auth.uid()` is re-evaluated for every candidate row; wrapped as
    // `(select auth.uid())` the planner hoists it into an InitPlan and runs it
    // once. pg_policies renders the wrapped form as `( SELECT auth.uid() …`;
    // strip those and whatever `auth.<fn>()` remains is a bare call.
    const { rows } = await db.query<{ tablename: string; policyname: string }>(`
      select tablename, policyname
        from pg_policies
       where schemaname = 'public'
         and regexp_replace(
               coalesce(qual, '') || ' ' || coalesce(with_check, ''),
               'SELECT auth\\.(uid|role|jwt)\\(\\)', '', 'g'
             ) ~ 'auth\\.(uid|role|jwt)\\(\\)'
       order by 1, 2`)
    expect(rows, 'write (select auth.uid()) in new policies — see 0025').toEqual([])
  })

  it('conversation_participants and favorites have a primary key, and only one unique index', async () => {
    for (const table of ['conversation_participants', 'favorites']) {
      const { rows } = await db.query<{ contype: string; conname: string }>(
        `select contype, conname from pg_constraint
          where conrelid = $1::regclass and contype in ('p', 'u') order by 1`,
        [`public.${table}`],
      )
      expect(rows.map((r) => r.contype), `${table} constraints`).toEqual(['p'])
    }
  })

  it('every foreign key on companies and company_invites has a covering index', async () => {
    const { rows } = await db.query<{ indexname: string }>(`
      select indexname from pg_indexes
       where schemaname = 'public'
         and indexname in ('companies_approved_by_idx', 'company_invites_invited_by_idx')
       order by 1`)
    expect(rows.map((r) => r.indexname)).toEqual([
      'companies_approved_by_idx',
      'company_invites_invited_by_idx',
    ])
  })
})
