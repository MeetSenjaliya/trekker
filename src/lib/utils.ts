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
