'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, X, Ban, RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { approveCompany, rejectCompany, suspendCompany } from '@/lib/company';
import type { CompanyStatus } from '@/lib/company';

// Approve/reject/suspend for one company, shared by the list and detail views.
// Reject and suspend take an optional reason, collected inline before the RPC
// runs. On success we invalidate the whole ['admin'] tree so the overview
// counts, the filtered list and this company's detail all refresh together.
type Mode = 'reject' | 'suspend';

export default function CompanyActions({
  companyId,
  status,
}: {
  companyId: string;
  status: CompanyStatus;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<{ success: boolean; message: string }>) => {
    setBusy(true);
    const res = await action();
    setBusy(false);
    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    setMode(null);
    setReason('');
    queryClient.invalidateQueries({ queryKey: ['admin'] });
  };

  if (mode) {
    return (
      <div className="w-full space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <label htmlFor={`reason-${companyId}`} className="block text-xs font-medium text-gray-600">
          {mode === 'reject' ? 'Reason for rejection' : 'Reason for suspension'} (optional)
        </label>
        <textarea
          id={`reason-${companyId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
          placeholder="Shown to the company owner"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(() =>
                mode === 'reject'
                  ? rejectCompany(companyId, reason)
                  : suspendCompany(companyId, reason)
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Confirm {mode === 'reject' ? 'rejection' : 'suspension'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMode(null);
              setReason('');
            }}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const approve = (
    <button
      type="button"
      disabled={busy}
      onClick={() => run(() => approveCompany(companyId))}
      className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      {status === 'pending' ? 'Approve' : status === 'suspended' ? 'Reinstate' : 'Re-approve'}
    </button>
  );

  const reject = (
    <button
      type="button"
      disabled={busy}
      onClick={() => setMode('reject')}
      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
    >
      <X className="h-4 w-4" />
      Reject
    </button>
  );

  const suspend = (
    <button
      type="button"
      disabled={busy}
      onClick={() => setMode('suspend')}
      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
    >
      <Ban className="h-4 w-4" />
      Suspend
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'pending' && (
        <>
          {approve}
          {reject}
        </>
      )}
      {status === 'approved' && suspend}
      {status === 'rejected' && approve}
      {status === 'suspended' && (
        <span className="inline-flex items-center gap-1.5">
          <RotateCcw className="h-4 w-4 text-gray-400" />
          {approve}
        </span>
      )}
    </div>
  );
}
