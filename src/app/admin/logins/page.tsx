'use client';

import { useState } from 'react';
import { KeyRound, Loader2, Search } from 'lucide-react';
import { useAdminLoginEvents } from '@/lib/queries';
import { LOGIN_EVENTS_PAGE_SIZE } from '@/lib/loginEvents';
import { deviceLabel } from '@/lib/deviceLabel';
import { accountTypeLabel, formatDuration, methodLabel } from '@/lib/loginEventFormat';

const formatTime = (iso: string) => new Date(iso).toLocaleString();

export default function AdminLoginsPage() {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading, isError, isFetching } = useAdminLoginEvents(search, page);

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / LOGIN_EVENTS_PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Login activity</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every sign-in, newest first. Kept for 180 days.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(draft);
          setPage(0);
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search by email"
            className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          Search
        </button>
      </form>

      {isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t load login activity. Please refresh.
        </p>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <KeyRound className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">
            {search ? 'No sign-ins match that email.' : 'No sign-ins recorded yet.'}
          </p>
        </div>
      ) : (
        <>
          <div className={`overflow-x-auto rounded-2xl border border-gray-200 bg-white ${isFetching ? 'opacity-60' : ''}`}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Signed in</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Signed out</th>
                  <th className="px-4 py-3 font-medium">IP address</th>
                  <th className="px-4 py-3 font-medium">Device</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                      {row.email ?? '—'}
                      {row.is_new_device && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                          New device
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">{accountTypeLabel(row.account_type)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">{methodLabel(row.method)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatTime(row.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                      {formatDuration(row.created_at, row.ended_at ?? row.last_seen_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                      {row.ended_at ? (
                        formatTime(row.ended_at)
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-700">{row.ip ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700" title={row.user_agent ?? undefined}>
                      {deviceLabel(row.user_agent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>
              {total} sign-in{total === 1 ? '' : 's'} · page {page + 1} of {pageCount}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
                className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page + 1 >= pageCount}
                className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
