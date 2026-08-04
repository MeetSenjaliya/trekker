'use client';

import Link from 'next/link';
import { Mountain, CalendarDays, Users, Plus, Loader2, ArrowRight } from 'lucide-react';
import { useDashboardCompany } from '@/components/admin/DashboardShell';
import { useCompanyOverview } from '@/lib/queries';
import type { CompanyStatus } from '@/lib/company';

const statusStyles: Record<CompanyStatus, string> = {
  approved: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-700',
  suspended: 'bg-gray-200 text-gray-700',
};

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | undefined;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
          <Icon className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

export default function DashboardOverviewPage() {
  const { company } = useDashboardCompany();
  const { data, isLoading, isError } = useCompanyOverview(company?.id);

  if (!company) return null;

  const canCreate = company.status === 'approved';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{company.name}</h1>
          <span
            className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusStyles[company.status]}`}
          >
            {company.status}
          </span>
        </div>
        {canCreate && (
          <Link
            href="/dashboard/treks/new"
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New trek
          </Link>
        )}
      </div>

      {isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t load your overview. Please refresh.
        </p>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Active treks" value={data?.activeTreks} icon={Mountain} />
            <StatCard label="Upcoming departures" value={data?.upcomingBatches} icon={CalendarDays} />
            <StatCard label="Confirmed bookings" value={data?.confirmedBookings} icon={Users} />
          </div>

          {data && data.totalTreks === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
              <Mountain className="mx-auto h-10 w-10 text-gray-300" />
              <h2 className="mt-3 text-lg font-semibold text-gray-900">No treks yet</h2>
              <p className="mt-1 text-sm text-gray-500">
                {canCreate
                  ? 'Create your first trek to start taking bookings.'
                  : 'You can add treks once your company is approved.'}
              </p>
              {canCreate && (
                <Link
                  href="/dashboard/treks/new"
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  Create a trek
                </Link>
              )}
            </div>
          ) : (
            <Link
              href="/dashboard/treks"
              className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm font-medium text-gray-700 transition-colors hover:border-blue-300 hover:text-blue-700"
            >
              Manage your treks and departures
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </>
      )}
    </div>
  );
}
