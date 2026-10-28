import Link from "next/link";

import CreateCustomerForm from "@/components/admin/CreateCustomerForm";
import NewLoginLinkButton from "@/components/admin/NewLoginLinkButton";
import { adminListBusinessesWithLastCall } from "@/lib/admin-db";
import { formatAdminDateTime } from "@/lib/admin-format";
import { trialEndsAt } from "@/lib/billing";

export const dynamic = "force-dynamic";

/**
 * Admin Customers: create a customer by hand (no payment, 3-day trial starting
 * now, one-time owner login link) and see every customer with its number, trial
 * end and last call.
 *
 * The list shows every businesses row — an admin-created customer is
 * deliberately indistinguishable from a self-signed-up one (same table, same
 * fields), so there is no marker to filter on; the columns below are simply the
 * ones this page needs.
 *
 * Admin-only twice over: the page lives in the app/admin/(protected) group
 * (requireAdminPage → /admin when signed out, 404 while the admin env vars are
 * missing) and every /api/admin/* route behind its buttons takes the admin
 * cookie only — an owner's callflow_business_session is never accepted.
 */
export default async function AdminCustomersPage() {
  const businesses = await adminListBusinessesWithLastCall();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Customers</h1>
        <p className="mt-1 text-sm text-ink-2">
          Create a customer without payment: the 3-day trial starts immediately
          and the one-time login link is what you send the owner.
        </p>
      </div>

      <CreateCustomerForm />

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          {businesses.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-3">
              No customers yet — create one above.
            </p>
          ) : (
            <table className="w-full min-w-max text-left text-sm">
              <thead className="border-b border-separator bg-black/[0.02] text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Assigned number</th>
                  <th className="px-5 py-3 font-medium">Trial ends</th>
                  <th className="px-5 py-3 font-medium">Last call</th>
                  <th className="px-5 py-3 font-medium">Login link</th>
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
                      {business.ownerName && (
                        <span className="block text-xs text-ink-3">
                          Owner: {business.ownerName}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink">
                      {business.assignedNumber ?? (
                        <span className="font-sans text-ink-3">
                          pending_number
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-3">
                      {business.trialStartedAt
                        ? formatAdminDateTime(trialEndsAt(business.trialStartedAt))
                        : "—"}
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-3">
                      {business.lastCallAt
                        ? formatAdminDateTime(business.lastCallAt)
                        : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <NewLoginLinkButton businessId={business.id} />
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
