import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { logError } from '@/lib/log'
import { publicUrl, r2Client, r2ObjectUrl } from '@/lib/r2'
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_KINDS,
  authorizeUpload,
  bucketFor,
  mimeOf,
  objectKey,
  sniffImageType,
} from '@/lib/uploadRules'

// The one place the app talks to Cloudflare R2. The bytes come through here
// rather than via a presigned URL so the server can check the real file type
// and the R2 credentials never leave it. Runs as the signed-in user: the
// company checks are the same RPCs the storage policies used to call.

const fields = z.object({
  kind: z.enum(UPLOAD_KINDS),
  companyId: z.uuid().optional(),
  trekId: z.uuid().optional(),
})

const fail = (code: string, status: number) => NextResponse.json({ error: code }, { status })

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('unauthenticated', 401)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail('invalid', 400)
  }

  const parsed = fields.safeParse({
    kind: form.get('kind'),
    companyId: form.get('companyId') ?? undefined,
    trekId: form.get('trekId') ?? undefined,
  })
  const file = form.get('file')
  if (!parsed.success || !(file instanceof Blob)) return fail('invalid', 400)
  const { kind, companyId, trekId } = parsed.data

  if (file.size > MAX_UPLOAD_BYTES) return fail('too_large', 413)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniffImageType(bytes)
  if (!type) return fail('unsupported_type', 415)

  const rpc = async (fn: string, args: { p_company_id: string }) => {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) {
      logError(`upload: ${fn} failed`, error)
      throw error
    }
    return data === true
  }

  try {
    if (!(await authorizeUpload(kind, { companyId, trekId }, rpc))) return fail('forbidden', 403)
  } catch {
    return fail('failed', 500)
  }

  const { data: allowed, error: rateError } = await supabase.rpc('record_upload', {
    p_bucket: bucketFor(kind),
  })
  if (rateError) {
    logError('upload: record_upload failed', rateError)
    return fail('failed', 500)
  }
  if (allowed !== true) return fail('rate_limited', 429)

  const random = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  const key = objectKey(kind, { companyId, trekId }, user.id, type, Date.now(), random)

  try {
    const res = await r2Client().fetch(r2ObjectUrl(key), {
      method: 'PUT',
      body: bytes,
      headers: {
        'Content-Type': mimeOf(type),
        // Next's fetch streams larger bodies chunked, and R2 answers 411 without a length.
        'Content-Length': String(bytes.byteLength),
        // Keys are unique per upload, so the object never changes under its URL.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
    if (!res.ok) {
      logError('upload: R2 PUT failed', { code: String(res.status), message: res.statusText })
      return fail('failed', 500)
    }
  } catch (error) {
    logError('upload: R2 PUT threw', error)
    return fail('failed', 500)
  }

  return NextResponse.json({ url: publicUrl(key) })
}
