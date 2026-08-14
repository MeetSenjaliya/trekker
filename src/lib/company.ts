import { createClient } from '@/utils/supabase/client';

export type CompanyStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type CompanyRole = 'owner' | 'admin' | 'staff';

// Mirrors is_company_writable() in the DB (phase-h-frozen-companies.sql): a
// rejected or suspended company is read-only, so the dashboard hides its
// management UI instead of offering actions RLS will refuse. Pending is NOT
// frozen — applicants set the company up while they wait. Publishing treks is
// gated separately and more strictly, on status === 'approved'.
export const isCompanyFrozen = (status: CompanyStatus) =>
    status === 'rejected' || status === 'suspended';

export interface Company {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logo_url: string | null;
    cover_image_url: string | null;
    website: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    status: CompanyStatus;
    rejection_reason: string | null;
    created_at: string;
}

export interface CompanyMembership {
    role: CompanyRole;
    company: Company;
}

export interface ApplyForCompanyParams {
    name: string;
    slug: string;
    description?: string;
    contactEmail?: string;
    contactPhone?: string;
    website?: string;
}

export interface ApplyForCompanyResult {
    success: boolean;
    message: string;
    companyId?: string;
}

// apply_for_company() raises these exact messages for expected user mistakes —
// they are written to be shown as-is. Anything else (constraint/network detail)
// stays out of the UI per the "don't leak Supabase error detail" convention.
const KNOWN_APPLY_ERRORS = [
    'You already have a pending application, or that URL slug is taken',
    'Slug must be lowercase letters, numbers and hyphens only',
    'Company name is required',
    'Not authenticated',
    'Only company accounts can apply. Sign up as a trek company instead.',
];

/**
 * Apply to become a trek company. The RPC forces status='pending' and makes the
 * caller the owner — this is the ONLY way a company row is created.
 */
export async function applyForCompany(
    params: ApplyForCompanyParams
): Promise<ApplyForCompanyResult> {
    const supabase = createClient();

    try {
        const { data, error } = await supabase.rpc('apply_for_company', {
            p_name: params.name,
            p_slug: params.slug,
            p_description: params.description || null,
            p_contact_email: params.contactEmail || null,
            p_contact_phone: params.contactPhone || null,
            p_website: params.website || null,
        });

        if (error) {
            console.error('Error applying for company:', error);
            const message = KNOWN_APPLY_ERRORS.includes(error.message)
                ? error.message
                : 'Failed to submit your application. Please try again.';
            return { success: false, message };
        }

        return {
            success: true,
            message: 'Application submitted! A platform admin will review it soon.',
            companyId: data?.company_id,
        };
    } catch (error: unknown) {
        console.error('Unexpected error applying for company:', error);
        return {
            success: false,
            message: 'Unexpected error submitting your application. Please try again.',
        };
    }
}

const COMPANY_COLUMNS =
    'id, name, slug, description, logo_url, cover_image_url, website, contact_email, contact_phone, status, rejection_reason, created_at';

interface MembershipRow {
    role: CompanyRole;
    companies: Company | Company[] | null;
}

/**
 * Companies the signed-in user belongs to, with their role in each. Returns []
 * when signed out. RLS lets members see their own company regardless of status,
 * so a pending/rejected application shows up here too.
 */
export async function getMyCompanies(): Promise<CompanyMembership[]> {
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
        .from('company_members')
        .select(`role, companies ( ${COMPANY_COLUMNS} )`)
        .eq('user_id', user.id);

    if (error) {
        console.error('Error loading company memberships:', error);
        throw new Error('Failed to load your companies. Please try again.');
    }

    return ((data ?? []) as unknown as MembershipRow[]).flatMap((row) => {
        const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
        return company ? [{ role: row.role, company }] : [];
    });
}

/**
 * Public company profile by URL slug. Returns null when not found — which RLS
 * also uses for unapproved companies the caller can't see.
 */
export async function getCompany(slug: string): Promise<Company | null> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('companies')
        .select(COMPANY_COLUMNS)
        .eq('slug', slug)
        .maybeSingle();

    if (error) {
        console.error('Error loading company:', error);
        throw new Error('Failed to load company. Please try again.');
    }

    return (data as Company | null) ?? null;
}

/**
 * A company the caller belongs to, by id. Returns null when the caller isn't a
 * member (RLS won't return the row) so dashboard pages can redirect out.
 */
