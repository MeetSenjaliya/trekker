import { createClient } from '@/utils/supabase/client';
import { logError } from '@/lib/log';

export interface LoginEvent {
    id: number;
    email: string | null;
    ip: string | null;
    user_agent: string | null;
    created_at: string;
    last_seen_at: string;
    ended_at: string | null;
    method: string | null;
    account_type: string | null;
    is_new_device: boolean;
}

export const LOGIN_EVENTS_PAGE_SIZE = 50;

// login_events is readable only under the platform-admin RLS policy (0027);
// anyone else gets an empty page, not an error.
export async function adminListLoginEvents(
    search: string,
    page: number
): Promise<{ rows: LoginEvent[]; total: number }> {
    const supabase = createClient();
    const from = page * LOGIN_EVENTS_PAGE_SIZE;

    let query = supabase
        .from('login_events')
        .select(
            'id, email, ip, user_agent, created_at, last_seen_at, ended_at, method, account_type, is_new_device',
            { count: 'exact' }
        )
        .order('created_at', { ascending: false })
        .range(from, from + LOGIN_EVENTS_PAGE_SIZE - 1);

    const term = search.trim();
    if (term) query = query.ilike('email', `%${term}%`);

    const { data, error, count } = await query;
    if (error) {
        logError('Error loading login events:', error);
        throw new Error('Failed to load login activity. Please try again.');
    }
    return { rows: (data as LoginEvent[]) ?? [], total: count ?? 0 };
}
