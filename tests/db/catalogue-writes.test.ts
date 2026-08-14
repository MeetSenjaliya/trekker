import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, asUser, getDb, ids } from './harness'

/**
 * Who may write the catalogue, and to whose tenant.
 *
 * The read side is covered in tenant-boundaries.test.ts. This is the write
 * side: cross-tenant writes, the approved-only publishing tier, and the
 * self-escalation paths (account_type, batch deletion under live bookings).
 */
describe('catalogue and profile writes', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  describe('treks', () => {
    it('lets an approved company create a trek for itself', async () => {
      const created = await asUser(db, ids.user.ownerApproved, async (tx) => {
        await tx.query(
          `insert into public.treks (title, difficulty, company_id) values ('New Route','Easy',$1)`,
          [ids.company.approved],
        )
        return (await tx.query(`select id from public.treks where title = 'New Route'`)).rows
      })
      expect(created).toHaveLength(1)
    })

    it('supports insert … returning, which createTrek() depends on', async () => {
      // The regression guard for the createTrek bug (FEATURES.md §1.7).
      //
      // `insert … returning` applies the SELECT policy to the new row, and
      // "view treks" cannot satisfy it: is_trek_visible is STABLE and reads
      // public.treks, so it evaluates against the statement's pre-insert
      // snapshot and cannot see the row being created. src/lib/company.ts does
      // `.insert({...}).select('id').single()`, which PostgREST compiles to
      // exactly that — so this failed for everyone, platform admins included.
      //
      // Fixed by the second, `to authenticated` SELECT policy "company members
      // view own treks", whose predicate reads company_members/companies and
      // never treks. If someone removes it, this test is what fails.
      const rows = await asUser(db, ids.user.ownerApproved, async (tx) =>
        (await tx.query(
          `insert into public.treks (title, difficulty, company_id) values ('Via RETURNING','Easy',$1) returning id`,
          [ids.company.approved],
        )).rows,
      )
      expect(rows).toHaveLength(1)
    })

    it('did not open trek reads to anonymous visitors while fixing that', async () => {
      // The fix's blast radius. The tempting version — folding the arm into
      // "view treks" as an `or` — would have made every anonymous /explore read
      // raise `permission denied for function is_approved_company_member`,
      // because that policy is `to public` and the function is revoked from
      // anon. Scoping the new policy `to authenticated` means anon never
      // evaluates it. This asserts anon still sees exactly the public catalogue.
      const titles = await asAnon(db, async (tx) =>
        (await tx.query<{ title: string }>(`select title from public.treks order by title`)).rows.map(
          (r) => r.title,
        ),
      )
      expect(titles).toEqual(['Ridge Walk'])
    })

    it('did not let a company see another tenant’s hidden treks', async () => {
      // The other direction: the new policy keys on company_id, so it must not
      // widen anything cross-tenant. Pending Co sees its own unapproved trek
      // (via is_trek_visible's member arm) and the public catalogue, but
      // nothing of Summit Co's beyond what anon already gets.
      const titles = await asUser(db, ids.user.ownerPending, async (tx) =>
        (await tx.query<{ title: string }>(`select title from public.treks order by title`)).rows.map(
          (r) => r.title,
        ),
      )
      expect(titles).toEqual(['Ridge Walk', 'Unlisted Climb'])
    })

    it("refuses a trek created into another company's tenant", async () => {
      // The cross-tenant write. company_id is client-supplied, so the with_check
      // is the only thing stopping Summit Co from publishing under Pending Co.
      await expect(
        asUser(db, ids.user.ownerApproved, (tx) =>
          tx.query(
            `insert into public.treks (title, difficulty, company_id) values ('Squatting','Easy',$1)`,
            [ids.company.pending],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('refuses a trek from a pending company (publishing tier)', async () => {
      // pending companies may set up a storefront but may not sell. The tier is
      // is_approved_company_member(), not is_company_member().
      await expect(
        asUser(db, ids.user.ownerPending, (tx) =>
          tx.query(
            `insert into public.treks (title, difficulty, company_id) values ('Too Early','Easy',$1)`,
            [ids.company.pending],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('refuses a trek from a suspended company', async () => {
      await expect(
        asUser(db, ids.user.ownerSuspended, (tx) =>
          tx.query(
            `insert into public.treks (title, difficulty, company_id) values ('Frozen','Easy',$1)`,
            [ids.company.suspended],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('refuses a trek from a plain trekker', async () => {
      await expect(
        asUser(db, ids.user.trekkerB, (tx) =>
          tx.query(
            `insert into public.treks (title, difficulty, company_id) values ('Mine Now','Easy',$1)`,
            [ids.company.approved],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it("cannot edit another company's trek", async () => {
      const updated = await asUser(db, ids.user.ownerPending, async (tx) =>
        (await tx.query(`update public.treks set title = 'defaced' where id = $1 returning id`, [
          ids.trek.approvedActive,
        ])).rows,
      )
      expect(updated).toEqual([])
    })

    it('cannot move a trek into another company by rewriting company_id', async () => {
      // using() lets the owner reach the row; with_check must independently
      // reject the NEW company_id. A policy with only a using() clause would
      // let Summit Co hand its trek to Pending Co — or steal one.
      await expect(
        asUser(db, ids.user.ownerApproved, (tx) =>
          tx.query(`update public.treks set company_id = $1 where id = $2`, [
            ids.company.pending,
            ids.trek.approvedActive,
          ]),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('has no delete policy at all — treks archive, never vanish', async () => {
      const deleted = await asUser(db, ids.user.ownerApproved, async (tx) =>
        (await tx.query(`delete from public.treks where id = $1 returning id`, [
          ids.trek.approvedActive,
        ])).rows,
      )
      expect(deleted).toEqual([])
    })
  })

  describe('trek_batches', () => {
    it('lets an approved company add a departure to its own trek', async () => {
      const rows = await asUser(db, ids.user.ownerApproved, async (tx) =>
        (await tx.query(
          `insert into public.trek_batches (trek_id, batch_date) values ($1, current_date + 90) returning id`,
          [ids.trek.approvedActive],
        )).rows,
      )
      expect(rows).toHaveLength(1)
    })

    it("refuses a departure on another company's trek", async () => {
      await expect(
        asUser(db, ids.user.ownerPending, (tx) =>
          tx.query(`insert into public.trek_batches (trek_id, batch_date) values ($1, current_date + 90)`, [
            ids.trek.approvedActive,
          ]),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('refuses to delete a batch that has bookings', async () => {
      // batch_has_participants() is SECURITY DEFINER for a specific reason: an
      // inline `not exists (select ... from trek_participants)` would run under
      // the own-row-only SELECT policy and so only test whether the CALLER had
      // booked. An owner who never booked would see zero rows and delete a batch
      // full of other people's bookings. This asserts the definer version holds.
      const deleted = await asUser(db, ids.user.ownerApproved, async (tx) =>
        (await tx.query(`delete from public.trek_batches where id = $1 returning id`, [
          ids.batch.approvedActive,
        ])).rows,
      )
      expect(deleted).toEqual([])
    })

    it('allows deleting a batch with no bookings and no chat', async () => {
      // The positive case, so the test above is proven to be detecting the
      // participant check rather than a blanket delete denial.
      const deleted = await asUser(db, ids.user.ownerApproved, async (tx) => {
        const ins = await tx.query<{ id: string }>(
          `insert into public.trek_batches (trek_id, batch_date) values ($1, current_date + 120) returning id`,
          [ids.trek.approvedActive],
        )
        return (await tx.query(`delete from public.trek_batches where id = $1 returning id`, [
          ins.rows[0].id,
        ])).rows
      })
      expect(deleted).toHaveLength(1)
    })
  })

  describe('profiles', () => {
    it('lets a user read and update only their own profile', async () => {
      const rows = await asUser(db, ids.user.trekkerB, async (tx) =>
        (await tx.query<{ id: string }>(`select id from public.profiles`)).rows,
      )
      expect(rows.map((r) => r.id)).toEqual([ids.user.trekkerB])
    })

    it("cannot update another user's profile", async () => {
      const updated = await asUser(db, ids.user.trekkerB, async (tx) =>
        (await tx.query(`update public.profiles set full_name = 'changed' where id = $1 returning id`, [
          ids.user.trekkerA,
        ])).rows,
      )
      expect(updated).toEqual([])
    })

    it('silently refuses to demote a company account to trekker', async () => {
      // A company account that could set account_type='trekker' with a one-line
      // PATCH would walk past every trekker-only rule. Like the company slug,
      // the trigger REWRITES rather than rejects, so the assertion re-reads.
      const type = await asUser(db, ids.user.ownerApproved, async (tx) => {
        await tx.query(`update public.profiles set account_type = 'trekker' where id = $1`, [
          ids.user.ownerApproved,
        ])
        const r = await tx.query<{ account_type: string }>(
          `select account_type from public.profiles where id = $1`,
          [ids.user.ownerApproved],
        )
        return r.rows[0].account_type
      })
      expect(type).toBe('company')
    })

    it('lets the same user change unpinned profile fields', async () => {
      const name = await asUser(db, ids.user.ownerApproved, async (tx) => {
        await tx.query(`update public.profiles set full_name = 'Renamed' where id = $1`, [
          ids.user.ownerApproved,
        ])
        const r = await tx.query<{ full_name: string }>(
          `select full_name from public.profiles where id = $1`,
          [ids.user.ownerApproved],
        )
        return r.rows[0].full_name
      })
      expect(name).toBe('Renamed')
    })

    it('shows anonymous visitors no profiles at all', async () => {
      const rows = await asAnon(db, async (tx) =>
        (await tx.query(`select id from public.profiles`)).rows,
      )
      expect(rows).toEqual([])
    })
  })

  describe('bookings and favourites', () => {
    it('refuses a booking inserted directly for another user', async () => {
      await expect(
        asUser(db, ids.user.trekkerB, (tx) =>
          tx.query(`insert into public.trek_participants (user_id, batch_id) values ($1, $2)`, [
            ids.user.trekkerA,
            ids.batch.approvedActive,
          ]),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it('refuses a booking from a company account', async () => {
      // is_trekker() in the with_check. The real guard is join_trek_and_chat(),
      // but the policy is the backstop for a direct PostgREST insert.
      await expect(
        asUser(db, ids.user.ownerApproved, (tx) =>
          tx.query(`insert into public.trek_participants (user_id, batch_id) values ($1, $2)`, [
            ids.user.ownerApproved,
            ids.batch.approvedActive,
          ]),
        ),
      ).rejects.toThrow(/row-level security/i)
    })

    it("cannot cancel another user's booking", async () => {
      const deleted = await asUser(db, ids.user.trekkerB, async (tx) =>
        (await tx.query(`delete from public.trek_participants where user_id = $1 returning id`, [
          ids.user.trekkerA,
        ])).rows,
      )
      expect(deleted).toEqual([])
    })

    it("cannot read or write another user's favourites", async () => {
      await asUser(db, ids.user.trekkerA, (tx) =>
        tx.query(`insert into public.favorites (user_id, trek_id) values ($1, $2)`, [
          ids.user.trekkerA,
          ids.trek.approvedActive,
        ]),
      )
      const seen = await asUser(db, ids.user.trekkerB, async (tx) =>
        (await tx.query(`select user_id from public.favorites`)).rows,
      )
      expect(seen).toEqual([])

      await expect(
        asUser(db, ids.user.trekkerB, (tx) =>
          tx.query(`insert into public.favorites (user_id, trek_id) values ($1, $2)`, [
            ids.user.trekkerA,
            ids.trek.approvedActive,
          ]),
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  describe('company_invites', () => {
    it('is not directly writable by a company admin', async () => {
      // Invites are created only through invite_company_member(). A direct
      // insert would let a company mint an invite for an arbitrary email
      // without the RPC's checks.
      await expect(
        asUser(db, ids.user.ownerApproved, (tx) =>
          tx.query(
            `insert into public.company_invites (company_id, email, invited_by) values ($1,'x@example.test',$2)`,
            [ids.company.approved, ids.user.ownerApproved],
          ),
        ),
      ).rejects.toThrow(/permission denied/i)
    })

    it("hides one company's invites from another company", async () => {
      const seen = await asUser(db, ids.user.ownerPending, async (tx) =>
        (await tx.query(`select id from public.company_invites`)).rows,
      )
      expect(seen).toEqual([])
    })
  })
})
