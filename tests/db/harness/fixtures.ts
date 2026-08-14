import type { PGlite } from '@electric-sql/pglite'

/**
 * Fixed UUIDs so a failure message names something you can grep for. The last
 * group is a readable tag; the rest is padding to keep them valid v4 UUIDs.
 */
export const ids = {
  user: {
    trekkerA: '00000000-0000-4000-8000-00000000a001',
    trekkerB: '00000000-0000-4000-8000-00000000b001',
    ownerApproved: '00000000-0000-4000-8000-00000000c001',
    staffApproved: '00000000-0000-4000-8000-00000000c002',
    ownerPending: '00000000-0000-4000-8000-00000000d001',
    ownerSuspended: '00000000-0000-4000-8000-00000000e001',
    platformAdmin: '00000000-0000-4000-8000-00000000f001',
    outsiderCompany: '00000000-0000-4000-8000-00000000c009',
  },
  company: {
    approved: '00000000-0000-4000-8000-0000000ca001',
    pending: '00000000-0000-4000-8000-0000000ca002',
    suspended: '00000000-0000-4000-8000-0000000ca003',
    rejected: '00000000-0000-4000-8000-0000000ca004',
  },
  trek: {
    approvedActive: '00000000-0000-4000-8000-00000d7e0001',
    approvedArchived: '00000000-0000-4000-8000-00000d7e0002',
    suspendedActive: '00000000-0000-4000-8000-00000d7e0003',
    pendingActive: '00000000-0000-4000-8000-00000d7e0004',
  },
  batch: {
    approvedActive: '00000000-0000-4000-8000-00000ba70001',
    approvedArchived: '00000000-0000-4000-8000-00000ba70002',
    suspendedActive: '00000000-0000-4000-8000-00000ba70003',
  },
  conversation: {
    approvedActive: '00000000-0000-4000-8000-00000c0a0001',
  },
} as const

/**
 * The world every db test asserts against:
 *
 *   Summit Co   (approved)  — owner: ownerApproved, staff: staffApproved
 *     "Ridge Walk"     active   → batch, trekkerA has a confirmed booking
 *     "Old Pass"       archived (is_active = false)
 *   Pending Co  (pending)   — owner: ownerPending
 *     "Unlisted Climb" active
 *   Frozen Co   (suspended) — owner: ownerSuspended
 *     "Taken Down"     active   → batch, trekkerA has a confirmed booking
 *   Rejected Co (rejected)  — owner: ownerSuspended (reapplied and was refused)
 *
 * trekkerB is the outsider: signed in, member of nothing, booked nothing. Most
 * negative assertions are written from trekkerB's seat.
 *
 * trekkerA deliberately holds a booking on the SUSPENDED company's trek. That
 * is the interesting case for search: is_trek_visible() lets a participant keep
 * reading their own booking history after a company is frozen, so RLS alone
 * would still surface that trek. Only search_treks()' own `c.status =
 * 'approved'` filter takes it out of the catalogue. A fixture where nobody had
 * booked the frozen trek would let that filter be deleted with tests still green.
 */
