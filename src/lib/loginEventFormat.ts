// Display helpers for the /admin/logins table. Pure: no Supabase, no clock.

const MINUTE = 60_000;

export function formatDuration(startIso: string, endIso: string): string {
  const minutes = Math.floor(
    Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime()) / MINUTE
  );
  if (minutes < 1) return '< 1 min';

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}

// GoTrue's authentication_method values. Every email-delivered link lands in
// one bucket — an admin cares that it was a link, not which template sent it.
const EMAIL_LINK = new Set(['otp', 'magiclink', 'recovery', 'email/signup', 'invite']);

export function methodLabel(method: string | null): string {
  if (method === null) return '—';
  if (method === 'password') return 'Password';
  if (EMAIL_LINK.has(method)) return 'Email link';
  if (method === 'oauth') return 'OAuth';
  return method;
}

const ACCOUNT_TYPES: Record<string, string> = {
  platform_admin: 'Platform admin',
  company_owner: 'Company owner',
  company_staff: 'Company staff',
  trekker: 'Trekker',
};

export function accountTypeLabel(type: string | null): string {
  if (type === null) return '—';
  return ACCOUNT_TYPES[type] ?? type;
}
