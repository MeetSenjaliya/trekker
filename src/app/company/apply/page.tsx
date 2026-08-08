'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { companyApplicationSchema, fieldErrors } from '@/lib/schemas';
import { applyForCompany } from '@/lib/company';
import { useAccountType } from '@/lib/queries';

const initialForm = {
  name: '',
  slug: '',
  description: '',
  contactEmail: '',
  contactPhone: '',
  website: '',
};

const inputClass = (hasError: boolean) =>
  `block w-full appearance-none rounded-xl border px-4 py-3 text-gray-900 placeholder-gray-500 focus:z-10 focus:outline-none sm:text-sm transition-colors ${
    hasError
      ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500'
      : 'border-gray-300 bg-gray-50 focus:border-blue-500 focus:ring-blue-500'
  }`;

export default function CompanyApplyPage() {
  const { user, loading } = useAuth();
  const { data: accountType, isPending: accountTypePending } = useAccountType(user?.id);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = companyApplicationSchema.safeParse(form);
    if (!result.success) {
      setErrors(fieldErrors(result.error));
      return;
    }

    setSubmitting(true);
    const res = await applyForCompany(result.data);
    setSubmitting(false);

    if (res.success) {
      setSubmitted(true);
    } else {
      toast.error(res.message);
    }
  };

  if (loading) return null;

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <main className="flex-grow">
          <div className="container mx-auto flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
            <div className="w-full max-w-md space-y-8 text-center">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                <Building2 className="w-8 h-8 text-blue-600" />
              </div>
              <div>
                <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">
                  List your treks on Trek Buddies
                </h2>
                <p className="mt-2 text-gray-600">
                  Sign in to apply as a trek company. Once a platform admin
                  approves your application, you can publish and manage your own
                  treks.
                </p>
              </div>
              <Link
                href="/auth/login"
                className="inline-flex justify-center rounded-full border border-transparent bg-blue-600 px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Log in to apply
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Wait for the account type before rendering anything — showing the form to a
  // trekker and only failing on submit would waste the whole form.
  if (accountTypePending) return null;

  // apply_for_company() requires account_type='company', and the type is pinned
  // after signup, so there is nothing this user can do on this page.
  if (accountType === 'trekker') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <main className="flex-grow">
          <div className="container mx-auto flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
            <div className="w-full max-w-md space-y-8 text-center">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                <Building2 className="w-8 h-8 text-blue-600" />
              </div>
              <div>
                <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">
                  This is a trekker account
                </h2>
                <p className="mt-2 text-gray-600">
                  Listing treks needs a separate company account — trekker
                  accounts book treks, company accounts sell them, and an account
                  can&apos;t switch between the two. Sign up again as a trek
                  company using a different email address.
                </p>
              </div>
              <Link
                href="/auth/signup"
                className="inline-flex justify-center rounded-full border border-transparent bg-blue-600 px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Create a company account
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <main className="flex-grow">
          <div className="container mx-auto flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
            <div className="w-full max-w-md space-y-8 text-center">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">
                  Application submitted
                </h2>
                <p className="mt-2 text-gray-600">
                  <strong>{form.name}</strong> is pending review. A platform
                  admin will approve or reject it — you can check back on your
                  dashboard once it&apos;s approved.
                </p>
              </div>
              <Link
                href="/"
                className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-500 font-medium text-sm"
              >
                Back to home
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <main className="flex-grow">
        <div className="container mx-auto flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
          <div className="w-full max-w-lg space-y-8">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">
                Apply as a trek company
              </h2>
              <p className="mt-2 text-gray-600">
                Tell us about your company. Applications are reviewed by a
                platform admin before your treks go live.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  Company name *
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  value={form.name}
                  onChange={handleChange}
                  placeholder="Himalayan Trails"
                  className={inputClass(!!errors.name)}
                />
                {errors.name && <p className="mt-2 text-sm text-red-600">{errors.name}</p>}
              </div>

              <div>
                <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">
                  URL slug *
                </label>
                <input
                  id="slug"
                  name="slug"
                  type="text"
                  required
                  value={form.slug}
                  onChange={handleChange}
                  placeholder="himalayan-trails"
                  className={inputClass(!!errors.slug)}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Your public page will live at /company/{form.slug || 'your-slug'} — this can&apos;t be changed later.
                </p>
                {errors.slug && <p className="mt-2 text-sm text-red-600">{errors.slug}</p>}
              </div>

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={4}
                  value={form.description}
                  onChange={handleChange}
                  placeholder="What kind of treks do you run?"
                  className={inputClass(!!errors.description)}
                />
                {errors.description && <p className="mt-2 text-sm text-red-600">{errors.description}</p>}
              </div>

              <div>
                <label htmlFor="contactEmail" className="block text-sm font-medium text-gray-700 mb-1">
                  Contact email
                </label>
                <input
                  id="contactEmail"
                  name="contactEmail"
                  type="email"
                  autoComplete="email"
                  value={form.contactEmail}
                  onChange={handleChange}
                  placeholder="hello@example.com"
                  className={inputClass(!!errors.contactEmail)}
                />
                {errors.contactEmail && <p className="mt-2 text-sm text-red-600">{errors.contactEmail}</p>}
              </div>

              <div>
                <label htmlFor="contactPhone" className="block text-sm font-medium text-gray-700 mb-1">
                  Contact phone
                </label>
                <input
                  id="contactPhone"
                  name="contactPhone"
                  type="tel"
                  autoComplete="tel"
                  value={form.contactPhone}
                  onChange={handleChange}
                  placeholder="+91 98765 43210"
                  className={inputClass(!!errors.contactPhone)}
                />
                {errors.contactPhone && <p className="mt-2 text-sm text-red-600">{errors.contactPhone}</p>}
              </div>

              <div>
                <label htmlFor="website" className="block text-sm font-medium text-gray-700 mb-1">
                  Website
                </label>
                <input
                  id="website"
                  name="website"
                  type="url"
                  value={form.website}
                  onChange={handleChange}
                  placeholder="https://example.com"
                  className={inputClass(!!errors.website)}
                />
                {errors.website && <p className="mt-2 text-sm text-red-600">{errors.website}</p>}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="group relative flex w-full justify-center rounded-full border border-transparent bg-blue-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? 'Submitting…' : 'Submit application'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
