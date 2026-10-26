import type { Metadata } from "next";

/**
 * Shell for the entire /admin area. No auth here on purpose: the guarded
 * pages live in app/admin/(protected)/, whose layout calls requireAdminPage()
 * for every page in the group, while /admin/login stays outside so it can
 * authenticate. This layout only owns shared metadata — the admin panel must
 * never be indexed (belt alongside src/app/robots.ts).
 */
export const metadata: Metadata = {
  title: "CallFlow Admin",
  robots: { index: false, follow: false },
};

export default function AdminAreaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-[#f2f2f7] text-ink">{children}</div>;
}