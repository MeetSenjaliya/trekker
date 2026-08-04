'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { CompanyRole } from '@/lib/company';
import { useDashboardCompany } from '@/components/admin/DashboardShell';

// Client-side role guard for dashboard pages restricted to certain company
// roles (e.g. team/settings are owner/admin only). Mirrors useRequireAuth: the
// server layout already gates membership, this bounces a member who lacks the
// required role — including live if their role changes in another tab.
export function useRequireCompanyRole(allowed: CompanyRole[]) {
  const { role, loading } = useDashboardCompany();
  const router = useRouter();

  const permitted = !!role && allowed.includes(role);

  useEffect(() => {
    if (!loading && !permitted) router.replace('/dashboard');
  }, [loading, permitted, router]);

  return { permitted, loading };
}
