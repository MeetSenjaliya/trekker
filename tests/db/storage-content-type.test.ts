import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { getDb } from './harness'

/**
 * Content-Type, not policies.
 *
 * Public storage objects are served from the Supabase domain, which does not
 * send `X-Content-Type-Options: nosniff` and offers no way to make it — the
 * nosniff in next.config.mjs covers the Next.js origin only (STORAGE-002,
 * 2026-08-24 pentest). What stands in for it is the Content-Type those objects
 * are served with: browsers sniff a missing, generic or unknown type, and take
 * a concrete `image/*` at its word. `allowed_mime_types` is therefore the
 * control, and it is a per-bucket column with no default — a bucket added
 * without one silently reopens the finding, and nothing else in the suite would
 * notice, because it is not a policy and not a grant.
 *
 * Hence this file: the invariant is "every bucket, no exceptions", so a new
 * bucket fails here until it is capped too.
 */
describe('storage buckets cannot serve a sniffable Content-Type', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await getDb()
  })

  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

  it('every bucket restricts allowed_mime_types to image types', async () => {
    const { rows } = await db.query<{ id: string; allowed_mime_types: string[] | null }>(`
      select id, allowed_mime_types from storage.buckets order by id
    `)

    // An empty result would pass every assertion below without testing anything.
    expect(rows.length).toBeGreaterThan(0)

    for (const bucket of rows) {
      expect(bucket.allowed_mime_types, `bucket ${bucket.id} has no MIME allowlist`).not.toBeNull()
      expect(bucket.allowed_mime_types, `bucket ${bucket.id} allows a non-image type`).toEqual(
        IMAGE_TYPES,
      )
    }
  })

  it('every bucket carries the 3 MiB per-upload ceiling', async () => {
    const { rows } = await db.query<{ id: string; file_size_limit: string | null }>(`
      select id, file_size_limit from storage.buckets where file_size_limit is distinct from 3145728
    `)
    expect(rows.map((r) => r.id)).toEqual([])
  })
})
