'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Users, ShieldAlert, Megaphone, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useDashboardCompany } from '@/components/admin/DashboardShell';
import {
  useTrek,
  useTrekBatches,
  useBatchParticipants,
  useBatchAnnouncements,
  queryKeys,
} from '@/lib/queries';
import { announcementSchema } from '@/lib/schemas';
import { postBatchAnnouncement } from '@/lib/company';

export default function TrekParticipantsPage() {
  const params = useParams<{ id: string }>();
  const trekId = params.id;
  const { companies } = useDashboardCompany();
  const queryClient = useQueryClient();

  const { data: trek, isLoading: trekLoading } = useTrek(trekId);
  const { data: batches, isLoading: batchesLoading } = useTrekBatches(trekId);

  const [batchId, setBatchId] = useState<string>('');
  useEffect(() => {
    if (!batchId && batches && batches.length > 0) setBatchId(batches[0].id);
  }, [batches, batchId]);

  const { data: participants, isLoading, isError } = useBatchParticipants(batchId || undefined);
  const { data: announcements, isLoading: annLoading } = useBatchAnnouncements(batchId || undefined);

  const owner = trek ? companies.find((m) => m.company.id === trek.company_id) : undefined;
  // Reading the roster stays open to any member; sending needs the company approved,
  // matching post_batch_announcement() and the departures page.
  const canAnnounce = owner?.company.status === 'approved';

  const [text, setText] = useState('');
  const [textError, setTextError] = useState('');
  const [sending, setSending] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = announcementSchema.safeParse(text);
    if (!parsed.success) {
      setTextError(parsed.error.issues[0]?.message ?? 'Invalid announcement');
      return;
    }
    setTextError('');
    setSending(true);
    const res = await postBatchAnnouncement(batchId, parsed.data);
    setSending(false);
    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    setText('');
    queryClient.invalidateQueries({ queryKey: queryKeys.batchAnnouncements(batchId) });
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link
          href="/dashboard/treks"
          className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to treks
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Roster</h1>
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
      ) : !owner ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You don&apos;t have access to this trek&apos;s roster.
        </p>
      ) : batchesLoading ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !batches || batches.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No departures yet. Add one to start taking bookings.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            Participant contact details are confidential — use them only for organising this trek.
          </div>

          <div>
            <label htmlFor="batch" className="mb-1 block text-sm font-medium text-gray-700">
              Departure
            </label>
            <select
              id="batch"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="w-full max-w-xs rounded-xl border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {new Date(b.batch_date).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}{' '}
                  ({b.confirmed_count} confirmed)
                </option>
              ))}
            </select>
          </div>

          {isError ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Couldn&apos;t load participants. Please refresh.
            </p>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !participants || participants.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
              <Users className="mx-auto h-8 w-8 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">No one has booked this departure yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Emergency contact</th>
                    <th className="px-4 py-3">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {participants.map((p) => (
                    <tr key={p.participant_id}>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {p.full_name || 'Unnamed trekker'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                            p.status === 'confirmed'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{p.phone_no || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {p.emergency_contact || p.emergency_no ? (
                          <span>
                            {p.emergency_contact || '—'}
                            {p.emergency_no ? ` · ${p.emergency_no}` : ''}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(p.joined_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-bold text-gray-900">Announcements</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Posted into this departure&apos;s group chat, where everyone with a confirmed
              booking will see it. Trekkers can&apos;t reply to you here.
            </p>

            {!canAnnounce ? (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Announcements can&apos;t be sent while {owner.company.name} is{' '}
                {owner.company.status}.
              </p>
            ) : (
              <form onSubmit={send} className="mt-4" noValidate>
                <label htmlFor="announcement" className="sr-only">
                  Announcement
                </label>
                <textarea
                  id="announcement"
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="e.g. Pickup moved to the north gate, 6am sharp."
                  className="block w-full resize-y rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
                />
                {textError && <p className="mt-1.5 text-sm text-red-600">{textError}</p>}
                <div className="mt-2 flex items-center justify-between gap-4">
                  <span className="text-xs text-gray-400">{text.trim().length}/2000</span>
                  {/* No client-side "has bookings" gate: the chat only exists once
                      someone is CONFIRMED, so a waitlist-only departure has a
                      non-empty roster and still nowhere to post. The RPC owns that
                      rule and says so. */}
                  <button
                    type="submit"
                    disabled={sending || !text.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send
                  </button>
                </div>
              </form>
            )}

            {annLoading ? (
              <div className="flex items-center justify-center py-6 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : announcements && announcements.length > 0 ? (
              <ul className="mt-5 space-y-3 border-t border-gray-100 pt-5">
                {announcements.map((a) => (
                  <li key={a.id} className="rounded-xl bg-gray-50 px-4 py-3">
                    <p className="whitespace-pre-wrap text-sm text-gray-800">{a.message}</p>
                    <p className="mt-1.5 text-xs text-gray-400">
                      {a.author_name || 'Team member'} ·{' '}
                      {new Date(a.created_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 border-t border-gray-100 pt-5 text-sm text-gray-500">
                Nothing sent to this departure yet.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
