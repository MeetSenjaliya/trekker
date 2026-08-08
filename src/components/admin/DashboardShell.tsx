'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Mountain,
  Users,
  Settings,
  UserCircle,
  Building2,
  Loader2,
  Clock,
  XCircle,
  Ban,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMyCompanies } from '@/lib/queries';
import type { Company, CompanyRole } from '@/lib/company';

interface DashboardCompanyValue {
  company: Company | undefined;
  role: CompanyRole | undefined;
  companies: { role: CompanyRole; company: Company }[];
  setCompanyId: (id: string) => void;
  loading: boolean;
}

const DashboardCompanyContext = createContext<DashboardCompanyValue | undefined>(undefined);

/**
 * Active-company state for the whole dashboard. A user can belong to more than
 * one company; we keep one active at a time (persisted so it survives reloads)
 * and expose the caller's role in it for the role-gated pages.
 */
export function useDashboardCompany(): DashboardCompanyValue {
  const ctx = useContext(DashboardCompanyContext);
  if (!ctx) throw new Error('useDashboardCompany must be used inside DashboardShell');
  return ctx;
}

const STORAGE_KEY = 'trekker.dashboard.companyId';

/**
 * Status banner for the active (non-approved) company. Lives here rather than
 * the server layout so it tracks the company selected in the switcher and can
 * show its rejection/suspension reason, not just "some membership isn't
 * approved".
 */
function CompanyStatusBanner({ company }: { company: Company }) {
  if (company.status === 'approved') return null;

  if (company.status === 'pending') {
    return (
      <div className="mb-6 flex items-start gap-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 p-4 sm:p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100">
          <Clock className="h-5 w-5 text-amber-600" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-amber-900">Application under review</p>
          <p className="mt-0.5 text-sm text-amber-800">
            A platform admin is reviewing <strong>{company.name}</strong>. You can set
            everything up in the meantime — your treks stay hidden from the public
            catalogue until you&apos;re approved.
          </p>
        </div>
      </div>
    );
  }

  if (company.status === 'rejected') {
    return (
      <div className="mb-6 flex items-start gap-4 rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 via-red-50 to-rose-50 p-4 sm:p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100">
          <XCircle className="h-5 w-5 text-rose-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-rose-900">Application rejected</p>
          <p className="mt-0.5 text-sm text-rose-800">
            <strong>{company.name}</strong> wasn&apos;t approved this time, so its treks
            won&apos;t appear in the public catalogue.
          </p>
          {company.rejection_reason && (
            <blockquote className="mt-3 rounded-xl border border-rose-100 bg-white/70 px-4 py-3 text-sm italic text-rose-900">
              &ldquo;{company.rejection_reason}&rdquo;
            </blockquote>
          )}
          <Link
            href="/company/apply"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-700"
          >
            Submit a new application
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 flex items-start gap-4 rounded-2xl border border-slate-300 bg-gradient-to-r from-slate-100 via-gray-50 to-slate-100 p-4 sm:p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-200">
        <Ban className="h-5 w-5 text-slate-600" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-slate-900">Company suspended</p>
        <p className="mt-0.5 text-sm text-slate-700">
          <strong>{company.name}</strong> has been suspended by a platform admin. Your
          treks are hidden from the public catalogue; existing bookings and chats are
          unaffected.
        </p>
        {company.rejection_reason && (
          <blockquote className="mt-3 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm italic text-slate-800">
            &ldquo;{company.rejection_reason}&rdquo;
          </blockquote>
        )}
        <p className="mt-2 text-xs text-slate-500">
          If you think this is a mistake, contact the platform admin.
        </p>
      </div>
    </div>
  );
}

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/treks', label: 'Treks', icon: Mountain, exact: false },
  { href: '/dashboard/team', label: 'Team', icon: Users, exact: false },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings, exact: false },
  // Company settings are owner/admin only; this is the personal-account page
  // every member needs, since company accounts have no /profile/edit.
  { href: '/dashboard/account', label: 'My account', icon: UserCircle, exact: false },
];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { data: memberships = [], isPending } = useMyCompanies(user?.id);
  const pathname = usePathname();

  // While auth is still resolving the user, useMyCompanies is disabled
  // (enabled: !!userId). A disabled TanStack Query v5 query reports
  // isLoading:false, so we key "loading" off authLoading || isPending —
  // otherwise role-gated pages would bounce before memberships ever fetch.
  const loading = authLoading || isPending;

  const [companyId, setCompanyIdState] = useState<string | null>(null);

  useEffect(() => {
    if (memberships.length === 0) return;
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    const valid = stored && memberships.some((m) => m.company.id === stored) ? stored : memberships[0].company.id;
    setCompanyIdState(valid);
  }, [memberships]);

  const setCompanyId = (id: string) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id);
    setCompanyIdState(id);
  };

  const active = useMemo(
    () => memberships.find((m) => m.company.id === companyId) ?? memberships[0],
    [memberships, companyId]
  );

  const value: DashboardCompanyValue = {
    company: active?.company,
    role: active?.role,
    companies: memberships,
    setCompanyId,
    loading,
  };

  return (
    <DashboardCompanyContext.Provider value={value}>
      <div className="min-h-screen" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-24 pb-6">
        {!loading && active && <CompanyStatusBanner company={active.company} />}
        <div className="flex flex-col md:flex-row gap-6 md:gap-8">
          <aside className="md:w-60 md:shrink-0">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 md:sticky md:top-6">
              <div className="mb-4 flex items-center gap-3 border-b border-gray-100 pb-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-100">
                  {active?.company.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={active.company.logo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Building2 className="h-5 w-5 text-blue-600" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {active?.company.name ?? 'Your company'}
                  </p>
                  <p className="text-xs capitalize text-gray-500">{active?.role ?? '—'}</p>
                </div>
              </div>

              {memberships.length > 1 && (
                <div className="mb-4">
                  <label htmlFor="company-switch" className="sr-only">
                    Switch company
                  </label>
                  <select
                    id="company-switch"
                    value={active?.company.id ?? ''}
                    onChange={(e) => setCompanyId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
                  >
                    {memberships.map((m) => (
                      <option key={m.company.id} value={m.company.id}>
                        {m.company.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <nav className="flex gap-1 overflow-x-auto md:flex-col">
                {navItems.map((item) => {
                  const activeLink = item.exact
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        activeLink
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
      </div>
    </DashboardCompanyContext.Provider>
  );
}
