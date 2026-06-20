import { createClient } from '@/utils/supabase/client';

/**
 * Formats the participant count for display.
 * @param count The actual number of participants from the database.
 * @returns The count to display (defaults to 7 if count is 0).
 */
export function getDisplayParticipantCount(count: number): number {
    return count > 0 ? count : 7;
}

/**
 * Fetches the total number of participants for a given trek using a Supabase RPC call.
 * This counts participants across all batches for the trek.
 * 
 * @param trekId The UUID of the trek.
 * @returns A promise that resolves to the participant count (number). Returns 0 on error.
 */
export async function getParticipantCount(trekId: string): Promise<number> {
    const supabase = createClient();

    try {
        const { data, error } = await supabase.rpc('get_trek_participant_count', {
            trek_uuid: trekId
        });

        if (error) {
            console.error(`Error fetching participant count for trek ${trekId}:`, error);
            return 0;
        }

        return typeof data === 'number' ? data : 0;
    } catch (err) {
        console.error(`Unexpected error fetching participant count for trek ${trekId}:`, err);
        return 0;
    }
}

/**
 * Fetches a trek's live average review rating (rounded to 1 decimal) via RPC.
 * Returns null when the trek has no reviews so callers can hide the rating badge
 * rather than showing a fake value.
 *
 * @param trekId The UUID of the trek.
 * @returns A promise resolving to the average rating, or null when unrated/on error.
 */
export async function getTrekRating(trekId: string): Promise<number | null> {
    const supabase = createClient();

    try {
        const { data, error } = await supabase.rpc('get_trek_avg_rating', {
            trek_uuid: trekId
        });

        if (error) {
            console.error(`Error fetching rating for trek ${trekId}:`, error);
            return null;
        }

        // Postgres numeric comes back as a string (e.g. "4.0") to preserve
        // precision; coerce it. null/undefined => trek has no reviews.
        if (data === null || data === undefined) return null;
        const n = Number(data);
        return Number.isFinite(n) ? n : null;
    } catch (err) {
        console.error(`Unexpected error fetching rating for trek ${trekId}:`, err);
        return null;
    }
}
