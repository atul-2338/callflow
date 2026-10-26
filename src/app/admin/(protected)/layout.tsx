import Link from "next/link";

import AdminLogoutButton from "@/components/admin/AdminLogoutButton";
import { requireAdminPage } from "@/lib/admin-page-guard";

// requireAdminPage() reads cookies and env vars that exist only at request
// time. Next 16 no longer treats cookies() in a layout as a signal to skip
// prerendering — without this, the build bakes a static 404 from the
// build-time (envless) guard into every /admin page.
export const dynamic = "force-dynamic";

const ADMIN_NAV_LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/businesses", label: "Businesses" },
  { href: "/admin/calls", label: "Calls" },
  { href: "/admin/system", label: "System" },
  { href: "/admin/audit", label: "Audit" },
];

/**
 * Single guard for every page in this group: /admin plus the Phase 4 pages
 * (/admin/businesses, /admin/businesses/[id], /admin/calls, /admin/system,
 * /admin/audit) — any page dropped into this group is protected
 * automatically. /admin/login lives outside this group on purpose.
 */
export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-separator bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <span className="text-sm font-semibold text-ink">CallFlow Admin</span>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {ADMIN_NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-ink-2 transition hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <AdminLogoutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}