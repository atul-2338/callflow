import LeadStatusSelect from "@/components/admin/LeadStatusSelect";
import { adminListLeads } from "@/lib/admin-db";
import { formatAdminDateTime } from "@/lib/admin-format";
import { LEAD_STATUSES } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Admin Leads: everyone who asked for CallFlow from the public /start page,
 * newest first, with the status each one is at (new → contacted →
 * account_created → dead).
 *
 * Admin-only twice over, like every page in this group: the app/admin/(protected)
 * layout calls requireAdminPage() (307 to /admin when signed out, 404 while the
 * admin env vars are missing) and the status PATCH behind each row takes the
 * admin cookie only — an owner's callflow_business_session is never accepted.
 *
 * Read-only otherwise: a lead becomes a customer through the existing
 * "Create customer" form (/admin/customers), which is what "account created"
 * means here.
 */
export default async function AdminLeadsPage() {
  const leads = await adminListLeads();

  const counts = LEAD_STATUSES.map((status) => ({
    status,
    count: leads.filter((lead) => lead.status === status).length,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Leads</h1>
        <p className="mt-1 text-sm text-ink-2">
          Requests from the public /start page. Call them back, then move the
          status along; creating the account happens in{" "}
          <span className="font-medium text-ink">Customers</span>.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map(({ status, count }) => (
          <div key={status} className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-ink-3">
              {status.replace("_", " ")}
            </p>
            <p className="mt-1 text-2xl font-bold text-ink">{count}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          {leads.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-3">
              No leads yet. The public form lives at{" "}
              <code className="font-mono text-xs">/start</code>.
            </p>
          ) : (
            <table className="w-full min-w-max text-left text-sm">
              <thead className="border-b border-separator bg-black/[0.02] text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Phone</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Received</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-black/[0.02]">
                    <td className="px-5 py-3 font-medium text-ink">{lead.name}</td>
                    <td className="px-5 py-3">
                      <a
                        href={`tel:${lead.phone}`}
                        className="font-mono text-xs text-ink underline-offset-2 hover:underline"
                      >
                        {lead.phone}
                      </a>
                    </td>
                    <td className="px-5 py-3">
                      <a
                        href={`mailto:${lead.email}`}
                        className="text-xs text-wire underline-offset-2 hover:underline"
                      >
                        {lead.email}
                      </a>
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-3">
                      {formatAdminDateTime(lead.createdAt)}
                      {lead.updatedAt !== lead.createdAt && (
                        <span className="block text-[11px]">
                          updated {formatAdminDateTime(lead.updatedAt)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <LeadStatusSelect leadId={lead.id} status={lead.status} />
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
