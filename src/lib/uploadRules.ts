// The upload policy that used to live in storage.objects RLS, restated as pure
// functions so the route handler and its unit tests share one rule table.
// Keep this module free of Supabase and Next imports.

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024

export const UPLOAD_KINDS = ['avatar', 'review', 'company-logo', 'company-cover', 'trek-cover'] as const
export type UploadKind = (typeof UPLOAD_KINDS)[number]

export type UploadIds = { companyId?: string; trekId?: string }

export type ImageType = 'jpeg' | 'png' | 'webp'

const MIME: Record<ImageType, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export const mimeOf = (type: ImageType) => MIME[type]

// Same bucket names as Supabase Storage used, so the copied objects and the
// new ones share one key layout: `{bucket}/{path}`.
export function bucketFor(kind: UploadKind): string {
  switch (kind) {
    case 'avatar':
      return 'avatars'
    case 'review':
      return 'trek-reviews'
    case 'company-logo':
    case 'company-cover':
      return 'company-logos'
    case 'trek-cover':
      return 'trek-images'
  }
}

// The client's filename never reaches the key: only the sniffed type picks the
// extension, and the name is a timestamp plus random hex.
export function objectKey(
  kind: UploadKind,
  ids: UploadIds,
  uid: string,
  type: ImageType,
  now: number,
  randomHex: string,
): string {
  const name = `${now}-${randomHex}.${type === 'jpeg' ? 'jpg' : type}`
  const bucket = bucketFor(kind)
  switch (kind) {
    case 'avatar':
    case 'review':
      return `${bucket}/${uid}/${name}`
    case 'company-logo':
      return `${bucket}/${ids.companyId}/${name}`
    case 'company-cover':
      return `${bucket}/${ids.companyId}/cover-${name}`
    case 'trek-cover':
      return `${bucket}/${ids.companyId}/${ids.trekId}/${name}`
  }
}

// Magic bytes, not the Content-Type the browser sent: that header is whatever
// the client says it is, and an SVG or HTML file renamed to .jpg is exactly
// what a public image bucket must not serve.
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return 'png'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  )
    return 'webp'
  return null
}

export type RpcCheck = (fn: string, args: { p_company_id: string }) => Promise<boolean>

// The same three RPCs the storage policies called, in the same combinations:
// avatars/trek-reviews are keyed to the caller's own folder so there is nothing
// to ask; company-logos needs a member of a pending-or-approved company;
// trek-images needs a member of an approved one.
export async function authorizeUpload(
  kind: UploadKind,
  ids: UploadIds,
  rpc: RpcCheck,
): Promise<boolean> {
  switch (kind) {
    case 'avatar':
    case 'review':
      return true
    case 'company-logo':
    case 'company-cover': {
      if (!ids.companyId) return false
      const args = { p_company_id: ids.companyId }
      return (await rpc('is_company_member', args)) && (await rpc('is_company_writable', args))
    }
    case 'trek-cover': {
      if (!ids.companyId || !ids.trekId) return false
      return rpc('is_approved_company_member', { p_company_id: ids.companyId })
    }
  }
}