export async function getMyCompanyById(companyId: string): Promise<Company | null> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('companies')
        .select(COMPANY_COLUMNS)
        .eq('id', companyId)
        .maybeSingle();

    if (error) {
        console.error('Error loading company:', error);
        throw new Error('Failed to load company. Please try again.');
    }

    return (data as Company | null) ?? null;
}

// ---- Overview --------------------------------------------------------------

export interface CompanyOverview {
    activeTreks: number;
    totalTreks: number;
    confirmedBookings: number;
    upcomingBatches: number;
}

/**
 * Dashboard headline stats. Confirmed bookings reuse the trigger-maintained
 * treks.participants_joined counter (confirmed-only), so no per-batch roster
 * fetch is needed here.
 */
export async function getCompanyOverview(companyId: string): Promise<CompanyOverview> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('treks')
        .select('id, is_active, participants_joined')
        .eq('company_id', companyId);

    if (error) {
        console.error('Error loading overview:', error);
        throw new Error('Failed to load overview. Please try again.');
    }

    const rows = (data ?? []) as { id: string; is_active: boolean; participants_joined: number | null }[];
    // Bookings/departures only count treks that are still bookable (active).
    // Archived treks are excluded from these — they appear nowhere else in the dashboard.
    const active = rows.filter((r) => r.is_active);
    const activeTreks = active.length;
    const confirmedBookings = active.reduce((sum, r) => sum + (r.participants_joined ?? 0), 0);

    let upcomingBatches = 0;
    const ids = active.map((r) => r.id);
    if (ids.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const { count, error: bErr } = await supabase
            .from('trek_batches')
            .select('id', { count: 'exact', head: true })
            .in('trek_id', ids)
            .gte('batch_date', today);
        if (bErr) {
            console.error('Error counting upcoming batches:', bErr);
            throw new Error('Failed to load overview. Please try again.');
        }
        upcomingBatches = count ?? 0;
    }

    return { activeTreks, totalTreks: rows.length, confirmedBookings, upcomingBatches };
}

// ---- Treks -----------------------------------------------------------------

export interface CompanyTrek {
    id: string;
    title: string;
    location: string | null;
    difficulty: string;
    cover_image_url: string | null;
    is_active: boolean;
    estimated_cost: number | null;
    max_participants: number | null;
    participants_joined: number | null;
}

export interface EditableTrek {
    id: string;
    company_id: string;
    title: string;
    description: string | null;
    location: string | null;
    difficulty: string;
    distance_km: number | null;
    duration_hours: number | null;
    meeting_point: string | null;
    meeting_point2: string | null;
    estimated_cost: number | null;
    max_participants: number | null;
    gear_checklist: string[] | null;
    cover_image_url: string | null;
    is_active: boolean;
}

// Camel-cased, DB-agnostic input from trekFormSchema. coverImageUrl is only set
// once a cover has been uploaded (its storage path needs the trek id, so on
// create the image is uploaded in a second step).
export interface TrekInput {
    title: string;
    description: string;
    location: string;
    difficulty: string;
    distanceKm: number | null;
    durationHours: number | null;
    meetingPoint: string;
    meetingPoint2: string;
    estimatedCost: number | null;
    maxParticipants: number | null;
    gearChecklist: string[];
    coverImageUrl?: string | null;
}

export function trekRow(input: TrekInput): Record<string, unknown> {
    const row: Record<string, unknown> = {
        title: input.title.trim(),
        description: input.description || null,
        location: input.location || null,
        difficulty: input.difficulty,
        distance_km: input.distanceKm,
        duration_hours: input.durationHours,
        meeting_point: input.meetingPoint || null,
        meeting_point2: input.meetingPoint2 || null,
        estimated_cost: input.estimatedCost,
        max_participants: input.maxParticipants,
        gear_checklist: input.gearChecklist,
    };
    if (input.coverImageUrl !== undefined) row.cover_image_url = input.coverImageUrl;
    return row;
}

/** Treks owned by a company. Company members see their own regardless of status. */
export async function getCompanyTreks(
    companyId: string,
    includeArchived: boolean
): Promise<CompanyTrek[]> {
    const supabase = createClient();

    let query = supabase
        .from('treks')
        .select('id, title, location, difficulty, cover_image_url, is_active, estimated_cost, max_participants, participants_joined')
        .eq('company_id', companyId)
        .order('title', { ascending: true });
    if (!includeArchived) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) {
        console.error('Error loading company treks:', error);
        throw new Error('Failed to load treks. Please try again.');
    }
    return (data as CompanyTrek[]) ?? [];
}

