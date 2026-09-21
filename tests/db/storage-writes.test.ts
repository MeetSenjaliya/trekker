import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, asUser, getDb, ids, type Actor } from './harness'

/**
 * Threat (M1): any signed-in user uploads to avatars/<someone-else's uid>/…
 * and replaces their photo — or deletes it. The upload endpoint is an INSERT
 * (or UPDATE, for upsert) on storage.objects, so the with_check on the write
 * policies is the whole control. storage-listing.test.ts covers the SELECT
 * side these were written next to; this is the INSERT / UPDATE / DELETE side,
 * i.e. the fix itself.
 *
 * The two user buckets are keyed on auth.uid(); the two company buckets on a
 * company id, with different tiers: company-logos is writable while the
 * company is pending OR approved (an applicant sets up while it waits), and
 * trek-images only once approved (the publishing tier, same as treks rows).
 *
 * UPDATE and DELETE on a row the caller may not touch do not throw — RLS
 * filters the row out and the statement reports 0 rows. Those are asserted on
 * affectedRows, with the caller's own row as the 1-row control alongside.
 */
describe('storage writes are scoped to the caller’s own prefix', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const u = ids.user
  const c = ids.company
  const denied = /row-level security/i

  const upload = (tx: Actor, bucket: string, name: string) =>
    tx.query(`insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())`, [
      bucket,
      name,
    ])

  // A real upsert re-stamps `version`; the rate-limit trigger reads it to tell
  // an upload from a rename, so this is the honest shape of an overwrite.
  const overwrite = async (tx: Actor, bucket: string, name: string) =>
    (
      await tx.query(
        `update storage.objects set version = 'v2' where bucket_id = $1 and name = $2`,
        [bucket, name],
      )
    ).affectedRows

  const rename = (tx: Actor, bucket: string, from: string, to: string) =>
    tx.query(`update storage.objects set name = $3 where bucket_id = $1 and name = $2`, [
      bucket,
      from,
      to,
    ])

  const remove = async (tx: Actor, bucket: string, name: string) =>
    (await tx.query(`delete from storage.objects where bucket_id = $1 and name = $2`, [bucket, name]))
      .affectedRows

  // ---- 1 -----------------------------------------------------------------------
  describe('avatars', () => {
    it('lets a user upload into their own folder', async () => {
      await expect(
        asUser(db, u.trekkerB, (tx) => upload(tx, 'avatars', `${u.trekkerB}/new.png`)),
      ).resolves.toBeDefined()
    })

    it('lets a user upload on the legacy flat {uid}.ext layout', async () => {
      await expect(
        asUser(db, u.trekkerB, (tx) => upload(tx, 'avatars', `${u.trekkerB}.jpg`)),
      ).resolves.toBeDefined()
    })

    it('refuses an upload into another user’s folder', async () => {
      // The M1 report, verbatim: trekkerB writes trekkerA's path.
      await expect(
        asUser(db, u.trekkerB, (tx) => upload(tx, 'avatars', `${u.trekkerA}/face.jpg`)),
      ).rejects.toThrow(denied)
    })

    it('refuses a flat-layout upload under another user’s uid', async () => {
      await expect(
        asUser(db, u.trekkerA, (tx) => upload(tx, 'avatars', `${u.trekkerB}.png`)),
      ).rejects.toThrow(denied)
    })

    it('refuses overwriting another user’s avatar', async () => {
      expect(
        await asUser(db, u.trekkerB, (tx) => overwrite(tx, 'avatars', `${u.trekkerA}/face.jpg`)),
      ).toBe(0)
    })

    it('lets a user overwrite their own avatar', async () => {
      expect(
        await asUser(db, u.trekkerA, (tx) => overwrite(tx, 'avatars', `${u.trekkerA}/face.jpg`)),
      ).toBe(1)
    })

    it('refuses renaming an own file into another user’s folder', async () => {
      // The using clause passes (it is trekkerA's row); the with_check is what
      // has to catch the new name. Without it an UPDATE is a free path around
      // the INSERT policy.
      await expect(
        asUser(db, u.trekkerA, (tx) =>
          rename(tx, 'avatars', `${u.trekkerA}/face.jpg`, `${u.trekkerB}/face.jpg`),
        ),
      ).rejects.toThrow(denied)
    })

    it('refuses deleting another user’s avatar', async () => {
      expect(
        await asUser(db, u.trekkerB, (tx) => remove(tx, 'avatars', `${u.trekkerA}/face.jpg`)),
      ).toBe(0)
    })

    it('lets a user delete their own avatar', async () => {
      expect(
        await asUser(db, u.trekkerA, (tx) => remove(tx, 'avatars', `${u.trekkerA}/face.jpg`)),
      ).toBe(1)
    })

    it('refuses an anonymous upload', async () => {
      await expect(
        asAnon(db, (tx) =>
          tx.query(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [
            `${u.trekkerA}/face.jpg`,
          ]),
        ),
      ).rejects.toThrow(denied)
    })
  })

  // ---- 2 -----------------------------------------------------------------------
  describe('trek-reviews', () => {
    it('lets a user upload into their own folder', async () => {
      await expect(
        asUser(db, u.trekkerB, (tx) => upload(tx, 'trek-reviews', `${u.trekkerB}/new.jpg`)),
      ).resolves.toBeDefined()
    })

    it('refuses an upload into another user’s folder', async () => {
      await expect(
        asUser(db, u.trekkerB, (tx) => upload(tx, 'trek-reviews', `${u.trekkerA}/summit.jpg`)),
      ).rejects.toThrow(denied)
    })

    it('refuses deleting another user’s review photo', async () => {
      expect(
        await asUser(db, u.trekkerB, (tx) => remove(tx, 'trek-reviews', `${u.trekkerA}/summit.jpg`)),
      ).toBe(0)
    })

    it('lets a user delete their own review photo', async () => {
      expect(
        await asUser(db, u.trekkerA, (tx) => remove(tx, 'trek-reviews', `${u.trekkerA}/summit.jpg`)),
      ).toBe(1)
    })
  })

  // ---- 3 -----------------------------------------------------------------------
  describe('company-logos', () => {
    it('lets the owner upload their company’s logo', async () => {
      await expect(
        asUser(db, u.ownerApproved, (tx) => upload(tx, 'company-logos', `${c.approved}/new.png`)),
      ).resolves.toBeDefined()
    })

    it('lets staff upload it too — membership, not role', async () => {
      await expect(
        asUser(db, u.staffApproved, (tx) => upload(tx, 'company-logos', `${c.approved}/new.png`)),
      ).resolves.toBeDefined()
    })

    it('lets a pending company set up its logo while it waits', async () => {
      // is_company_writable, not is_approved_company_member: pending is
      // writable. If this fails the policy was tightened to the publishing
      // tier and applicants can no longer brand their storefront-to-be.
      await expect(
        asUser(db, u.ownerPending, (tx) => upload(tx, 'company-logos', `${c.pending}/logo.png`)),
      ).resolves.toBeDefined()
    })

    it('refuses a suspended company a new logo — frozen tenant', async () => {
      await expect(
        asUser(db, u.ownerSuspended, (tx) =>
          upload(tx, 'company-logos', `${c.suspended}/new.png`),
        ),
      ).rejects.toThrow(denied)
    })

    it('refuses one company writing under another company’s id', async () => {
      await expect(
        asUser(db, u.ownerApproved, (tx) => upload(tx, 'company-logos', `${c.suspended}/logo.png`)),
      ).rejects.toThrow(denied)
    })

    it('refuses a plain trekker writing under any company id', async () => {
      await expect(
        asUser(db, u.trekkerB, (tx) => upload(tx, 'company-logos', `${c.approved}/logo.png`)),
      ).rejects.toThrow(denied)
    })

    it('refuses deleting another company’s logo', async () => {
      expect(
        await asUser(db, u.ownerApproved, (tx) =>
          remove(tx, 'company-logos', `${c.suspended}/logo.png`),
        ),
      ).toBe(0)
    })

    it('lets a company delete its own logo', async () => {
      expect(
        await asUser(db, u.ownerApproved, (tx) =>
          remove(tx, 'company-logos', `${c.approved}/logo.png`),
        ),
      ).toBe(1)
    })
  })

  // ---- 4 -----------------------------------------------------------------------
  describe('trek-images', () => {
    it('lets an approved company upload trek photos', async () => {
      await expect(
        asUser(db, u.ownerApproved, (tx) => upload(tx, 'trek-images', `${c.approved}/new.jpg`)),
      ).resolves.toBeDefined()
    })

    it('refuses a pending company — publishing needs approval', async () => {
      // The one place the two company buckets differ. A pending company may
      // have a logo but not a catalogue, so the trek-images gate is
      // is_approved_company_member.
      await expect(
        asUser(db, u.ownerPending, (tx) => upload(tx, 'trek-images', `${c.pending}/new.jpg`)),
      ).rejects.toThrow(denied)
    })

    it('refuses a suspended company', async () => {
      await expect(
        asUser(db, u.ownerSuspended, (tx) => upload(tx, 'trek-images', `${c.suspended}/new.jpg`)),
      ).rejects.toThrow(denied)
    })

    it('refuses one company writing under another company’s id', async () => {
      await expect(
        asUser(db, u.ownerApproved, (tx) => upload(tx, 'trek-images', `${c.suspended}/new.jpg`)),
      ).rejects.toThrow(denied)
    })

    it('refuses a plain trekker', async () => {
      await expect(
        asUser(db, u.trekkerB, (tx) => upload(tx, 'trek-images', `${c.approved}/new.jpg`)),
      ).rejects.toThrow(denied)
    })

    it('refuses deleting another company’s trek photo', async () => {
      expect(
        await asUser(db, u.ownerApproved, (tx) =>
          remove(tx, 'trek-images', `${c.suspended}/taken-down.jpg`),
        ),
      ).toBe(0)
    })
  })

  // ---- 5 -----------------------------------------------------------------------
  it('leaves trek-profile with no client write path', async () => {
    // No object policies at all (storage-listing pins the SELECT side). A
    // policy added here later would be the only write path nobody is watching.
    await expect(
      asUser(db, u.trekkerB, (tx) => upload(tx, 'trek-profile', `${u.trekkerB}/x.png`)),
    ).rejects.toThrow(denied)
  })

  // ---- 6 -----------------------------------------------------------------------
  it('leaves no bucket-wide write policy on storage.objects', async () => {
    // Structural mirror of storage-listing #6 for the write side: every
    // INSERT/UPDATE/DELETE policy must narrow further than bucket_id. A
    // with_check (or using, for DELETE) whose only test is the bucket is by
    // definition the M1 bug.
    const { rows } = await db.query<{
      policyname: string
      cmd: string
      qual: string | null
      with_check: string | null
    }>(`
      select policyname, cmd, qual, with_check from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and cmd <> 'SELECT'
    `)
    expect(rows.length).toBeGreaterThan(0)
    for (const p of rows) {
      const guard = p.cmd === 'DELETE' ? p.qual : p.with_check
      expect(guard, `policy "${p.policyname}" (${p.cmd}) grants a whole bucket`).toMatch(
        /auth\.uid\(\)|is_company_member|is_approved_company_member/,
      )
    }
  })
})
