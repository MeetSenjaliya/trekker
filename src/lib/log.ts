import type { Breadcrumb } from '@sentry/nextjs';

/**
 * Log an error with its row data left out.
 *
 * A PostgrestError carries `details` and `hint` alongside `message` and
 * `code`, and `details` is where Postgres puts the row: `Key (email)=(a@b.c)
 * already exists`, `Failing row contains (…)`. Sentry records every
 * console.error as a breadcrumb on the next event it sends, so logging the raw
 * object ships that row to a third party (CODE_REVIEW §4.3). Only message and
 * code leave here. The Next dev overlay also renders the raw object as `{}`,
 * so this is the more readable line as well.
 */
export function logError(context: string, error: unknown): void {
  const { code, message } = summarise(error);
  if (code) console.error(context, code, message);
  else console.error(context, message);
}

function summarise(error: unknown): { code?: string; message: string } {
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return {
      code: typeof code === 'string' ? code : undefined,
      message: typeof message === 'string' ? message : String(error),
    };
  }
  return { message: String(error) };
}

/**
 * The safety net behind logError(): a Sentry `beforeBreadcrumb` hook that
 * strips the same two fields from any console call that still logs a raw
 * error object — a site logError() missed, or a library's own logging. Both
 * the browser and the server SDK put the original arguments on
 * `data.arguments`; the server also pre-formats them into `message`, so that
 * is rebuilt from the scrubbed arguments whenever anything was stripped.
 */
export function scrubConsoleBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.category !== 'console') return breadcrumb;
  const args = breadcrumb.data?.arguments;
  if (!Array.isArray(args)) return breadcrumb;

  let stripped = false;
  const scrubbed = args.map((arg) => {
    if (typeof arg !== 'object' || arg === null) return arg;
    if (!('details' in arg) && !('hint' in arg)) return arg;
    stripped = true;
    return withoutRowData(arg);
  });
  if (!stripped) return breadcrumb;

  return {
    ...breadcrumb,
    data: { ...breadcrumb.data, arguments: scrubbed },
    message: scrubbed.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
  };
}

function withoutRowData(arg: object): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(arg)) {
    if (key !== 'details' && key !== 'hint') copy[key] = value;
  }
  // Error.message is an own but non-enumerable property, so Object.entries
  // skips it — and a PostgrestError is an Error.
  if (arg instanceof Error) copy.message = arg.message;
  return copy;
}