/** A single trek for the edit form. Null when not visible to the caller. */
export async function getTrek(trekId: string): Promise<EditableTrek | null> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('treks')
        .select('id, company_id, title, description, location, difficulty, distance_km, duration_hours, meeting_point, meeting_point2, estimated_cost, max_participants, gear_checklist, cover_image_url, is_active')
        .eq('id', trekId)
        .maybeSingle();

    if (error) {
        console.error('Error loading trek:', error);
        throw new Error('Failed to load trek. Please try again.');
    }
    return (data as EditableTrek | null) ?? null;
}

export async function createTrek(
    companyId: string,
    input: TrekInput
): Promise<{ success: boolean; message: string; trekId?: string }> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('treks')
        .insert({ ...trekRow(input), company_id: companyId })
        .select('id')
        .single();

    if (error) {
        console.error('Error creating trek:', error);
        return { success: false, message: 'Failed to create trek. Please try again.' };
    }
    return { success: true, message: 'Trek created.', trekId: data.id };
}

export async function updateTrek(
    trekId: string,
    input: TrekInput
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('treks')
        .update(trekRow(input))
        .eq('id', trekId)
        .select('id');
    if (error) {
        console.error('Error updating trek:', error);
        return { success: false, message: 'Failed to save changes. Please try again.' };
    }
    if (!data || data.length === 0) {
        return { success: false, message: "You can't edit this trek." };
    }
    return { success: true, message: 'Trek updated.' };
}

/** Archive (is_active=false) or restore a trek — the only "delete" path. */
export async function setTrekActive(
    trekId: string,
    isActive: boolean
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('treks')
        .update({ is_active: isActive })
        .eq('id', trekId)
        .select('id');
    if (error) {
        console.error('Error updating trek status:', error);
        return { success: false, message: 'Failed to update trek. Please try again.' };
    }
    if (!data || data.length === 0) {
        return { success: false, message: "You can't update this trek." };
    }
    return { success: true, message: isActive ? 'Trek restored.' : 'Trek archived.' };
}

// ---- Batches (dated departures) --------------------------------------------

export interface TrekBatch {
    id: string;
    batch_date: string;
    max_participants: number | null;
    confirmed_count: number;
}

/**
 * Departures for a trek with live confirmed counts. Counts come from a dedicated
 * SECURITY DEFINER RPC (trek_participants is self-only under RLS) that returns
 * one integer per batch — no participant PII crosses the wire, and it's a single
 * round-trip for the whole trek instead of one roster fetch per batch.
 */
export async function getTrekBatches(trekId: string): Promise<TrekBatch[]> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('trek_batches')
        .select('id, batch_date, max_participants')
        .eq('trek_id', trekId)
        .order('batch_date', { ascending: true });

    if (error) {
        console.error('Error loading batches:', error);
        throw new Error('Failed to load departures. Please try again.');
    }

    const batches = (data ?? []) as Omit<TrekBatch, 'confirmed_count'>[];
    if (batches.length === 0) return [];

    const { data: countRows, error: cErr } = await supabase.rpc('get_trek_batch_confirmed_counts', {
        p_trek_id: trekId,
    });
    if (cErr) {
        console.error('Error counting participants:', cErr);
        throw new Error('Failed to load departures. Please try again.');
    }

    // confirmed_count comes back as bigint (string over PostgREST) — coerce to number.
    const countByBatch = new Map(
        ((countRows ?? []) as { batch_id: string; confirmed_count: number | string }[]).map((r) => [
            r.batch_id,
            Number(r.confirmed_count),
        ])
    );

    return batches.map((b) => ({ ...b, confirmed_count: countByBatch.get(b.id) ?? 0 }));
}

export async function createBatch(
    trekId: string,
    input: { batchDate: string; maxParticipants: number | null }
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const { error } = await supabase
        .from('trek_batches')
        .insert({ trek_id: trekId, batch_date: input.batchDate, max_participants: input.maxParticipants });

    if (error) {
        console.error('Error creating batch:', error);
        if (error.code === '23505') {
            return { success: false, message: 'A departure on that date already exists.' };
        }
        return { success: false, message: 'Failed to add departure. Please try again.' };
    }
    return { success: true, message: 'Departure added.' };
}

