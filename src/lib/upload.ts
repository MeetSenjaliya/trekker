import { UploadError, uploadErrorMessage } from '@/lib/uploadErrors'
import type { UploadKind } from '@/lib/uploadRules'

// Browser side of the upload route. Compress with compressImage() first, as
// the call sites already do; the route caps at 3 MiB.
export async function uploadImage(
  file: Blob,
  target: { kind: UploadKind; companyId?: string; trekId?: string },
): Promise<string> {
  const body = new FormData()
  body.set('file', file)
  body.set('kind', target.kind)
  if (target.companyId) body.set('companyId', target.companyId)
  if (target.trekId) body.set('trekId', target.trekId)

  const res = await fetch('/api/upload', { method: 'POST', body })
  const payload = (await res.json().catch(() => ({}))) as { url?: string; error?: string }

  if (!res.ok || !payload.url) {
    throw new UploadError(uploadErrorMessage(payload.error ?? 'failed'))
  }
  return payload.url
}
