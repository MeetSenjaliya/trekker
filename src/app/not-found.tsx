import Link from 'next/link';

// Reached via notFound() as well as unmatched URLs, so missing treks/companies
// return a real 404 status instead of a 200 with "not found" text (a soft 404,
// which search engines treat as a low-quality duplicate page).
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#090a0f] text-slate-400 px-6 text-center">
      <p className="text-6xl font-black text-white/10">404</p>
      <h1 className="text-2xl font-bold text-white">Page not found</h1>
      <p className="max-w-md">
        This trail doesn&apos;t exist — it may have been archived or the link is wrong.
      </p>
      <Link
        href="/explore"
        className="mt-4 inline-flex items-center justify-center px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors"
      >
        Explore treks
      </Link>
    </div>
  );
}
