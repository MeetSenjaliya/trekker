import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, asSuperuser, asUser, getDb, ids } from './harness'

/**
 * The five boundaries that were previously only ever checked by hand.
 *
 * Each block states the threat first, because a security test that only says
 * what it asserts rots into a test that asserts the wrong thing. If one of
 * these fails, read the threat, not the diff.
 */
describe('tenant boundaries', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  // ---- 1 ---------------------------------------------------------------------
  // Threat: a signed-in user enumerates trek_participants and learns who else
  // booked which departure. Enforced by "Users can view own trek participation"
  // (schema.sql §11), which is own-row-only.
  describe("user B cannot read user A's trek_participants", () => {
    it('returns zero rows for another user’s bookings', async () => {
      const rows = await asUser(db, ids.user.trekkerB, async (tx) =>
        (await tx.query(`select id from public.trek_participants where user_id = $1`, [
          ids.user.trekkerA,
        ])).rows,
      )
      expect(rows).toEqual([])
    })

    it('returns zero rows for an unfiltered scrape of the whole table', async () => {
      // The filtered query above passes trivially if the policy is missing but
      // the row does not exist. This is the assertion that actually bites: B
      // asks for everything and must still see only their own (none).
      const rows = await asUser(db, ids.user.trekkerB, async (tx) =>
        (await tx.query(`select id from public.trek_participants`)).rows,
      )
      expect(rows).toEqual([])
    })

    it("still lets user A read A's own bookings", async () => {
      // Guards against the opposite failure: a policy tightened into uselessness
      // would make every negative test above pass.
      const rows = await asUser(db, ids.user.trekkerA, async (tx) =>
        (await tx.query(`select id from public.trek_participants`)).rows,
      )
      expect(rows).toHaveLength(2)
    })

    it('hides bookings from anonymous visitors entirely', async () => {
      const rows = await asAnon(db, async (tx) =>
        (await tx.query(`select id from public.trek_participants`)).rows,
      )
      expect(rows).toEqual([])
    })
  })

  // ---- 2 ---------------------------------------------------------------------
  // Threat: an unapproved company's storefront is reachable before review, or a
  // rejected/suspended one stays reachable after. Enforced by "view companies".
  describe('anonymous visitors see only approved companies', () => {
    it('sees the approved company and nothing else', async () => {
      const slugs = await asAnon(db, async (tx) =>
        (await tx.query<{ slug: string }>(`select slug from public.companies order by slug`)).rows.map(
          (r) => r.slug,
        ),
      )
      expect(slugs).toEqual(['summit-co'])
    })

    it('cannot reach a pending company even by exact id', async () => {
      const rows = await asAnon(db, async (tx) =>
        (await tx.query(`select id from public.companies where id = $1`, [ids.company.pending])).rows,
      )
      expect(rows).toEqual([])
    })

    it('cannot reach rejected or suspended companies', async () => {
      const rows = await asAnon(db, async (tx) =>
        (await tx.query(`select id from public.companies where id = any($1)`, [
          [ids.company.rejected, ids.company.suspended],
        ])).rows,
      )
      expect(rows).toEqual([])
    })

    it('is denied the audit columns even on the approved row', async () => {
      // Column-level grant, not RLS: created_by/approved_by are revoked so an
      // approved storefront cannot be cross-referenced against public_profiles
      // to deanonymize the owner and the admin who approved them.
      await expect(
        asAnon(db, (tx) => tx.query(`select created_by from public.companies`)),
      ).rejects.toThrow(/permission denied/i)
    })

    it("lets a pending company's own owner see it", async () => {
      const rows = await asUser(db, ids.user.ownerPending, async (tx) =>
        (await tx.query(`select id from public.companies where id = $1`, [ids.company.pending])).rows,
      )
      expect(rows).toHaveLength(1)
    })

    it('does not let an unrelated signed-in user see a pending company', async () => {
      const rows = await asUser(db, ids.user.trekkerB, async (tx) =>
        (await tx.query(`select id from public.companies where id = $1`, [ids.company.pending])).rows,
      )
      expect(rows).toEqual([])
    })
  })

  // ---- 3 ---------------------------------------------------------------------
  // Threat: a company is suspended for cause and its treks keep selling.
  // Enforced by search_treks()' `t.is_active and c.status = 'approved'` filter.
  describe("a suspended company's treks vanish from search_treks", () => {
    const titles = async (userId: string | null) => {
      const run = userId
        ? (fn: Parameters<typeof asAnon>[1]) => asUser(db, userId, fn)
        : (fn: Parameters<typeof asAnon>[1]) => asAnon(db, fn)
      return run(async (tx) =>
        (await tx.query<{ title: string }>(`select title from public.search_treks()`)).rows.map(
          (r) => r.title,
        ),
      )
    }

    it('returns only the approved company’s active trek, for anon', async () => {
      expect(await titles(null)).toEqual(['Ridge Walk'])
    })

    it('excludes the frozen trek even from a user who booked it', async () => {
      // The load-bearing case. is_trek_visible() has a participant arm that
      // deliberately keeps trekkerA's own booking readable after the company is
      // frozen, so RLS alone would let 'Taken Down' through here. Only the
      // explicit status filter inside search_treks() removes it. Delete that
      // filter and this is the only test in the suite that fails.
      expect(await titles(ids.user.trekkerA)).toEqual(['Ridge Walk'])
    })

    it("excludes a pending company's treks", async () => {
      expect(await titles(ids.user.trekkerB)).not.toContain('Unlisted Climb')
    })

    it('excludes archived treks of an approved company', async () => {
      expect(await titles(ids.user.trekkerB)).not.toContain('Old Pass')
    })

    it('excludes the frozen trek even from its own company owner', async () => {
      expect(await titles(ids.user.ownerSuspended)).toEqual(['Ridge Walk'])
    })

    it('reports total_count consistently with the rows returned', async () => {
      // A count computed before the status filter would leak the existence of
      // hidden treks through pagination even with the rows withheld.
      const rows = await asAnon(db, async (tx) =>
        (await tx.query<{ total_count: number }>(`select total_count from public.search_treks()`))
          .rows,
      )
      expect(rows).toHaveLength(1)
      expect(Number(rows[0].total_count)).toBe(1)
    })
  })

  // ---- 4 ---------------------------------------------------------------------
  // Threat: a company edits its own slug (hijacking another storefront's URL) or
  // its own status (self-approving, or un-suspending itself). Enforced by the
  // trg_protect_company_admin_fields trigger — NOT by a policy.
  describe('non-admins cannot change protected company columns', () => {
    it('silently ignores a slug change from the owning company admin', async () => {
      // The trigger rewrites new.slug := old.slug, so the UPDATE SUCCEEDS and
      // reports a row. Asserting "the write was rejected" would be wrong here.
      // The only correct assertion re-reads the column.
      const slug = await asUser(db, ids.user.ownerApproved, async (tx) => {
        await tx.query(`update public.companies set slug = 'hijacked' where id = $1`, [
          ids.company.approved,
        ])
        const r = await tx.query<{ slug: string }>(
          `select slug from public.companies where id = $1`,
          [ids.company.approved],
        )
        return r.rows[0].slug
      })
      expect(slug).toBe('summit-co')
    })

    it('does let the owning company admin change unprotected columns', async () => {
      // Proves the previous test is detecting the trigger, not a blanket denial.
      const description = await asUser(db, ids.user.ownerApproved, async (tx) => {
        await tx.query(`update public.companies set description = 'new copy' where id = $1`, [
          ids.company.approved,
        ])
        const r = await tx.query<{ description: string }>(
          `select description from public.companies where id = $1`,
          [ids.company.approved],
        )
        return r.rows[0].description
      })
      expect(description).toBe('new copy')
    })

    it('blocks a non-member from updating the company at all', async () => {
      const updated = await asUser(db, ids.user.trekkerB, async (tx) => {
        const r = await tx.query(
          `update public.companies set slug = 'hijacked', description = 'pwned' where id = $1 returning id`,
          [ids.company.approved],
        )
        return r.rows
      })
      // RLS makes the row invisible to the UPDATE, so it matches nothing rather
      // than raising. Zero affected rows is the pass condition.
      expect(updated).toEqual([])
    })

    it('blocks staff (non-admin) from updating their own company', async () => {
      const updated = await asUser(db, ids.user.staffApproved, async (tx) =>
        (await tx.query(
          `update public.companies set description = 'staff was here' where id = $1 returning id`,
          [ids.company.approved],
        )).rows,
      )
      expect(updated).toEqual([])
    })

    it('stops a company from approving itself', async () => {
      const status = await asUser(db, ids.user.ownerPending, async (tx) => {
        await tx.query(`update public.companies set status = 'approved' where id = $1`, [
          ids.company.pending,
        ])
        const r = await tx.query<{ status: string }>(
          `select status from public.companies where id = $1`,
          [ids.company.pending],
        )
        return r.rows[0].status
      })
      expect(status).toBe('pending')
    })

    it('stops a suspended company from writing at all (frozen tenant)', async () => {
      const updated = await asUser(db, ids.user.ownerSuspended, async (tx) =>
        (await tx.query(
          `update public.companies set description = 'un-freeze me' where id = $1 returning id`,
          [ids.company.suspended],
        )).rows,
      )
      expect(updated).toEqual([])
    })

    it('still lets a platform admin change status and slug', async () => {
      // The un-freeze path must not be locked out by the trigger.
      const row = await asUser(db, ids.user.platformAdmin, async (tx) => {
        await tx.query(
          `update public.companies set status = 'approved', slug = 'unfrozen-co' where id = $1`,
          [ids.company.suspended],
        )
        const r = await tx.query<{ status: string; slug: string }>(
          `select status, slug from public.companies where id = $1`,
          [ids.company.suspended],
        )
        return r.rows[0]
      })
      expect(row).toEqual({ status: 'approved', slug: 'unfrozen-co' })
    })
  })

  // ---- 5 ---------------------------------------------------------------------
  // Threat: the batch roster RPC is SECURITY DEFINER — it reads every
  // participant row plus phone numbers and emergency contacts, bypassing RLS.
  // Its ONLY guard is the is_company_member() check in its body. If that check
  // is wrong, any signed-in user can pull PII for any batch id they can guess.
  describe('get_company_batch_participants leaks nothing to non-members', () => {
    const roster = (userId: string, batchId: string) =>
      asUser(db, userId, async (tx) =>
        (await tx.query(`select * from public.get_company_batch_participants($1)`, [batchId])).rows,
      )

    it('returns the full roster to the owning company', async () => {
      const rows = await roster(ids.user.ownerApproved, ids.batch.approvedActive)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ user_id: ids.user.trekkerA, status: 'confirmed' })
    })

    it('returns the roster to staff of the owning company too', async () => {
      expect(await roster(ids.user.staffApproved, ids.batch.approvedActive)).toHaveLength(1)
    })

    it('returns an empty set to a signed-in non-member', async () => {
      expect(await roster(ids.user.trekkerB, ids.batch.approvedActive)).toEqual([])
    })

    it("returns an empty set to a DIFFERENT company's owner", async () => {
      expect(await roster(ids.user.ownerPending, ids.batch.approvedActive)).toEqual([])
    })

    it('returns an empty set to the participant themself', async () => {
      // trekkerA is IN this batch. Being a participant is not membership; the
      // roster with everyone's phone numbers is a company-staff view.
      expect(await roster(ids.user.trekkerA, ids.batch.approvedActive)).toEqual([])
    })

    it('returns an empty set for an unknown batch id', async () => {
      expect(
        await roster(ids.user.ownerApproved, '00000000-0000-4000-8000-0000deadbeef'),
      ).toEqual([])
    })

    it('is not callable by anonymous visitors', async () => {
      await expect(
        asAnon(db, (tx) =>
          tx.query(`select * from public.get_company_batch_participants($1)`, [
            ids.batch.approvedActive,
          ]),
        ),
      ).rejects.toThrow(/permission denied/i)
    })

    it('actually carries PII, so the guard above is load-bearing', async () => {
      // If the RPC ever stopped returning phone/emergency columns, the negative
      // tests above would still pass while protecting nothing. Pin the payload.
      await asSuperuser(db, async (tx) => {
        await tx.query(
          `update public.profiles set phone_no = '555-0100', emergency_no = '555-0199' where id = $1`,
          [ids.user.trekkerA],
        )
        await tx.exec(`set local role authenticated`)
        await tx.exec(
          `set local request.jwt.claims = '{"sub":"${ids.user.ownerApproved}","role":"authenticated"}'`,
        )
        const r = await tx.query<{ phone_no: string; emergency_no: string }>(
          `select phone_no, emergency_no from public.get_company_batch_participants($1)`,
          [ids.batch.approvedActive],
        )
        expect(r.rows[0]).toEqual({ phone_no: '555-0100', emergency_no: '555-0199' })
      })
    })
  })

  // ---- 6 ---------------------------------------------------------------------
  // Threat: PostgREST's embedded-resource syntax (`?select=*,profiles(email)`)
  // is a classic RLS-bypass vector — a naive reviewer assumes the parent row's
  // policy governs the whole payload. trek_reviews is intentionally public
  // ("Reviews are viewable by everyone"), so the review itself must stay
  // visible to a stranger while the joined profiles row — governed by its own
  // "Users can view own profile" policy — must not. The SQL LEFT JOIN below is
  // the exact mechanism PostgREST embedding compiles down to, so nulling here
  // is what makes the embed null there too.
  describe('a public trek_reviews row does not leak the reviewer’s profile through a join', () => {
    const withReview = (userId: string) =>
      asSuperuser(db, async (tx) => {
        await tx.query(
          `insert into public.trek_reviews (trek_id, user_id, rating, comment)
           values ($1, $2, 5, 'Great trek') returning id`,
          [ids.trek.approvedActive, ids.user.trekkerA],
        )
        await tx.exec(`set local role authenticated`)
        await tx.exec(
          `set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`,
        )
        return (
          await tx.query<{ rating: number; email: string | null; full_name: string | null }>(
            `select r.rating, p.email, p.full_name
               from public.trek_reviews r
               left join public.profiles p on p.id = r.user_id
              where r.trek_id = $1`,
            [ids.trek.approvedActive],
          )
        ).rows
      })

    it('nulls the reviewer’s email and full_name for a stranger, but keeps the review itself', async () => {
      const rows = await withReview(ids.user.trekkerB)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual({ rating: 5, email: null, full_name: null })
    })

    it('still resolves the reviewer’s own profile through the same join for the reviewer themself', async () => {
      // Guards against the opposite failure: a policy tightened into
      // uselessness (nulling the join for everyone, reviewer included) would
      // make the negative test above pass for the wrong reason.
      const rows = await withReview(ids.user.trekkerA)
      expect(rows).toHaveLength(1)
      expect(rows[0].email).not.toBeNull()
      expect(rows[0].full_name).toBe('Trekker A')
    })
  })

  // ---- 7 ---------------------------------------------------------------------
  // Threat: a "count-oracle" — even with row contents hidden, a client that
  // learns whether a specific id *exists* (e.g. via PostgREST's exact-count
  // Content-Range header) can enumerate other users. Denied SELECT must return
  // zero rows the same way for "no such id" and "id exists but isn't mine" —
  // any difference between the two is the leak.
  describe('probing another user’s profile id by exact match leaks neither content nor existence', () => {
    it('returns zero rows for a real id that belongs to someone else', async () => {
      const rows = await asUser(db, ids.user.trekkerB, async (tx) =>
        (await tx.query(`select id from public.profiles where id = $1`, [ids.user.trekkerA])).rows,
      )
      expect(rows).toEqual([])
    })

    it('returns the identical zero-row shape for an id that does not exist at all', async () => {
      const rows = await asUser(db, ids.user.trekkerB, async (tx) =>
        (
          await tx.query(`select id from public.profiles where id = $1`, [
            '00000000-0000-4000-8000-0000deadbeef',
          ])
        ).rows,
      )
      expect(rows).toEqual([])
    })

    it("still lets the user read their own profile by id", async () => {
      const rows = await asUser(db, ids.user.trekkerB, async (tx) =>
        (await tx.query(`select id from public.profiles where id = $1`, [ids.user.trekkerB])).rows,
      )
      expect(rows).toHaveLength(1)
    })
  })
})
