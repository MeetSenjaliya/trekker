'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (error) {
      setError('');
    }
  };

  const validateEmail = (email: string) => {
    return /\S+@\S+\.\S+/.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    try {
      const { resetPassword } = await import('@/lib/auth');
      const { error } = await resetPassword(email);

      if (error) {
        setError(`Password reset failed: ${error.message}`);
      } else {
        setIsSubmitted(true);
      }
    } catch (error) {
      console.error('Password reset error:', error);
      setError('An unexpected error occurred. Please try again.');
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">



        {/* Success Message */}
        <main className="flex-grow">
          <div className="container mx-auto flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
            <div className="w-full max-w-md space-y-8 text-center">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <Mail className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">
                  Check your email
                </h2>
                <p className="mt-2 text-gray-600">
                  We&apos;ve sent a password reset link to <strong>{email}</strong>
                </p>
              </div>
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  Didn&apos;t receive the email? Check your spam folder or try again.
                </p>
                <button
                  onClick={() => setIsSubmitted(false)}
                  className="text-blue-600 hover:text-blue-500 font-medium text-sm"
                >
                  Try a different email
                </button>
              </div>
              <Link
                href="/auth/login"
                className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-500 font-medium text-sm"
              >
                <ArrowLeft size={16} />
                Back to login
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      {/* <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <div className="container mx-auto flex h-20 items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3 text-gray-900">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">T</span>
            </div>
            <h1 className="text-xl font-bold leading-tight tracking-tight text-gray-900">
              Trek Buddies
            </h1>
          </Link>
          
          <div className="flex items-center gap-4">
            <nav className="hidden lg:flex items-center gap-8 text-sm font-medium">
              <Link href="/" className="text-gray-600 transition-colors hover:text-blue-600">
                Home
              </Link>
              <Link href="/explore" className="text-gray-600 transition-colors hover:text-blue-600">
                Explore Treks
              </Link>
              <Link href="/about" className="text-gray-600 transition-colors hover:text-blue-600">
                About
              </Link>
            </nav>
            <Link 
              href="/auth/login"
              className="flex h-10 min-w-[84px] cursor-pointer items-center justify-center overflow-hidden rounded-full bg-gray-100 px-4 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-200"
            >
              Log In
            </Link>
          </div>
        </div>
      </header> */}

      {/* Main Content */}
      <main className="flex-grow">
        <div className="container mx-auto flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
          <div className="w-full max-w-md space-y-8">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">
                Forgot Your Password?
              </h2>
              <p className="mt-2 text-gray-600">
                No worries! Enter your email below to reset it.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="email-address" className="sr-only">
                  Email or Username
                </label>
                <input
                  id="email-address"
                  name="email"
                  type="text"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={handleInputChange}
                  placeholder="Email or Username"
                  className={`relative block w-full appearance-none rounded-xl border px-4 py-4 text-gray-900 placeholder-gray-500 focus:z-10 focus:outline-none sm:text-sm transition-colors ${error
                      ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500'
                      : 'border-gray-300 bg-gray-50 focus:border-blue-500 focus:ring-blue-500'
                    }`}
                />
                {error && (
                  <p className="mt-2 text-sm text-red-600">{error}</p>
                )}
              </div>

              <div>
                <button
                  type="submit"
                  className="group relative flex w-full justify-center rounded-full border border-transparent bg-blue-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Send Password Reset Link
                </button>
              </div>
            </form>

            <div className="text-center text-sm">
              <Link
                href="/auth/login"
                className="font-medium text-blue-600 hover:text-blue-500 transition-colors"
              >
                Remembered your password? Log in
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

