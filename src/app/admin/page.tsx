'use client';

import Link from 'next/link';
import { Clock, Building2, Mountain, Users, Loader2, ArrowRight } from 'lucide-react';
import { useAdminOverview } from '@/lib/queries';

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | undefined;
  icon: React.ComponentType<{ className?: string }>;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            accent ? 'bg-amber-50' : 'bg-indigo-50'
          }`}
        >
          <Icon className={`h-5 w-5 ${accent ? 'text-amber-600' : 'text-indigo-600'}`} />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

export default function AdminOverviewPage() {
  const { data, isLoading, isError } = useAdminOverview();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Platform overview</h1>

      {isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t load the overview. Please refresh.
        </p>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Pending review" value={data?.pendingCompanies} icon={Clock} accent />
            <StatCard label="Companies" value={data?.totalCompanies} icon={Building2} />
            <StatCard label="Treks" value={data?.totalTreks} icon={Mountain} />
            <StatCard label="Users" value={data?.totalUsers} icon={Users} />
          </div>

          {data && data.pendingCompanies > 0 ? (
            <Link
              href="/admin/companies?status=pending"
              className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100"
            >
              {data.pendingCompanies} application{data.pendingCompanies === 1 ? '' : 's'} waiting for review
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <Link
              href="/admin/companies"
              className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm font-medium text-gray-700 transition-colors hover:border-indigo-300 hover:text-indigo-700"
            >
              Manage all companies
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </>
      )}
    </div>
  );
}
