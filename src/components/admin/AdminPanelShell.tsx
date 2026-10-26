import Link from "next/link";

import AdminLogoutButton from "@/components/admin/AdminLogoutButton";

const ADMIN_NAV_LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/businesses", label: "Businesses" },
  { href: "/admin/calls", label: "Calls" },
  { href: "/admin/system", label: "System" },
  { href: "/admin/audit", label: "Audit" },
];

/**
 * Shared chrome for the signed-in admin panel: header nav + sign-out button
 * around the page content. The app/admin/(protected)/ group layout wraps every
 * sub-page with it, and the /admin entry page uses it for the overview, so
 * both render identically.
 */
export default function AdminPanelShell({
  children,
}: {
  children: React.ReactNode;
}) {
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