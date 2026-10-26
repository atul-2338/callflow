import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminLoginForm from "@/components/admin/AdminLoginForm";
import { adminConfigured } from "@/lib/admin-session";

export const metadata: Metadata = {
  title: "Admin sign in — CallFlow",
  robots: { index: false, follow: false },
};

// Availability depends on ADMIN_PASSWORD_HASH / ADMIN_SESSION_SECRET, which
// exist only at runtime (/srv/callflow/.env), never at build time. Prerendering
// would bake a build-time 404 in as a static page, so force dynamic rendering.
export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  // Fail closed: without ADMIN_PASSWORD_HASH / ADMIN_SESSION_SECRET the login
  // page itself must not exist (spec: nobody can log in at all).
  if (!adminConfigured()) notFound();

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