export async function seed(db: PGlite): Promise<void> {
  const u = ids.user
  const c = ids.company
  const t = ids.trek
  const b = ids.batch

  // Profiles are created by the on_auth_user_created trigger, so users go in
  // first and profile rows appear as a side effect — the real signup path.
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${u.trekkerA}',        'trekker.a@example.test',    '{"full_name":"Trekker A"}'),
      ('${u.trekkerB}',        'trekker.b@example.test',    '{"full_name":"Trekker B"}'),
      ('${u.ownerApproved}',   'owner.summit@example.test', '{"full_name":"Summit Owner"}'),
      ('${u.staffApproved}',   'staff.summit@example.test', '{"full_name":"Summit Staff"}'),
      ('${u.ownerPending}',    'owner.pending@example.test','{"full_name":"Pending Owner"}'),
      ('${u.ownerSuspended}',  'owner.frozen@example.test', '{"full_name":"Frozen Owner"}'),
      ('${u.platformAdmin}',   'admin@example.test',        '{"full_name":"Platform Admin"}'),
      ('${u.outsiderCompany}', 'other.co@example.test',     '{"full_name":"Other Co Owner"}');
  `)

  // account_type is pinned by trg_protect_profile_account_type, which no-ops
  // when auth.uid() is null. Seeding runs with no JWT claims, so this is the
  // same branch the SQL Editor takes — no escape-hatch GUC needed.
  await db.exec(`
    update public.profiles set account_type = 'company'
     where id in ('${u.ownerApproved}', '${u.staffApproved}', '${u.ownerPending}',
                  '${u.ownerSuspended}', '${u.outsiderCompany}');
  `)

  await db.exec(`insert into public.platform_admins (user_id) values ('${u.platformAdmin}');`)

  await db.exec(`
    insert into public.companies (id, name, slug, status, created_by, approved_by, approved_at, rejection_reason) values
      ('${c.approved}',  'Summit Co',   'summit-co',   'approved',  '${u.ownerApproved}',  '${u.platformAdmin}', now(), null),
      ('${c.pending}',   'Pending Co',  'pending-co',  'pending',   '${u.ownerPending}',   null, null, null),
      ('${c.suspended}', 'Frozen Co',   'frozen-co',   'suspended', '${u.ownerSuspended}', '${u.platformAdmin}', now(), 'policy breach'),
      ('${c.rejected}',  'Rejected Co', 'rejected-co', 'rejected',  '${u.outsiderCompany}',null, null, 'incomplete application');

    insert into public.company_members (company_id, user_id, role) values
      ('${c.approved}',  '${u.ownerApproved}',   'owner'),
      ('${c.approved}',  '${u.staffApproved}',   'staff'),
      ('${c.pending}',   '${u.ownerPending}',    'owner'),
      ('${c.suspended}', '${u.ownerSuspended}',  'owner'),
      ('${c.rejected}',  '${u.outsiderCompany}', 'owner');
  `)

  await db.exec(`
    insert into public.treks (id, title, description, location, difficulty, distance_km,
                              estimated_cost, max_participants, company_id, is_active) values
      ('${t.approvedActive}',   'Ridge Walk',     'A sunny ridge traverse', 'Manali',  'Moderate', 12, 2000, 10, '${c.approved}',  true),
      ('${t.approvedArchived}', 'Old Pass',       'Retired route',          'Manali',  'Hard',     20, 5000, 10, '${c.approved}',  false),
      ('${t.suspendedActive}',  'Taken Down',     'Frozen tenant route',    'Shimla',  'Easy',      5, 1000, 10, '${c.suspended}', true),
      ('${t.pendingActive}',    'Unlisted Climb', 'Not yet approved',       'Kasol',   'Expert',   30, 9000, 10, '${c.pending}',   true);

    insert into public.trek_batches (id, trek_id, batch_date, max_participants) values
      ('${b.approvedActive}',   '${t.approvedActive}',   current_date + 30, 10),
      ('${b.approvedArchived}', '${t.approvedArchived}', current_date + 30, 10),
      ('${b.suspendedActive}',  '${t.suspendedActive}',  current_date + 30, 10);

    insert into public.trek_participants (user_id, batch_id, status) values
      ('${u.trekkerA}', '${b.approvedActive}',  'confirmed'),
      ('${u.trekkerA}', '${b.suspendedActive}', 'confirmed');
  `)

  // The batch chat trekkerA's booking entitles them to. trekkerB is not in it —
  // chat is where the sharpest read leak would be, so the outsider must be a
  // genuine outsider here.
  await db.exec(`
    insert into public.conversations (id, batch_id, name)
    values ('${ids.conversation.approvedActive}', '${b.approvedActive}', 'Ridge Walk chat');

    insert into public.conversation_participants (conversation_id, user_id)
    values ('${ids.conversation.approvedActive}', '${u.trekkerA}');

    insert into public.conversation_messages (conversation_id, user_id, message, is_announcement) values
      ('${ids.conversation.approvedActive}', '${u.trekkerA}', 'See you at the trailhead', false),
      ('${ids.conversation.approvedActive}', '${u.ownerApproved}', 'Departure moved to 6am', true);
  `)
}
