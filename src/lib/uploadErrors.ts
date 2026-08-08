// Storage uploads are capped in Postgres, not in the client: the buckets carry
// a 3MB / image-only limit and storage.objects carries a per-user hourly rate
// trigger (supabase/phases/fix-storage-rate-limit-message.sql). All of those
// rejections arrive as an opaque StorageError, so they are mapped to text the
// user can act on — "try again" is actively wrong advice for a rate limit.
//
// The rate limit needs a round trip because storage-api does not forward the
// trigger's message: it answers 500 with a body of `{}`, which supabase-js
// turns into the error message "{}". Nothing in the response distinguishes a
// rate-limited upload from any other server-side failure, so the only way to
// tell them apart is to ask the database directly.

import type { SupabaseClient } from '@supabase/supabase-js';

export class UploadError extends Error {}

const RATE_LIMITED =
  'You have uploaded too many images in the last hour. Please try again later.';

export async function uploadErrorMessage(
  error: { message?: string; status?: number },
  supabase: SupabaseClient,
  bucket: string,
): Promise<string> {
  const message = error.message ?? '';

  if (error.status === 413 || /exceeded the maximum allowed size|payload too large/i.test(message)) {
    return 'That image is too large. Please use an image under 3 MB.';
  }
  if (error.status === 415 || /mime type|invalid_mime_type/i.test(message)) {
    return 'That file type is not supported. Please use a JPEG, PNG or WebP image.';
  }
  if (/too many images/i.test(message)) {
    return RATE_LIMITED;
  }

  const { data } = await supabase.rpc('upload_rate_limited', { p_bucket: bucket });
  if (data === true) {
    return RATE_LIMITED;
  }

  // Only the unexplained case is worth a log. The rejections above are expected
  // outcomes the user is already being told about, and logging the raw
  // StorageError alongside them is what made the rate limit hard to read: it
  // prints as `{}` and says nothing the returned message doesn't.
  console.error('Upload failed', { bucket, status: error.status, message });
  return 'The image failed to upload. Please try again.';
}
