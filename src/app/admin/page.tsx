import AdminLoginForm from "@/components/admin/AdminLoginForm";
import AdminOverview from "@/components/admin/AdminOverview";
import AdminPanelShell from "@/components/admin/AdminPanelShell";
import { adminPageSessionActive } from "@/lib/admin-page-guard";

// adminPageSessionActive() reads cookies and env vars that exist only at
// request time. Next 16 no longer treats cookies() as a signal to skip
// prerendering — without this, the build bakes a static (envless) result
// into /admin.
export const dynamic = "force-dynamic";

/**
 * Single admin entry point. Signed out: the sign-in form renders right here
 * (there is no separate login page). Signed in: the overview, wrapped in the
 * same shell as every other admin page. adminPageSessionActive() fails
 * closed — with the admin env vars missing this page 404s, exactly like the
 * rest of the admin area.
 */
export default async function AdminEntryPage() {
  if (!(await adminPageSessionActive())) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold text-ink">CallFlow Admin</h1>
          <p className="mt-1 text-sm text-ink-2">
            Sign in to manage businesses and calls. Owner accounts use the
            dashboard, not this page.
          </p>
          <AdminLoginForm />
        </div>
      </div>
    );
  }

  return (
    <AdminPanelShell>
      <AdminOverview />
    </AdminPanelShell>
  );
}