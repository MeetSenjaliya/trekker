import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, asSuperuser, asUser, getDb, ids, type Actor } from './harness'

/**
 * Threat: any signed-in user calls storage list() and walks the whole bucket.
 *
 * storage-api's list endpoint is a plain SELECT over storage.objects, so the
 * `using (bucket_id = '<bucket>')` policies §9/§12.7 shipped handed every
 * authenticated account a directory of every other account — user UIDs and
 * filenames in avatars and trek-reviews, company UUIDs in company-logos and
 * trek-images. 0006 scopes all four to the caller's own prefix.
 *
 * Nothing about IMAGE DELIVERY is under test here, and that is the point: all
 * five buckets are public, so the app's <img> tags resolve through the CDN path
 * with no session and no RLS. These policies govern the authenticated path
 * only, which the app uses for exactly one thing — reading back the row its own
 * upload just wrote.
 */
describe('storage SELECT is scoped to the caller’s own prefix', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const namesIn = async (tx: Actor, bucket: string) =>
    (
      await tx.query<{ name: string }>(
        `select name from storage.objects where bucket_id = $1 order by name`,
        [bucket],
      )
    ).rows.map((row) => row.name)

  // ---- 1 -----------------------------------------------------------------------
  describe('avatars', () => {
    it('shows a user only their own avatar, not the other user’s', async () => {
      const names = await asUser(db, ids.user.trekkerA, (tx) => namesIn(tx, 'avatars'))
      expect(names).toEqual([`${ids.user.trekkerA}/face.jpg`])
    })

    it('shows the legacy flat {uid}.ext avatar to its owner', async () => {
      // The trap 0006 was written around: foldername('<uid>.png') is {}, so
      // [1] is NULL and a folder-prefix-only policy hides this object from the
      // one person entitled to it — and breaks their next upsert, because
      // upload({ upsert: true }) inserts with RETURNING and RETURNING is
      // checked against the SELECT policy.
      const names = await asUser(db, ids.user.trekkerB, (tx) => namesIn(tx, 'avatars'))
      expect(names).toEqual([`${ids.user.trekkerB}.png`])
    })

    it('shows an anonymous visitor nothing', async () => {
      expect(await asAnon(db, (tx) => namesIn(tx, 'avatars'))).toEqual([])
    })
  })

  // ---- 2 -----------------------------------------------------------------------
  describe('trek-reviews', () => {
    it('shows a user only their own review photos', async () => {
      const names = await asUser(db, ids.user.trekkerA, (tx) => namesIn(tx, 'trek-reviews'))
      expect(names).toEqual([`${ids.user.trekkerA}/summit.jpg`])
    })

    it('shows an anonymous visitor nothing', async () => {
      expect(await asAnon(db, (tx) => namesIn(tx, 'trek-reviews'))).toEqual([])
    })
  })

  // ---- 3 -----------------------------------------------------------------------
  // Company buckets are keyed by company_id, so "own prefix" is "a company I
  // belong to" — is_company_member, deliberately not the approved-only or
  // writable gates the write policies use.
  describe('company-logos and trek-images', () => {
    it('shows a company member only their own company’s files', async () => {
      const [logos, images] = await asUser(db, ids.user.ownerApproved, async (tx) => [
        await namesIn(tx, 'company-logos'),
        await namesIn(tx, 'trek-images'),
      ])
      expect(logos).toEqual([`${ids.company.approved}/logo.png`])
      expect(images).toEqual([`${ids.company.approved}/ridge-walk.jpg`])
    })

    it('shows a plain trekker nothing in either bucket', async () => {
      const [logos, images] = await asUser(db, ids.user.trekkerB, async (tx) => [
        await namesIn(tx, 'company-logos'),
        await namesIn(tx, 'trek-images'),
      ])
      expect(logos).toEqual([])
      expect(images).toEqual([])
    })

    it('shows one company nothing belonging to another', async () => {
      // outsiderCompany owns the rejected company and belongs to no other, so
      // a policy keyed on "is a company user" rather than "is THIS company's
      // user" fails here and nowhere else.
      const logos = await asUser(db, ids.user.outsiderCompany, (tx) => namesIn(tx, 'company-logos'))
      expect(logos).toEqual([])
    })

    it('still shows a suspended company its own branding', async () => {
      // The §16 status tiers gate publishing, not reading back your own file.
      // If this fails, the SELECT policy picked up is_approved_company_member
      // or is_company_writable, and a frozen tenant can no longer re-upload its
      // logo (upsert's RETURNING check) let alone see it.
      const [logos, images] = await asUser(db, ids.user.ownerSuspended, async (tx) => [
        await namesIn(tx, 'company-logos'),
        await namesIn(tx, 'trek-images'),
      ])
      expect(logos).toEqual([`${ids.company.suspended}/logo.png`])
      expect(images).toEqual([`${ids.company.suspended}/taken-down.jpg`])
    })
  })

  // ---- 4 -----------------------------------------------------------------------
  it('has more objects seeded than any one actor can see', async () => {
    // Every assertion above is an equality against a short list, so all of them
    // would pass against an empty bucket. This is what proves the rows exist.
    const total = await asSuperuser(db, async (tx) =>
      Number((await tx.query<{ n: number }>(`select count(*)::int as n from storage.objects`)).rows[0].n),
    )
    expect(total).toBe(8)
  })

  // ---- 5 -----------------------------------------------------------------------
  it('leaves trek-profile with no authenticated SELECT at all', async () => {
    // It has no object policies, which is already the end state 0006 puts the
    // other four in. A policy added here later without a prefix clause would
    // reopen the finding in the one bucket nobody is watching.
    const { rows } = await db.query<{ cmd: string; qual: string | null }>(`
      select cmd, qual from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and qual like '%trek-profile%'
    `)
    expect(rows).toEqual([])
  })

  // ---- 6 -----------------------------------------------------------------------
  it('leaves no bucket-wide SELECT policy on storage.objects', async () => {
    // The regression that matters is structural: a future migration re-adding
    // `using (bucket_id = 'x')` for authenticated. Every legitimate SELECT
    // policy now narrows further than the bucket, so a qual whose only test is
    // bucket_id is by definition the bug.
    const { rows } = await db.query<{ policyname: string; qual: string }>(`
      select policyname, qual from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
    `)
    expect(rows.length).toBeGreaterThan(0)
    for (const p of rows) {
      expect(p.qual, `policy "${p.policyname}" grants a whole bucket`).toMatch(
        /auth\.uid\(\)|is_company_member/,
      )
    }
  })
})
