import Link from "next/link";

import CreateBusinessForm from "@/components/admin/CreateBusinessForm";
import StatusPill from "@/components/admin/StatusPill";
import { adminListBusinesses } from "@/lib/admin-db";
import { formatAdminDateTime } from "@/lib/admin-format";

/**
 * Admin businesses index (Phase 4): every enrolled business (not scoped to a
 * session like the owner view) plus the create form. Auth is enforced by the
 * (protected) group layout.
 */
export default async function AdminBusinessesPage() {
  const businesses = await adminListBusinesses();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Businesses</h1>
        <p className="mt-1 text-sm text-ink-2">
          {businesses.length} enrolled business
          {businesses.length === 1 ? "" : "es"}.
        </p>
      </div>

      <CreateBusinessForm />

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          {businesses.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-3">
              No businesses yet — create the first one above.
            </p>
          ) : (
            <table className="w-full min-w-max text-left text-sm">
              <thead className="border-b border-separator bg-black/[0.02] text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-medium">Client UID</th>
                  <th className="px-5 py-3 font-medium">Phone</th>
                  <th className="px-5 py-3 font-medium">Billing name</th>
                  <th className="px-5 py-3 font-medium">Carrier</th>
                  <th className="px-5 py-3 font-medium">Forwarding</th>
                  <th className="px-5 py-3 font-medium">Subscription</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {businesses.map((business) => (
                  <tr key={business.id} className="hover:bg-black/[0.02]">
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/businesses/${business.id}`}
                        className="font-mono text-xs font-medium text-ink underline-offset-2 hover:underline"
                      >
                        {business.clientUid ?? business.id}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink">
                      {business.phoneNumber}
                    </td>
                    <td className="px-5 py-3 text-ink">
                      {business.billingName ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-ink-2">{business.carrier}</td>
                    <td className="px-5 py-3">
                      <StatusPill kind="forwarding" value={business.forwardingStatus} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill kind="subscription" value={business.subscriptionStatus} />
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-3">
                      {formatAdminDateTime(business.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}