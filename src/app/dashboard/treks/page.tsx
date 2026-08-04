'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, Mountain, Users, CalendarDays, Pencil, Archive, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useDashboardCompany } from '@/components/admin/DashboardShell';
import { useCompanyTreks } from '@/lib/queries';
import { setTrekActive } from '@/lib/company';

export default function DashboardTreksPage() {
  const { company } = useDashboardCompany();
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: treks, isLoading, isError } = useCompanyTreks(company?.id, includeArchived);

  if (!company) return null;

  const canCreate = company.status === 'approved';

  const toggleActive = async (id: string, next: boolean) => {
    setBusyId(id);
    const res = await setTrekActive(id, next);
    setBusyId(null);
    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    queryClient.invalidateQueries({ queryKey: ['companies', company.id, 'treks'] });
    queryClient.invalidateQueries({ queryKey: ['companies', company.id, 'overview'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Treks</h1>
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

      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        Show archived treks
      </label>

      {isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t load your treks. Please refresh.
        </p>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !treks || treks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <Mountain className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            {includeArchived || !canCreate
              ? 'No treks yet.'
              : 'No active treks. Create one to get started.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {treks.map((trek) => (
            <li
              key={trek.id}
              className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                  {trek.cover_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={trek.cover_image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Mountain className="h-6 w-6 text-gray-300" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-gray-900">{trek.title}</p>
                    {!trek.is_active && (
                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                        Archived
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-gray-500">
                    {trek.location || 'No location'} · {trek.difficulty}
                  </p>
                  <p className="text-xs text-gray-400">
                    {trek.participants_joined ?? 0}
                    {trek.max_participants ? ` / ${trek.max_participants}` : ''} booked
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/dashboard/treks/${trek.id}/batches`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <CalendarDays className="h-4 w-4" />
                  Departures
                </Link>
                <Link
                  href={`/dashboard/treks/${trek.id}/participants`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <Users className="h-4 w-4" />
                  Roster
                </Link>
                <Link
                  href={`/dashboard/treks/${trek.id}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
                <button
                  type="button"
                  onClick={() => toggleActive(trek.id, !trek.is_active)}
                  disabled={busyId === trek.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
                >
                  {busyId === trek.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : trek.is_active ? (
                    <Archive className="h-4 w-4" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  {trek.is_active ? 'Archive' : 'Restore'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
