'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Lock } from 'lucide-react';
import { type EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/client';
import { updatePassword } from '@/lib/auth';

type Phase = 'verifying' | 'ready' | 'invalid' | 'done';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('verifying');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Establish the recovery session from the email link. We use the token_hash
  // OTP flow (not PKCE), which survives the link being opened on a different
  // device/browser than the one that requested the reset.
  useEffect(() => {
    const supabase = createClient();

    const run = async () => {
      const params = new URL(window.location.href).searchParams;
      const token_hash = params.get('token_hash');
      const type = params.get('type') as EmailOtpType | null;

      if (token_hash && type) {
        const { error } = await supabase.auth.verifyOtp({ token_hash, type });
        setPhase(error ? 'invalid' : 'ready');
        return;
      }

      // No token in the URL: only valid if a recovery session already exists.
      const { data } = await supabase.auth.getSession();
      setPhase(data.session ? 'ready' : 'invalid');
    };

    run();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const { error } = await updatePassword(password);
    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }
    setPhase('done');
    setTimeout(() => router.push('/auth/login'), 2500);
  };

  if (phase === 'verifying') {
    return (
      <Shell>
        <p className="text-center text-gray-600">Verifying your reset link…</p>
      </Shell>
    );
  }

  if (phase === 'invalid') {
    return (
      <Shell>
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">
            Link expired or invalid
          </h2>
          <p className="text-gray-600">
            This password reset link is no longer valid. Please request a new one.
          </p>
          <Link
            href="/auth/forgot-password"
            className="inline-flex items-center gap-2 font-medium text-blue-600 hover:text-blue-500"
          >
            Request a new link
          </Link>
        </div>
      </Shell>
    );
  }

  if (phase === 'done') {
    return (
      <Shell>
        <div className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">
            Password updated
          </h2>
          <p className="text-gray-600">Redirecting you to login…</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="text-center">
        <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
          <Lock className="w-8 h-8 text-blue-600" />
        </div>
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900">
          Set a new password
        </h2>
        <p className="mt-2 text-gray-600">Choose a strong password you don&apos;t use elsewhere.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="password" className="sr-only">New password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
            className="relative block w-full appearance-none rounded-xl border border-gray-300 bg-gray-50 px-4 py-4 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm transition-colors"
          />
        </div>
        <div>
          <label htmlFor="confirm" className="sr-only">Confirm new password</label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            className="relative block w-full appearance-none rounded-xl border border-gray-300 bg-gray-50 px-4 py-4 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm transition-colors"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="group relative flex w-full justify-center rounded-full border border-transparent bg-blue-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Updating…' : 'Update password'}
        </button>
      </form>

      <div className="text-center text-sm">
        <Link
          href="/auth/login"
          className="inline-flex items-center gap-2 font-medium text-blue-600 hover:text-blue-500 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to login
        </Link>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <main className="flex-grow">
        <div className="container mx-auto flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
          <div className="w-full max-w-md space-y-8">{children}</div>
        </div>
      </main>
    </div>
  );
}