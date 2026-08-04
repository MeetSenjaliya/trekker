import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import AdminShell from '@/components/admin/AdminShell';

// Server-side guard: /admin is platform-admin only. is_platform_admin() is a
// SECURITY DEFINER check against platform_admins, a table with zero client
// policies — the RPC is the only way to ask, and the answer can't be forged
// client-side.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('is_platform_admin');

  if (error) {
    console.error('Error checking platform admin:', error);
    redirect('/');
  }
  if (data !== true) redirect('/');

  return <AdminShell>{children}</AdminShell>;
}
