'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Loader2, MailOpen, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useMyInvites, useAccountType, queryKeys } from '@/lib/queries';
import { acceptInvite, declineInvite } from '@/lib/company';

// Deliberately NOT in the (trekker) route group. The invitee is a trekker when
// they open this page and a company account the moment they accept, so the
// group's is_trekker() guard would bounce them out of their own flow halfway
// through. Company accounts land here too — they can be invited to a second
// team, which costs them nothing.
export default function InvitesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: invites, isLoading, isError } = useMyInvites(user?.id);
  const { data: accountType } = useAccountType(user?.id);
  const isTrekker = accountType === 'trekker';

  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const accept = async (inviteId: string) => {
    setBusyId(inviteId);
    const res = await acceptInvite(inviteId);
    setBusyId(null);
    setConfirmingId(null);

    if (!res.success) {
      toast.error(res.message);
      queryClient.invalidateQueries({ queryKey: queryKeys.myInvites(user!.id) });
      return;
    }

    // Accepting changes what this account is allowed to do, so every cached
    // answer about it is now wrong.
    queryClient.invalidateQueries({ queryKey: queryKeys.myInvites(user!.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.myCompanies(user!.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.isTrekker(user!.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.accountType(user!.id) });

    toast.success(res.message);
    router.push('/dashboard');
  };

  const decline = async (inviteId: string) => {
    setBusyId(inviteId);
    const res = await declineInvite(inviteId);
    setBusyId(null);
    setConfirmingId(null);
    if (!res.success) {
      toast.error(res.message);
    } else {
      toast.success(res.message);
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.myInvites(user!.id) });
  };

  if (loading) return null;

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 pt-24 pb-12 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-md space-y-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
            <MailOpen className="h-8 w-8 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">
              Team invitations
            </h1>
            <p className="mt-2 text-gray-600">
              Sign in to see invitations sent to your Trek Buddies account.
            </p>
          </div>
          <Link
            href="/auth/login"
            className="inline-flex justify-center rounded-full bg-blue-600 px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-24 pb-12 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team invitations</h1>
          <p className="mt-1 text-sm text-gray-600">
            Trek companies that have asked you to join their team.
          </p>
        </div>

        {isError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Couldn&apos;t load your invitations. Please refresh.
          </p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !invites || invites.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center">
            <MailOpen className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-3 font-medium text-gray-900">No pending invitations</p>
            <p className="mt-1 text-sm text-gray-500">
              When a trek company invites you to their team, it&apos;ll show up here.
            </p>
          </div>
        ) : (
          invites.map((invite) => {
            const busy = busyId === invite.invite_id;
            const confirming = confirmingId === invite.invite_id;
            return (
              <div
                key={invite.invite_id}
                className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100">
                    {invite.company_logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={invite.company_logo_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Building2 className="h-6 w-6 text-gray-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-900">{invite.company_name}</p>
                    <p className="text-sm text-gray-500">
                      {invite.invited_by_name
                        ? `${invite.invited_by_name} invited you`
                        : 'You were invited'}{' '}
                      as {invite.role} · expires{' '}
                      {new Date(invite.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {isTrekker && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <div className="text-sm text-amber-900">
                        <p className="font-semibold">
                          Accepting turns this into a company account. It can&apos;t be undone.
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-amber-800">
                          <li>You won&apos;t be able to book or favourite treks any more.</li>
                          <li>
                            Your bookings, favourites and trek chats stay on record but you
                            won&apos;t be able to open them.
                          </li>
                          <li>Reviews you&apos;ve already posted stay published.</li>
                          <li>
                            Instead you&apos;ll manage {invite.company_name}&apos;s treks from
                            the company dashboard.
                          </li>
                        </ul>
                        <p className="mt-2">
                          If you have a trek coming up, leave it first — we won&apos;t convert
                          an account that&apos;s booked on an upcoming departure.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        onClick={() => accept(invite.invite_id)}
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-full bg-amber-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
                      >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        Yes, convert my account
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={busy}
                        className="rounded-full border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          isTrekker ? setConfirmingId(invite.invite_id) : accept(invite.invite_id)
                        }
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                      >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {isTrekker ? 'Accept & convert my account' : 'Accept invitation'}
                      </button>
                      <button
                        type="button"
                        onClick={() => decline(invite.invite_id)}
                        disabled={busy}
                        className="rounded-full border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
