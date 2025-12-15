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

/**
 * Shared function to leave a trek batch and automatically remove user from chat
 * @param userId - User ID
 * @param batchId - Trek Batch ID
 * @param conversationId - Optional Conversation ID (if known, saves a query)
 * @returns Result object with success status
 */
export async function leaveTrek(
    userId: string,
    batchId?: string,
    conversationId?: string
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    try {
        if (!userId) throw new Error("User ID is required");

        // 1. If conversationId is missing but batchId is present, try to find it
        // This is important because removing from chat is a separate table operation
        let targetConversationId = conversationId;

        if (!targetConversationId && batchId) {
            const { data: convData } = await supabase
                .from('conversations')
                .select('id')
                .eq('batch_id', batchId)
                .single();
            if (convData) {
                targetConversationId = convData.id;
            }
        }

        // 2. Remove from conversation_participants if we have a conversation ID
        if (targetConversationId) {
            const { error: convError } = await supabase
                .from('conversation_participants')
                .delete()
                .eq('conversation_id', targetConversationId)
                .eq('user_id', userId);

            if (convError) {
                console.error('Error leaving conversation:', convError);
                // We continue to try removing from trek participants even if chat fails
                // But ideally this should be a transaction if possible, or we warn.
            }
        }

        // 3. Remove from trek_participants (if batch_id exists)
        // Note: Sometimes we might just have conversationId (from messages page) and need to find batchId?
        // But for safe deletion, usually we want batchId.
        // If batchId is provided, delete from trek_participants
        if (batchId) {
            const { error: trekError } = await supabase
                .from('trek_participants')
                .delete()
                .eq('batch_id', batchId)
                .eq('user_id', userId);

            if (trekError) {
                console.error('Error leaving trek participant:', trekError);
                throw trekError;
            }
        } else if (!targetConversationId) {
            // If we have neither batchId nor conversationId resolved, we can't do anything
            throw new Error("Insufficient information to leave trek (missing batchId and conversationId)");
        }

        return { success: true, message: "Successfully left the trek." };

    } catch (error: any) {
        console.error('Unexpected error leaving trek:', error);
        return { success: false, message: "Failed to leave trek. " + error.message };
    }
}
