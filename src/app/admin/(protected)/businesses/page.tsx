import Link from "next/link";

import AssignNumberButton from "@/components/admin/AssignNumberButton";
import StatusPill from "@/components/admin/StatusPill";
import { adminListBusinessesWithLastCall } from "@/lib/admin-db";
import { formatAdminDateTime } from "@/lib/admin-format";

export const dynamic = "force-dynamic";

/**
 * Admin businesses index: name, owner phone, assigned number, trial status,
 * last call — plus the "Assign number" button for businesses still pending
 * one (assignedNumber IS NULL). Numbers come only from the pool
 * (/admin/numbers); there is no manual create and no manual number editing.
 */
export default async function AdminBusinessesPage() {
  const businesses = await adminListBusinessesWithLastCall();
  const pending = businesses.filter((b) => !b.assignedNumber).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Businesses</h1>
        <p className="mt-1 text-sm text-ink-2">
          {businesses.length} enrolled business
          {businesses.length === 1 ? "" : "es"} · {pending} pending a number.
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          {businesses.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-3">
              No businesses yet — they appear when an owner signs up.
            </p>
          ) : (
            <table className="w-full min-w-max text-left text-sm">
              <thead className="border-b border-separator bg-black/[0.02] text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Owner phone</th>
                  <th className="px-5 py-3 font-medium">Assigned number</th>
                  <th className="px-5 py-3 font-medium">Trial</th>
                  <th className="px-5 py-3 font-medium">Last call</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {businesses.map((business) => (
                  <tr key={business.id} className="hover:bg-black/[0.02]">
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/businesses/${business.id}`}
                        className="font-medium text-ink underline-offset-2 hover:underline"
                      >
                        {business.billingName ?? business.clientUid ?? business.id}
                      </Link>
                      <span className="ml-2 font-mono text-[11px] text-ink-3">
                        {business.clientUid ?? ""}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink">
                      {business.phoneNumber || "—"}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink">
                      {business.assignedNumber ?? (
                        <span className="font-sans text-ink-3">
                          pending_number
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill
                        kind="subscription"
                        value={business.subscriptionStatus}
                      />
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-3">
                      {business.lastCallAt
                        ? formatAdminDateTime(business.lastCallAt)
                        : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {business.assignedNumber ? (
                        <span className="text-xs text-ink-3">—</span>
                      ) : (
                        <AssignNumberButton businessId={business.id} />
                      )}
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