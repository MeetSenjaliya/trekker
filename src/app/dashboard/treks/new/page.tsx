'use client';

import Link from 'next/link';
import { ArrowLeft, Clock, XCircle, Ban, ArrowRight } from 'lucide-react';
import { useDashboardCompany } from '@/components/admin/DashboardShell';
import TrekForm from '@/components/admin/TrekForm';
import type { Company } from '@/lib/company';

// Only approved companies can publish treks (enforced by the treks INSERT RLS
// policy). For pending/rejected/suspended we show a status-aware gate instead of
// the form, so a create attempt never fails with a raw RLS error.
const GATE = {
  pending: {
    icon: Clock,
    card: 'border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50',
    iconWrap: 'bg-amber-100',
    iconColor: 'text-amber-600',
    title: 'text-amber-900',
    body: 'text-amber-800',
    heading: 'Approval pending',
  },
  rejected: {
    icon: XCircle,
    card: 'border-rose-200 bg-gradient-to-r from-rose-50 via-red-50 to-rose-50',
    iconWrap: 'bg-rose-100',
    iconColor: 'text-rose-600',
    title: 'text-rose-900',
    body: 'text-rose-800',
    heading: 'Application not approved',
  },
  suspended: {
    icon: Ban,
    card: 'border-slate-300 bg-gradient-to-r from-slate-100 via-gray-50 to-slate-100',
    iconWrap: 'bg-slate-200',
    iconColor: 'text-slate-600',
    title: 'text-slate-900',
    body: 'text-slate-700',
    heading: 'Company suspended',
  },
} as const;

function gateBody(status: 'pending' | 'rejected' | 'suspended', name: string) {
  switch (status) {
    case 'pending':
      return (
        <>
          Publish treks once a platform admin approves <strong>{name}</strong>. You can set
          everything else up in the meantime.
        </>
      );
    case 'rejected':
      return (
        <>
          <strong>{name}</strong>&apos;s application wasn&apos;t approved, so it can&apos;t
          publish treks. Re-apply to get approved.
        </>
      );
    case 'suspended':
      return (
        <>
          <strong>{name}</strong> is suspended and can&apos;t publish new treks right now.
        </>
      );
  }
}

function TrekCreationGate({ company }: { company: Company }) {
  const status = company.status as 'pending' | 'rejected' | 'suspended';
  const g = GATE[status];
  const Icon = g.icon;

  return (
    <div className={`rounded-2xl border p-6 sm:p-8 ${g.card}`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${g.iconWrap}`}>
          <Icon className={`h-6 w-6 ${g.iconColor}`} />
        </div>
        <div className="min-w-0">
          <h2 className={`text-lg font-bold ${g.title}`}>{g.heading}</h2>
          <p className={`mt-1 text-sm ${g.body}`}>{gateBody(status, company.name)}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            {status === 'rejected' && (
              <Link
                href="/company/apply"
                className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-700"
              >
                Submit a new application
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-4 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewTrekPage() {
  const { company } = useDashboardCompany();
  if (!company) return null;

  const canCreate = company.status === 'approved';

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
        <h1 className="mt-2 text-2xl font-bold text-gray-900">New trek</h1>
      </div>
      {canCreate ? <TrekForm companyId={company.id} /> : <TrekCreationGate company={company} />}
    </div>
  );
}
