import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import type { CompanyStatus } from '@/lib/company';
import DashboardShell from '@/components/admin/DashboardShell';

interface MembershipStatusRow {
  companies: { status: CompanyStatus } | { status: CompanyStatus }[] | null;
}

// Server-side counterpart of useRequireAuth for the company dashboard: the
// middleware only guarantees a session, this layout additionally requires a
// company membership before any /dashboard page renders. RLS scopes the query
// to the caller, so a forged request can't see anyone else's memberships.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data, error } = await supabase
    .from('company_members')
    .select('companies ( status )')
    .eq('user_id', user.id);

  if (error) {
    console.error('Error loading company memberships:', error);
    redirect('/');
  }

  const statuses = ((data ?? []) as unknown as MembershipStatusRow[]).flatMap(
    (row) =>
      (Array.isArray(row.companies)
        ? row.companies
        : row.companies
          ? [row.companies]
          : []
      ).map((c) => c.status)
  );

  if (statuses.length === 0) redirect('/company/apply');

  // Status messaging (pending/rejected/suspended banner) lives in
  // DashboardShell, which knows the active company and its rejection reason.
  return <DashboardShell>{children}</DashboardShell>;
}
