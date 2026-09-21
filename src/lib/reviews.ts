import { createClient } from '@/utils/supabase/client';
import { logError } from '@/lib/log';
import { uploadImage } from '@/lib/upload';
import { UploadError } from '@/lib/uploadErrors';

export const MAX_REVIEW_PHOTOS = 5;

// The last day of a departure, as the 0018 review policy computes it:
// batch_date + (greatest(1, ceil(duration_hours / 24)) - 1). Restated here
// only to decide whether to offer the form; Postgres is what refuses.
export function lastTrekDay(batchDate: string, durationHours?: number | null): string {
  const days = Math.max(1, Math.ceil((durationHours ?? 0) / 24));
  const d = new Date(`${batchDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

export interface SubmitReviewParams {
  trekId: string;
  userId: string;
  rating: number;
  comment: string;
  photos: File[];
}

export interface SubmitReviewResult {
  success: boolean;
  message: string;
}

// Photos first, then the row: a failed upload costs nothing, and a refused
// insert leaves at most five unreferenced objects in R2 (parity with the old
// avatar/cover uploads, which never deleted their predecessors either).
export async function submitReview(params: SubmitReviewParams): Promise<SubmitReviewResult> {
  const { trekId, userId, rating, comment, photos } = params;
  if (photos.length > MAX_REVIEW_PHOTOS) {
    return { success: false, message: `You can attach at most ${MAX_REVIEW_PHOTOS} photos.` };
  }

  const photoUrls: string[] = [];
  try {
    for (const photo of photos) {
      photoUrls.push(await uploadImage(photo, { kind: 'review' }));
    }
  } catch (error) {
    if (error instanceof UploadError) return { success: false, message: error.message };
    logError('submitReview: upload failed', error);
    return { success: false, message: 'A photo failed to upload. Please try again.' };
  }

  const supabase = createClient();
  const { error } = await supabase.from('trek_reviews').insert({
    trek_id: trekId,
    user_id: userId,
    rating,
    comment,
    photo_urls: photoUrls,
  });

  if (error) {
    logError('submitReview: insert failed', error);
    switch (error.code) {
      case '23505':
        return { success: false, message: 'You have already reviewed this trek.' };
      case '42501':
        return {
          success: false,
          message: 'You can review a trek once a confirmed booking of yours has finished.',
        };
      default:
        return { success: false, message: 'Failed to submit review. Please try again.' };
    }
  }

  return { success: true, message: 'Thanks — your review is live!' };
}
