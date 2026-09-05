'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, UserPlus, Trash2, User as UserIcon, MailX, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardCompany } from '@/components/admin/DashboardShell';
import { useCompanyMembers, useCompanyInvites, queryKeys } from '@/lib/queries';
import { inviteMemberSchema, fieldErrors } from '@/lib/schemas';
import {
  inviteMember,
  updateMemberRole,
  removeMember,
  revokeInvite,
  isCompanyFrozen,
} from '@/lib/company';

export default function TeamPage() {
  const { user } = useAuth();
  const { company, role } = useDashboardCompany();
  const queryClient = useQueryClient();
  const isAdmin = role === 'owner' || role === 'admin';
  const frozen = !!company && isCompanyFrozen(company.status);
  const canManage = isAdmin && !frozen;

  const { data: members, isLoading, isError } = useCompanyMembers(company?.id);
  const { data: invites } = useCompanyInvites(canManage ? company?.id : undefined);

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!company) return null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.companyMembers(company.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.companyInvites(company.id) });
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = inviteMemberSchema.safeParse({ email });
    if (!result.success) {
      setEmailError(fieldErrors(result.error).email ?? 'Enter a valid email');
      return;
    }
    setEmailError(null);
    setInviting(true);
    const res = await inviteMember(company.id, result.data.email);
    setInviting(false);
    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    setEmail('');
    refresh();
  };

  const changeRole = async (memberId: string, next: 'admin' | 'staff') => {
    setBusyId(memberId);
    const res = await updateMemberRole(memberId, next);
    setBusyId(null);
    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    refresh();
  };

  const revoke = async (inviteId: string) => {
    setBusyId(inviteId);
    const res = await revokeInvite(inviteId);
    setBusyId(null);
    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    refresh();
  };

  const remove = async (memberId: string) => {
    setBusyId(memberId);
    const res = await removeMember(memberId);
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
      <h1 className="text-2xl font-bold text-gray-900">Team</h1>

      {isAdmin && frozen && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Team management is unavailable while {company.name} is {company.status} — you
          can&apos;t invite, promote or remove members. The roster below is unchanged.
        </p>
      )}

      {canManage && (
        <form onSubmit={invite} className="rounded-2xl border border-gray-200 bg-white p-5" noValidate>
          <label htmlFor="invite-email" className="mb-1 block text-sm font-medium text-gray-700">
            Invite a teammate
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError(null);
                }}
                placeholder="teammate@example.com"
                className={`block w-full rounded-xl border px-4 py-3 text-sm text-gray-900 focus:outline-hidden ${
                  emailError ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-gray-50 focus:border-blue-500'
                }`}
              />
              {emailError && <p className="mt-1.5 text-sm text-red-600">{emailError}</p>}
            </div>
            <button
              type="submit"
              disabled={inviting}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Add
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            They must already have a Trekker account. We&apos;ll send them an
            invitation to accept — joining a company team changes their account,
            so it&apos;s their call. New members join as staff.
          </p>
        </form>
      )}

      {canManage && invites && invites.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
            <Clock className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-gray-900">
              Pending invitations ({invites.length})
            </h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{invite.email}</p>
                  <p className="text-xs text-gray-500">
                    Invited as {invite.role} · expires{' '}
                    {new Date(invite.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(invite.id)}
                  disabled={busyId === invite.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
                >
                  {busyId === invite.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MailX className="h-4 w-4" />
                  )}
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Couldn&apos;t load your team. Please refresh.
        </p>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {(members ?? []).map((member) => {
            const isOwner = member.role === 'owner';
            const isSelf = member.user_id === user?.id;
            return (
              <li key={member.member_id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100">
                  {member.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={member.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <UserIcon className="h-5 w-5 text-gray-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">
                    {member.full_name || 'Unnamed trekker'}
                    {isSelf && <span className="ml-2 text-xs font-normal text-gray-400">(you)</span>}
                  </p>
                  <p className="truncate text-sm text-gray-500">{member.email || '—'}</p>
                </div>

                {canManage && !isOwner && !isSelf ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={member.role}
                      onChange={(e) => changeRole(member.member_id, e.target.value as 'admin' | 'staff')}
                      disabled={busyId === member.member_id}
                      className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-hidden disabled:opacity-60"
                    >
                      <option value="admin">Admin</option>
                      <option value="staff">Staff</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => remove(member.member_id)}
                      disabled={busyId === member.member_id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
                    >
                      {busyId === member.member_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium capitalize text-gray-600">
                    {member.role}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
