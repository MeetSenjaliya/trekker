'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Building2, ShieldCheck } from 'lucide-react';

// Layout chrome for the platform-admin panel. Access is already enforced by
// src/app/admin/layout.tsx (is_platform_admin server check) — this is nav only.
const navItems = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/companies', label: 'Companies', icon: Building2, exact: false },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)' }}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-24 pb-6">
      <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        <aside className="md:w-60 md:shrink-0">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 md:sticky md:top-6">
            <div className="mb-4 flex items-center gap-3 border-b border-gray-100 pb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100">
                <ShieldCheck className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">Platform admin</p>
                <p className="text-xs text-gray-500">Trekker</p>
              </div>
            </div>

            <nav className="flex gap-1 overflow-x-auto md:flex-col">
              {navItems.map((item) => {
                const activeLink = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      activeLink
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
      </div>
    </div>
  );
}
