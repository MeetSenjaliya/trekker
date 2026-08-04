'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Mountain,
  Mail,
  Phone,
  Globe,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useAdminCompany, useCompanyTreks } from '@/lib/queries';
import CompanyActions from '@/components/admin/CompanyActions';
import type { CompanyStatus } from '@/lib/company';

const statusStyles: Record<CompanyStatus, string> = {
  approved: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-700',
  suspended: 'bg-gray-200 text-gray-700',
};

function ContactRow({
  icon: Icon,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string | null;
  href?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-gray-700">
      <Icon className="h-4 w-4 shrink-0 text-gray-400" />
      {href ? (
        <a href={href} className="truncate hover:text-indigo-700">
          {value}
        </a>
      ) : (
        <span className="truncate">{value}</span>
      )}
    </div>
  );
}

export default function AdminCompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: company, isLoading, isError } = useAdminCompany(params.id);
  const { data: treks } = useCompanyTreks(company?.id, true);

  if (isError) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Couldn&apos;t load this company. Please refresh.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/companies"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Companies
        </Link>
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          Company not found.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin/companies"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Companies
      </Link>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {company.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.cover_image_url} alt="" className="h-32 w-full object-cover" />
        )}
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100">
                {company.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={company.logo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Building2 className="h-6 w-6 text-gray-400" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-gray-900">{company.name}</h1>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusStyles[company.status]}`}
                  >
                    {company.status}
                  </span>
                </div>
                <p className="text-sm text-gray-500">/company/{company.slug}</p>
              </div>
            </div>
            <CompanyActions companyId={company.id} status={company.status} />
          </div>

          {company.description && (
            <p className="mt-4 whitespace-pre-line text-sm text-gray-700">{company.description}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">Company contact</h2>
          <div className="mt-3 space-y-2">
            <ContactRow
              icon={Mail}
              value={company.contact_email}
              href={company.contact_email ? `mailto:${company.contact_email}` : undefined}
            />
            <ContactRow
              icon={Phone}
              value={company.contact_phone}
              href={company.contact_phone ? `tel:${company.contact_phone}` : undefined}
            />
            <ContactRow icon={Globe} value={company.website} href={company.website ?? undefined} />
            {!company.contact_email && !company.contact_phone && !company.website && (
              <p className="text-sm text-gray-400">No contact details provided.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">Audit trail</h2>
          <div className="mt-3 space-y-2 text-sm text-gray-700">
            <p className="text-gray-500">
              Applied {new Date(company.created_at).toLocaleString()}
              {company.created_by_name ? ` by ${company.created_by_name}` : ''}
            </p>
            {company.approved_at && (
              <p className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Approved {new Date(company.approved_at).toLocaleString()}
              </p>
            )}
            {company.status === 'rejected' && (
              <p className="flex items-start gap-2 text-red-700">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Rejected{company.rejection_reason ? `: ${company.rejection_reason}` : ''}</span>
              </p>
            )}
            {company.status === 'suspended' && (
              <p className="flex items-start gap-2 text-gray-700">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <span>Suspended{company.rejection_reason ? `: ${company.rejection_reason}` : ''}</span>
              </p>
            )}
            {company.approved_by && (
              <p className="text-xs text-gray-400">
                Actioned by {company.approved_by_name ?? `admin ${company.approved_by.slice(0, 8)}…`}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">
          Treks {treks ? `(${treks.length})` : ''}
        </h2>
        {!treks ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : treks.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">This company has no treks yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {treks.map((trek) => (
              <li key={trek.id} className="flex items-center gap-3 py-3">
                <div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                  {trek.cover_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={trek.cover_image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Mountain className="h-4 w-4 text-gray-300" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-gray-900">{trek.title}</p>
                    {!trek.is_active && (
                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                        Archived
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-gray-500">
                    {trek.location || 'No location'} · {trek.difficulty}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
