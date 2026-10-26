import AdminPanelShell from "@/components/admin/AdminPanelShell";
import { requireAdminPage } from "@/lib/admin-page-guard";

// requireAdminPage() reads cookies and env vars that exist only at request
// time. Next 16 no longer treats cookies() in a layout as a signal to skip
// prerendering — without this, the build bakes a static 404 from the
// build-time (envless) guard into every /admin sub-page.
export const dynamic = "force-dynamic";

/**
 * Single guard for every page in this group: the Phase 4 sub-pages
 * (/admin/businesses, /admin/businesses/[id], /admin/calls, /admin/system,
 * /admin/audit) — any page dropped into this group is protected
 * automatically. Signed-out users are sent to /admin, the single entry point
 * (it shows the sign-in form itself). The /admin entry page and the
 * /admin/login permanent redirect live outside this group on purpose.
 */
export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage();

  return <AdminPanelShell>{children}</AdminPanelShell>;
}