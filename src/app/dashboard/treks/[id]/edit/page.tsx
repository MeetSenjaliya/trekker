'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useDashboardCompany } from '@/components/admin/DashboardShell';
import { useTrek } from '@/lib/queries';
import TrekForm from '@/components/admin/TrekForm';

export default function EditTrekPage() {
  const params = useParams<{ id: string }>();
  const { companies } = useDashboardCompany();
  const { data: trek, isLoading, isError } = useTrek(params.id);

  // Edit is scoped to the trek's owner, not the sidebar's active company, so a
  // member of multiple companies can edit any of their treks by direct link.
  const owner = trek ? companies.find((m) => m.company.id === trek.company_id) : undefined;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/dashboard/treks"
          className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to treks
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Edit trek</h1>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : isError || !trek ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          This trek couldn&apos;t be found.
        </p>
      ) : !owner ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You don&apos;t have access to edit this trek.
        </p>
      ) : owner.company.status !== 'approved' ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This trek can&apos;t be edited while {owner.company.name} is{' '}
          {owner.company.status}.
        </p>
      ) : (
        <TrekForm companyId={trek.company_id} trek={trek} />
      )}
    </div>
  );
}
