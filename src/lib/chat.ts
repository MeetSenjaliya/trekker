import { createClient } from '@/utils/supabase/client';

/**
 * Bump the caller's read cursor for a conversation to now().
 * Resolves the per-conversation unread count to zero (see getUnreadCounts).
 */
export async function markConversationRead(conversationId: string): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase.rpc('mark_conversation_read', {
        p_conversation_id: conversationId,
    });
    if (error) console.error('mark_conversation_read failed:', error);
}

/**
 * Unread message counts for every conversation the caller belongs to,
 * counting only other users' non-deleted messages newer than last_read_at.
 */
export async function getUnreadCounts(): Promise<Map<string, number>> {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('get_unread_counts');
    if (error) {
        console.error('get_unread_counts failed:', error);
        return new Map();
    }
    return new Map<string, number>(
        (data || []).map((r: { conversation_id: string; unread: number }) => [
            r.conversation_id,
            Number(r.unread),
        ])
    );
}
