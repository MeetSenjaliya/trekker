'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useDashboardCompany } from '@/components/admin/DashboardShell';
import { useTrek, useTrekBatches, queryKeys } from '@/lib/queries';
import { batchSchema, fieldErrors } from '@/lib/schemas';
import { createBatch, deleteBatch } from '@/lib/company';

export default function TrekBatchesPage() {
  const params = useParams<{ id: string }>();
  const trekId = params.id;
  const { companies } = useDashboardCompany();
  const queryClient = useQueryClient();

  const { data: trek, isLoading: trekLoading } = useTrek(trekId);
  const { data: batches, isLoading, isError } = useTrekBatches(trekId);

  const [form, setForm] = useState({ batchDate: '', maxParticipants: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const owns = !!trek && companies.some((m) => m.company.id === trek.company_id);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.trekBatches(trekId) });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = batchSchema.safeParse(form);
    if (!result.success) {
      setErrors(fieldErrors(result.error));
      return;
    }
    setAdding(true);
    const res = await createBatch(trekId, {
      batchDate: result.data.batchDate,
      maxParticipants: result.data.maxParticipants,
    });
    setAdding(false);
    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    setForm({ batchDate: '', maxParticipants: '' });
    setErrors({});
    refresh();
  };

  const remove = async (batchId: string) => {
    setBusyId(batchId);
    const res = await deleteBatch(batchId);
    setBusyId(null);
    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    refresh();
  };

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
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Departures</h1>
        {trek && <p className="text-sm text-gray-500">{trek.title}</p>}
      </div>

      {trekLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !trek ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          This trek couldn&apos;t be found.
        </p>
      ) : !owns ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You don&apos;t have access to manage this trek&apos;s departures.
        </p>
      ) : (
        <>
          <form onSubmit={add} className="rounded-2xl border border-gray-200 bg-white p-5" noValidate>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex-1">
                <label htmlFor="batchDate" className="mb-1 block text-sm font-medium text-gray-700">
                  Departure date *
                </label>
                <input
                  id="batchDate"
                  type="date"
                  value={form.batchDate}
                  onChange={(e) => setForm((p) => ({ ...p, batchDate: e.target.value }))}
                  className="block w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
                />
                {errors.batchDate && <p className="mt-1.5 text-sm text-red-600">{errors.batchDate}</p>}
              </div>
              <div className="flex-1">
                <label htmlFor="maxParticipants" className="mb-1 block text-sm font-medium text-gray-700">
                  Capacity
                </label>
                <input
                  id="maxParticipants"
                  inputMode="numeric"
                  placeholder={trek.max_participants ? String(trek.max_participants) : 'e.g. 15'}
                  value={form.maxParticipants}
                  onChange={(e) => setForm((p) => ({ ...p, maxParticipants: e.target.value }))}
                  className="block w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
                />
                {errors.maxParticipants && (
                  <p className="mt-1.5 text-sm text-red-600">{errors.maxParticipants}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={adding}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 sm:mt-6"
              >
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add
              </button>
            </div>
          </form>

          {isError ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Couldn&apos;t load departures. Please refresh.
            </p>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !batches || batches.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              No departures scheduled yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {batches.map((batch) => (
                <li
                  key={batch.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {new Date(batch.batch_date).toLocaleDateString(undefined, {
                        weekday: 'short',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                    <p className="text-sm text-gray-500">
                      {batch.confirmed_count}
                      {batch.max_participants ? ` / ${batch.max_participants}` : ''} confirmed
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/dashboard/treks/${trekId}/participants`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <Users className="h-4 w-4" />
                      Roster
                    </Link>
                    <button
                      type="button"
                      onClick={() => remove(batch.id)}
                      disabled={busyId === batch.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
                    >
                      {busyId === batch.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
