import { createClient } from '@/utils/supabase/client';
import { logError } from '@/lib/log';

export interface JoinTrekParams {
    userId: string;
    trekId: string;
    trekTitle: string;
    date: string;
}

export interface JoinTrekResult {
    success: boolean;
    message: string;
    conversationId?: string;
    batchId?: string;
    participantId?: string;
    status?: 'confirmed' | 'waitlisted';
    waitlistPosition?: number;
}

/**
 * Shared function to join a trek batch and automatically add user to chat
 * @param params - Join trek parameters
 * @returns Result object with success status and optional IDs
 */
export async function joinTrekBatchAndChat(
    params: JoinTrekParams
): Promise<JoinTrekResult> {
    const { userId, trekId, trekTitle, date } = params;
    const supabase = createClient();

    try {
        // Call RPC to join trek batch and chat
        const { data, error } = await supabase.rpc('join_trek_and_chat', {
            p_user_id: userId,
            p_trek_id: trekId,
            p_batch_date: date
        });

        if (error) {
            logError('Error joining trek:', error);
            return {
                success: false,
                message: `Failed to join ${trekTitle}. ${error.message || 'Please try again.'}`
            };
        }

        // RPC returns: { conversation_id, batch_id, participant_id, status, waitlist_position }
        const conversationId = data?.conversation_id;
        const batchId = data?.batch_id;
        const participantId = data?.participant_id;
        const status: 'confirmed' | 'waitlisted' =
            data?.status === 'waitlisted' ? 'waitlisted' : 'confirmed';
        const waitlistPosition = typeof data?.waitlist_position === 'number'
            ? data.waitlist_position
            : undefined;

        const message = status === 'waitlisted'
            ? `${trekTitle} is full — you're #${waitlistPosition ?? '?'} on the waitlist. We'll add you to the group automatically when a spot opens up.`
            : `Successfully joined ${trekTitle} for ${new Date(date).toLocaleDateString()}!`;

        return {
            success: true,
            message,
            conversationId,
            batchId,
            participantId,
            status,
            waitlistPosition
        };
    } catch (error: unknown) {
        logError('Unexpected error joining trek:', error);
        return {
            success: false,
            message: `Unexpected error joining ${trekTitle}. Please try again.`
        };
    }
}

/**
 * Shared function to leave a trek batch. Removal from the batch chat rides along
 * in the same transaction: the trek_participants_chat_leave trigger (migration
 * 0019) deletes the matching conversation_participants row, so the booking and
 * the chat seat cannot come apart.
 * @param userId - User ID
 * @param batchId - Trek Batch ID
 * @returns Result object with success status
 */
export async function leaveTrek(
    userId: string,
    batchId?: string
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    try {
        if (!userId) throw new Error("User ID is required");
        if (!batchId) throw new Error("Batch ID is required to leave a trek");

        const { error } = await supabase
            .from('trek_participants')
            .delete()
            .eq('batch_id', batchId)
            .eq('user_id', userId);

        if (error) throw error;

        return { success: true, message: "Successfully left the trek." };

    } catch (error: unknown) {
        logError('Unexpected error leaving trek:', error);
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, message: "Failed to leave trek. " + message };
    }
}
