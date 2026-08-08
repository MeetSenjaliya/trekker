'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/utils/supabase/client';
import { accountNameSchema, resetPasswordSchema, fieldErrors } from '@/lib/schemas';

const inputClass = (hasError: boolean) =>
  `block w-full rounded-xl border px-4 py-3 text-gray-900 placeholder-gray-500 focus:outline-none sm:text-sm transition-colors ${
    hasError ? 'border-red-300 bg-red-50 focus:border-red-500' : 'border-gray-300 bg-gray-50 focus:border-blue-500'
  }`;

// Personal account settings for company members. /dashboard/settings is the
// COMPANY profile and is owner/admin only; this page is the operator's own
// account and is open to every member, including staff — company accounts have
// no /profile/edit, so without this a staff member cannot change their password.
export default function AccountPage() {
  const { user } = useAuth();

  const [fullName, setFullName] = useState('');
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  const [savingName, setSavingName] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [pw, setPw] = useState({ password: '', confirmPassword: '' });
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error('Error loading profile:', error);
        toast.error('Failed to load your account. Please refresh.');
      } else {
        setFullName(data?.full_name ?? '');
      }
      setLoadingProfile(false);
    };

    load();
    return () => { cancelled = true; };
  }, [user]);

  if (!user) return null;

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = accountNameSchema.safeParse({ fullName });
    if (!result.success) {
      setNameErrors(fieldErrors(result.error));
      return;
    }
    setNameErrors({});
    setSavingName(true);
    try {
      const supabase = createClient();
      // account_type is pinned by a DB trigger, so a stray column here could not
      // change it even if one were sent — but only full_name is ever written.
      const { data, error } = await supabase
        .from('profiles')
        .update({ full_name: result.data.fullName })
        .eq('id', user.id)
        .select('id');

      if (error) {
        console.error('Error updating profile:', error);
        toast.error('Failed to save your name. Please try again.');
        return;
      }
      if (!data || data.length === 0) {
        toast.error('Failed to save your name. Please try again.');
        return;
      }
      toast.success('Name updated.');
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = resetPasswordSchema.safeParse(pw);
    if (!result.success) {
      setPwErrors(fieldErrors(result.error));
      return;
    }
    setPwErrors({});
    setSavingPw(true);
    try {
      const { updatePassword } = await import('@/lib/auth');
      const { error } = await updatePassword(result.data.password);
      if (error) {
        toast.error(error.message);
        return;
      }
      setPw({ password: '', confirmPassword: '' });
      toast.success('Password updated.');
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My account</h1>
        <p className="mt-1 text-sm text-gray-500">
          Your personal sign-in details. Your company&apos;s public profile lives under Settings.
        </p>
      </div>

      <form onSubmit={handleSaveName} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6" noValidate>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
          <p className="rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-500">
            {user.email}
            <span className="ml-2 text-xs text-gray-400">(can&apos;t be changed here)</span>
          </p>
        </div>

        <div>
          <label htmlFor="fullName" className="mb-1 block text-sm font-medium text-gray-700">
            Your name
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            disabled={loadingProfile}
            value={fullName}
            onChange={(e) => { setFullName(e.target.value); setNameErrors({}); }}
            className={inputClass(!!nameErrors.fullName)}
          />
          <p className="mt-1.5 text-xs text-gray-500">Shown to your teammates on the Team page.</p>
          {nameErrors.fullName && <p className="mt-1.5 text-sm text-red-600">{nameErrors.fullName}</p>}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingName || loadingProfile}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingName && <Loader2 className="h-4 w-4 animate-spin" />}
            Save name
          </button>
        </div>
      </form>

      <form onSubmit={handleChangePassword} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6" noValidate>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Change password</h2>
          <p className="mt-1 text-sm text-gray-500">
            Minimum 8 characters. Passwords found in known breaches are rejected.
          </p>
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={pw.password}
            onChange={(e) => { setPw({ ...pw, password: e.target.value }); setPwErrors({}); }}
            className={inputClass(!!pwErrors.password)}
          />
          {pwErrors.password && <p className="mt-1.5 text-sm text-red-600">{pwErrors.password}</p>}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-gray-700">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={pw.confirmPassword}
            onChange={(e) => { setPw({ ...pw, confirmPassword: e.target.value }); setPwErrors({}); }}
            className={inputClass(!!pwErrors.confirmPassword)}
          />
          {pwErrors.confirmPassword && <p className="mt-1.5 text-sm text-red-600">{pwErrors.confirmPassword}</p>}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingPw}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingPw && <Loader2 className="h-4 w-4 animate-spin" />}
            Update password
          </button>
        </div>
      </form>
    </div>
  );
}