/**
 * Remove a departure. RLS only allows deleting a batch with no bookings AND no
 * chat conversation. A blocked delete removes zero rows (no error); an orphaned
 * conversation FK (code 23503) can also reach here — both map to one message.
 */
export async function deleteBatch(batchId: string): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const blockedMessage =
        "Can't remove a departure that has bookings or chat history. Archive the trek instead.";

    const { data, error } = await supabase.from('trek_batches').delete().eq('id', batchId).select('id');
    if (error) {
        console.error('Error deleting batch:', error.code, error.message);
        if (error.code === '23503') {
            return { success: false, message: blockedMessage };
        }
        return { success: false, message: 'Failed to remove departure. Please try again.' };
    }
    if (!data || data.length === 0) {
        return { success: false, message: blockedMessage };
    }
    return { success: true, message: 'Departure removed.' };
}

// ---- Participants (roster PII — RPC-only path) -----------------------------

export interface BatchParticipant {
    participant_id: string;
    user_id: string;
    full_name: string | null;
    avatar_url: string | null;
    phone_no: string | null;
    emergency_contact: string | null;
    emergency_no: string | null;
    status: string;
    joined_at: string;
}

/** Roster for one batch. The only path company staff see participant contact PII. */
export async function getBatchParticipants(batchId: string): Promise<BatchParticipant[]> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('get_company_batch_participants', { p_batch_id: batchId });
    if (error) {
        console.error('Error loading participants:', error);
        throw new Error('Failed to load participants. Please try again.');
    }
    return (data ?? []) as BatchParticipant[];
}

// ---- Batch announcements ---------------------------------------------------
// Company accounts have no /messages and can't join their own treks, so this is
// the only channel to their bookers. An announcement is a flagged row in the
// batch's existing chat (phase-i-batch-announcements.sql); both directions go
// through RPCs because the author is never a conversation participant.

export interface BatchAnnouncement {
    id: string;
    message: string;
    created_at: string;
    author_id: string;
    author_name: string | null;
}

/** Announcements already sent to a departure. Readable by any company member. */
export async function getBatchAnnouncements(batchId: string): Promise<BatchAnnouncement[]> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('get_batch_announcements', { p_batch_id: batchId });
    if (error) {
        console.error('Error loading announcements:', error);
        throw new Error('Failed to load announcements. Please try again.');
    }
    return (data ?? []) as BatchAnnouncement[];
}

/**
 * Send an announcement to everyone booked on a departure. Requires an approved
 * company. Every expected refusal (no bookings yet, not permitted, too long, and
 * the shared chat rate limit) arrives as a P0001 raise written to be shown as-is
 * — same handling as the chat composer in /messages.
 */
export async function postBatchAnnouncement(
    batchId: string,
    message: string
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const { error } = await supabase.rpc('post_batch_announcement', {
        p_batch_id: batchId,
        p_message: message,
    });

    if (error) {
        console.error('Error posting announcement:', error);
        return {
            success: false,
            message: error.code === 'P0001'
                ? error.message
                : 'Failed to post the announcement. Please try again.',
        };
    }
    return { success: true, message: 'Announcement sent.' };
}

// ---- Company settings ------------------------------------------------------

export interface CompanyProfileInput {
    name: string;
    description: string;
    contactEmail: string;
    contactPhone: string;
    website: string;
    logoUrl?: string | null;
    coverImageUrl?: string | null;
}

/**
 * Update editable company profile fields. status/approval columns are pinned by
 * a DB trigger for non-platform-admins, so they can't be changed here.
 */
export async function updateCompany(
    companyId: string,
    input: CompanyProfileInput
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const row: Record<string, unknown> = {
        name: input.name.trim(),
        description: input.description || null,
        contact_email: input.contactEmail || null,
        contact_phone: input.contactPhone || null,
        website: input.website || null,
    };
    if (input.logoUrl !== undefined) row.logo_url = input.logoUrl;
    if (input.coverImageUrl !== undefined) row.cover_image_url = input.coverImageUrl;

    const { data, error } = await supabase
        .from('companies')
        .update(row)
        .eq('id', companyId)
        .select('id');
    if (error) {
        console.error('Error updating company:', error);
        return { success: false, message: 'Failed to save changes. Please try again.' };
    }
    if (!data || data.length === 0) {
        return { success: false, message: "You can't edit this company." };
    }
    return { success: true, message: 'Company profile updated.' };
}

