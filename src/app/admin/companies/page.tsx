'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Building2, Loader2, ChevronRight } from 'lucide-react';
import { useAdminCompanies } from '@/lib/queries';
import CompanyActions from '@/components/admin/CompanyActions';
import type { CompanyStatus, CompanyStatusFilter } from '@/lib/company';

const statusStyles: Record<CompanyStatus, string> = {
  approved: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-700',
  suspended: 'bg-gray-200 text-gray-700',
};

const filters: { value: CompanyStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
];

const isStatusFilter = (v: string | null): v is CompanyStatusFilter =>
  filters.some((f) => f.value === v);

function CompaniesList() {
  const searchParams = useSearchParams();
  const initial = searchParams.get('status');
  const [status, setStatus] = useState<CompanyStatusFilter>(
    isStatusFilter(initial) ? initial : 'all'
  );

  const { data: companies, isLoading, isError } = useAdminCompanies(status);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Companies</h1>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatus(f.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              status === f.value
                ? 'bg-indigo-600 text-white'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t load companies. Please refresh.
        </p>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !companies || companies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No companies in this view.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {companies.map((company) => (
            <li
              key={company.id}
              className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <Link
                  href={`/admin/companies/${company.id}`}
                  className="group flex min-w-0 flex-1 items-center gap-4"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100">
                    {company.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={company.logo_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Building2 className="h-5 w-5 text-gray-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-gray-900 group-hover:text-indigo-700">
                        {company.name}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusStyles[company.status]}`}
                      >
                        {company.status}
                      </span>
                    </div>
                    <p className="truncate text-sm text-gray-500">
                      /company/{company.slug} · applied{' '}
                      {new Date(company.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-gray-300 group-hover:text-indigo-400" />
                </Link>
              </div>

              <CompanyActions companyId={company.id} status={company.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminCompaniesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <CompaniesList />
    </Suspense>
  );
}
