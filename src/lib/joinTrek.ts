import { createClient } from '@/utils/supabase/client';

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
            console.error('Error joining trek:', error);
            return {
                success: false,
                message: `Failed to join ${trekTitle}. ${error.message || 'Please try again.'}`
            };
        }

        // The RPC should return relevant IDs
        // Assuming the RPC returns: { conversation_id, batch_id, participant_id }
        const conversationId = data?.conversation_id;
        const batchId = data?.batch_id;
        const participantId = data?.participant_id;

        return {
            success: true,
            message: `Successfully joined ${trekTitle} for ${new Date(date).toLocaleDateString()}!`,
            conversationId,
            batchId,
            participantId
        };
    } catch (error: any) {
        console.error('Unexpected error joining trek:', error);
        return {
            success: false,
            message: `Unexpected error joining ${trekTitle}. Please try again.`
        };
    }
}