// ---- Team ------------------------------------------------------------------
// Listing members with identity and inviting by email both need to read
// profiles the caller doesn't own (profiles is self-only under RLS), so they go
// through SECURITY DEFINER RPCs. Role changes / removals use company_members
// RLS directly (owner rows are protected there).

export interface CompanyMember {
    member_id: string;
    user_id: string;
    role: CompanyRole;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
    created_at: string;
}

export async function getCompanyMembers(companyId: string): Promise<CompanyMember[]> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('get_company_members', { p_company_id: companyId });
    if (error) {
        console.error('Error loading company members:', error);
        throw new Error('Failed to load your team. Please try again.');
    }
    return (data ?? []) as CompanyMember[];
}

// invite_company_member() now raises only for authorization. The expected
// outcomes come back as an `error` code in the payload instead, so the call
// commits and the rate-limit counter actually records the attempt.
const INVITE_ERRORS: Record<string, string> = {
    not_found: 'No Trekker account found with that email',
    rate_limited: 'Too many invites in the last hour. Please try again later.',
    already_invited: 'That person already has a pending invite.',
    company_frozen: "Your company can't invite members right now.",
};
const NOT_ADMIN_ERROR = 'Only company owners/admins can invite members';

export async function inviteMember(
    companyId: string,
    email: string
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('invite_company_member', {
        p_company_id: companyId,
        p_email: email,
    });

    if (error) {
        console.error('Error inviting member:', error);
        const message = error.message === NOT_ADMIN_ERROR
            ? error.message
            : 'Failed to send the invite. Please try again.';
        return { success: false, message };
    }

    if (data?.error) {
        return {
            success: false,
            message: INVITE_ERRORS[data.error] ?? 'Failed to send the invite. Please try again.',
        };
    }

    if (data?.already_member) {
        return { success: true, message: 'That person is already on your team.' };
    }
    return { success: true, message: 'Invite sent.' };
}

// ---- Invites ---------------------------------------------------------------
// Accepting an invite converts a trekker account to a company account, so the
// whole flow is RPC-mediated: company_invites has a SELECT policy for the
// company and nothing else. The invitee can't read the table at all (they're
// not a member yet) — getMyInvites goes through get_my_invites(), which also
// resolves the company and inviter names RLS would hide from them.

export interface CompanyInvite {
    id: string;
    email: string;
    role: CompanyRole;
    created_at: string;
    expires_at: string;
}

/** Live (pending, unexpired) invites for a company. Any member can read them. */
export async function listCompanyInvites(companyId: string): Promise<CompanyInvite[]> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('company_invites')
        .select('id, email, role, created_at, expires_at')
        .eq('company_id', companyId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading company invites:', error);
        throw new Error('Failed to load pending invites. Please try again.');
    }
    return (data ?? []) as CompanyInvite[];
}

// Messages the invite RPCs raise for expected user situations — written to be
// shown as-is. Anything else falls back to a generic string, per the "don't
// leak Supabase error detail" convention.
const KNOWN_INVITE_ERRORS = [
    'That invitation is no longer valid',
    'That invitation is no longer pending',
    'You have an upcoming trek booked. Leave it before joining a company team.',
    'Only company owners/admins can revoke invites',
    'Your account has no email address',
    'Not authenticated',
];

// Only the unrecognised errors are logged: the known ones are ordinary outcomes
// the user is about to be told about, and console.error turns each into a red
// Console Error panel in dev. The message and code are logged rather than the
// error object, which the Next dev overlay renders as `{}`.
export function inviteErrorMessage(
    action: string,
    error: { message: string; code?: string },
    fallback: string
): string {
    if (KNOWN_INVITE_ERRORS.includes(error.message)) return error.message;
    console.error(`Error ${action} invite:`, error.code, error.message);
    return fallback;
}

export async function revokeInvite(
    inviteId: string
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const { error } = await supabase.rpc('revoke_company_invite', { p_invite_id: inviteId });
    if (error) {
        return {
            success: false,
            message: inviteErrorMessage('revoking', error, 'Failed to revoke the invite. Please try again.'),
        };
    }
    return { success: true, message: 'Invite revoked.' };
}

