// The upload route (src/app/api/upload/route.ts) rejects with a short code and
// a real status, so the text the user sees is a plain lookup — "try again" is
// actively wrong advice for a rate limit, so that one gets its own line.

export class UploadError extends Error {}

const MESSAGES: Record<string, string> = {
  too_large: 'That image is too large. Please use an image under 3 MB.',
  unsupported_type: 'That file type is not supported. Please use a JPEG, PNG or WebP image.',
  rate_limited: 'You have uploaded too many images in the last hour. Please try again later.',
  forbidden: 'You do not have permission to upload images here.',
  unauthenticated: 'Please sign in again to upload images.',
}

export function uploadErrorMessage(code: string): string {
  return MESSAGES[code] ?? 'The image failed to upload. Please try again.'
}
