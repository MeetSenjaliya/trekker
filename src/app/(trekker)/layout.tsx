import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';

// Server-side counterpart of the /dashboard guard, for the customer side of the
// platform: /profile, /favorites, /messages, /edits, /review. The middleware
// only guarantees a session — this additionally requires a trekker account, so
// a company account that types the URL lands on its own dashboard instead.
//
// is_trekker() is the same predicate the RLS policies and join_trek_and_chat use
// (and it exempts platform admins), so the UI can never disagree with what the
// database will actually allow. This redirect is UX; the DB is the boundary.
export default async function TrekkerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data, error } = await supabase.rpc('is_trekker');

  if (error) {
    console.error('Error checking account type:', error);
    redirect('/');
  }
  if (data !== true) redirect('/dashboard');

  return <>{children}</>;
}