export interface MyInvite {
    invite_id: string;
    company_id: string;
    company_name: string;
    company_slug: string;
    company_logo_url: string | null;
    role: CompanyRole;
    invited_by_name: string | null;
    created_at: string;
    expires_at: string;
}

/** Pending invites addressed to the signed-in user. Returns [] when signed out. */
export async function getMyInvites(): Promise<MyInvite[]> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('get_my_invites');
    if (error) {
        console.error('Error loading invitations:', error);
        throw new Error('Failed to load your invitations. Please try again.');
    }
    return (data ?? []) as MyInvite[];
}

/**
 * Accept an invite. For a trekker account this is destructive and irreversible
 * from the app: account_type flips to 'company' and the trekker side of the
 * platform closes. `converted` says whether that happened, so the caller knows
 * whether to send them to the dashboard or just refresh the team.
 */
export async function acceptInvite(
    inviteId: string
): Promise<{ success: boolean; message: string; converted?: boolean }> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('accept_company_invite', { p_invite_id: inviteId });
    if (error) {
        return {
            success: false,
            message: inviteErrorMessage('accepting', error, 'Failed to accept the invitation. Please try again.'),
        };
    }
    return { success: true, message: 'Invitation accepted.', converted: data?.converted === true };
}

export async function declineInvite(
    inviteId: string
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const { error } = await supabase.rpc('decline_company_invite', { p_invite_id: inviteId });
    if (error) {
        return {
            success: false,
            message: inviteErrorMessage('declining', error, 'Failed to decline the invitation. Please try again.'),
        };
    }
    return { success: true, message: 'Invitation declined.' };
}

export async function updateMemberRole(
    memberId: string,
    role: 'admin' | 'staff'
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('company_members')
        .update({ role })
        .eq('id', memberId)
        .select('id');

    if (error) {
        console.error('Error updating member role:', error);
        return { success: false, message: 'Failed to update role. Please try again.' };
    }
    if (!data || data.length === 0) {
        return { success: false, message: "You can't change that member's role." };
    }
    return { success: true, message: 'Role updated.' };
}

export async function removeMember(
    memberId: string
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('company_members')
        .delete()
        .eq('id', memberId)
        .select('id');

    if (error) {
        console.error('Error removing member:', error);
        return { success: false, message: 'Failed to remove member. Please try again.' };
    }
    if (!data || data.length === 0) {
        return { success: false, message: "You can't remove that member." };
    }
    return { success: true, message: 'Member removed.' };
}

// ---- Platform admin (/admin) -----------------------------------------------
// Every read here relies on platform-admin RLS reach: "view companies" and
// "view treks" both include is_platform_admin(), so a platform admin sees every
// row without a dedicated RPC. Writes go through the approve/reject/suspend RPCs
// which re-check is_platform_admin() inside (defense in depth). Non-admins get
// empty reads and a raised error on the RPCs — this module never grants access,
// it just surfaces what the DB already allows.

export type CompanyStatusFilter = CompanyStatus | 'all';

// Company row with the approval-audit columns the admin detail view needs.
// The *_name fields are resolved from public_profiles by getAdminCompany only
// (list rows leave them undefined).
export interface AdminCompany extends Company {
    created_by: string;
    approved_by: string | null;
    approved_at: string | null;
    created_by_name?: string | null;
    approved_by_name?: string | null;
}

/**
 * Whether the signed-in user is a platform admin. Uses the SECURITY DEFINER
 * is_platform_admin() RPC — the only client-visible way to ask, since
 * platform_admins has no client select policy. Used to gate the /admin nav link;
 * the /admin layout re-checks server-side.
 */
export async function isPlatformAdmin(): Promise<boolean> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('is_platform_admin');
    if (error) {
        console.error('Error checking platform admin:', error);
        return false;
    }
    return data === true;
}

/**
 * Whether the signed-in user may act as a trekker (join/favourite treks, use the
 * customer-side pages). Company accounts get false; platform admins get true
 * regardless. Same predicate the RLS policies and join_trek_and_chat use, so the
 * UI can't promise something the database will refuse.
 */
export async function isTrekker(): Promise<boolean> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('is_trekker');
    if (error) {
        console.error('Error checking account type:', error);
        return false;
    }
    return data === true;
}

export type AccountType = 'trekker' | 'company';

