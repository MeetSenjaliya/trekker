import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  totalPages: number;
  currentPage: number;
  onPageChange: (page: number) => void;
}

// MUI-style page list: first, last, current ± 1, with "…" gaps.
function buildPages(totalPages: number, currentPage: number): (number | 'ellipsis')[] {
  const siblings = 1;
  const pages: (number | 'ellipsis')[] = [];
  const start = Math.max(2, currentPage - siblings);
  const end = Math.min(totalPages - 1, currentPage + siblings);

  pages.push(1);
  if (start > 2) pages.push('ellipsis');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < totalPages - 1) pages.push('ellipsis');
  if (totalPages > 1) pages.push(totalPages);

  return pages;
}

export default function TrekPagination({ totalPages, currentPage, onPageChange }: Props) {
  if (totalPages <= 1) return null;

  const pages = buildPages(totalPages, currentPage);
  const baseBtn =
    'flex h-11 min-w-[2.75rem] items-center justify-center rounded-lg px-3 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-2">
      <button
        type="button"
        aria-label="Previous page"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className={`${baseBtn} text-slate-600 hover:bg-blue-50`}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span key={`gap-${i}`} className="flex h-11 min-w-[2.75rem] items-center justify-center text-slate-400">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            aria-label={`Go to page ${p}`}
            aria-current={p === currentPage ? 'page' : undefined}
            onClick={() => onPageChange(p)}
            className={
              p === currentPage
                ? `${baseBtn} bg-blue-600 text-white shadow-sm hover:bg-blue-700`
                : `${baseBtn} text-slate-600 hover:bg-blue-50`
            }
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        aria-label="Next page"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className={`${baseBtn} text-slate-600 hover:bg-blue-50`}
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </nav>
  );
}
