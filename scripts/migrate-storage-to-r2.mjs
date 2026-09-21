#!/usr/bin/env node
/**
 * One-off, idempotent copy of every Supabase Storage object into R2 at the
 * identical key (`{bucket}/{path}`), so the stored URLs only need their prefix
 * replaced afterwards (scripts/rewrite-storage-urls.sql).
 *
 *   SUPABASE_SECRET_KEY=… node --env-file=.env.local scripts/migrate-storage-to-r2.mjs
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and the R2_* vars from .env.local; the SECRET
 * key is passed on the command line and never written anywhere. Safe to re-run:
 * a key that already exists in R2 (HEAD 200) is skipped. Run until it reports
 * 0 copied for every bucket.
 */
import { createClient } from '@supabase/supabase-js'
import { AwsClient } from 'aws4fetch'

const BUCKETS = ['avatars', 'trek-reviews', 'company-logos', 'trek-images', 'trek-profile']

const env = (name) => {
  const v = process.env[name]
  if (!v) {
    console.error(`${name} is not set`)
    process.exit(1)
  }
  return v
}

const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), {
  auth: { persistSession: false },
})
const r2 = new AwsClient({
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  service: 's3',
  region: 'auto',
})
const r2Url = (key) =>
  `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${env('R2_BUCKET')}/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`

// storage.list() is one level deep: folders come back with id === null.
async function* objects(bucket, prefix = '') {
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) yield* objects(bucket, path)
      else yield { path, contentType: entry.metadata?.mimetype ?? 'application/octet-stream' }
    }
    if (data.length < PAGE) return
  }
}

async function exists(key) {
  const res = await r2.fetch(r2Url(key), { method: 'HEAD' })
  if (res.status === 200) return true
  if (res.status === 404) return false
  throw new Error(`HEAD ${key}: ${res.status}`)
}

async function copy(bucket, { path, contentType }) {
  const key = `${bucket}/${path}`
  if (await exists(key)) return 'skipped'

  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error) throw new Error(`download ${key}: ${error.message}`)

  const res = await r2.fetch(r2Url(key), {
    method: 'PUT',
    body: new Uint8Array(await data.arrayBuffer()),
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
  if (!res.ok) throw new Error(`PUT ${key}: ${res.status} ${await res.text()}`)
  return 'copied'
}

for (const bucket of BUCKETS) {
  const counts = { copied: 0, skipped: 0 }
  for await (const object of objects(bucket)) {
    counts[await copy(bucket, object)]++
  }
  console.log(`${bucket}: ${counts.copied} copied, ${counts.skipped} already present`)
}