/**
 * The signed-in user's raw account kind. Deliberately NOT the same question as
 * isTrekker(): that one answers "may act as a trekker" and is true for platform
 * admins whatever their type, which is what the page guards and Join buttons
 * want. This is the literal column, matching what apply_for_company() gates on —
 * so an admin who owns a company reads 'company' here and can still apply.
 * Returns null when signed out or unreadable.
 */
export async function getMyAccountType(): Promise<AccountType | null> {
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
        .from('profiles')
        .select('account_type')
        .eq('id', user.id)
        .maybeSingle();

    if (error) {
        console.error('Error loading account type:', error);
        return null;
    }
    return (data?.account_type as AccountType | undefined) ?? null;
}

export interface AdminOverview {
    pendingCompanies: number;
    totalCompanies: number;
    totalTreks: number;
    totalUsers: number;
}

/**
 * Platform-wide headline counts. Companies/treks are counted directly (admin
 * RLS returns every row); users come from public_profiles, the all-rows
 * projection, since profiles itself is own-row-only under RLS.
 */
export async function getAdminOverview(): Promise<AdminOverview> {
    const supabase = createClient();

    const [companies, pending, treks, users] = await Promise.all([
        supabase.from('companies').select('id', { count: 'exact', head: true }),
        supabase.from('companies').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('treks').select('id', { count: 'exact', head: true }),
        supabase.from('public_profiles').select('id', { count: 'exact', head: true }),
    ]);

    for (const res of [companies, pending, treks, users]) {
        if (res.error) {
            console.error('Error loading admin overview:', res.error);
            throw new Error('Failed to load overview. Please try again.');
        }
    }

    return {
        pendingCompanies: pending.count ?? 0,
        totalCompanies: companies.count ?? 0,
        totalTreks: treks.count ?? 0,
        totalUsers: users.count ?? 0,
    };
}

/** All companies (newest first), optionally filtered by status. Admin-only via RLS. */
export async function getAllCompanies(status: CompanyStatusFilter): Promise<AdminCompany[]> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('admin_list_companies', { p_status: status });
    if (error) {
        console.error('Error loading companies:', error);
        throw new Error('Failed to load companies. Please try again.');
    }
    return (data as AdminCompany[]) ?? [];
}

/** A single company with audit columns for the admin detail view. Null when not found. */
export async function getAdminCompany(companyId: string): Promise<AdminCompany | null> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('admin_get_company', { p_company_id: companyId });

    if (error) {
        console.error('Error loading company:', error);
        throw new Error('Failed to load company. Please try again.');
    }
    const rows = (data as AdminCompany[]) ?? [];
    if (rows.length === 0) return null;

    const company = rows[0];

    // Resolve applicant/approver names via public_profiles (the all-rows
    // projection). Decorative — a failure here shouldn't sink the page.
    const ids = [company.created_by, company.approved_by].filter(Boolean) as string[];
    if (ids.length > 0) {
        const { data: profiles, error: pErr } = await supabase
            .from('public_profiles')
            .select('id, full_name')
            .in('id', ids);
        if (pErr) {
            console.error('Error loading audit names:', pErr);
        } else {
            const names = new Map(
                ((profiles ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name])
            );
            company.created_by_name = names.get(company.created_by) ?? null;
            company.approved_by_name = company.approved_by ? names.get(company.approved_by) ?? null : null;
        }
    }

    return company;
}

export async function approveCompany(
    companyId: string
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const { error } = await supabase.rpc('approve_company', { p_company_id: companyId });
    if (error) {
        console.error('Error approving company:', error);
        return { success: false, message: 'Failed to approve company. Please try again.' };
    }
    return { success: true, message: 'Company approved.' };
}

export async function rejectCompany(
    companyId: string,
    reason: string
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const { error } = await supabase.rpc('reject_company', {
        p_company_id: companyId,
        p_reason: reason.trim() || null,
    });
    if (error) {
        console.error('Error rejecting company:', error);
        return { success: false, message: 'Failed to reject company. Please try again.' };
    }
    return { success: true, message: 'Company rejected.' };
}

export async function suspendCompany(
    companyId: string,
    reason: string
): Promise<{ success: boolean; message: string }> {
    const supabase = createClient();

    const { error } = await supabase.rpc('suspend_company', {
        p_company_id: companyId,
        p_reason: reason.trim() || null,
    });
    if (error) {
        console.error('Error suspending company:', error);
        return { success: false, message: 'Failed to suspend company. Please try again.' };
    }
    return { success: true, message: 'Company suspended.' };
}
