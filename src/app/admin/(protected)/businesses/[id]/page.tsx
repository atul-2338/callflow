import Link from "next/link";
import { notFound } from "next/navigation";

import EditBusinessForm from "@/components/admin/EditBusinessForm";
import StatusPill from "@/components/admin/StatusPill";
import { adminListRecentCallsForBusiness } from "@/lib/admin-db";
import { formatAdminDateTime } from "@/lib/admin-format";
import { getBusinessById } from "@/lib/db";

type RouteParams = { params: Promise<{ id: string }> };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * Admin business detail (Phase 4): the full profile plus recent calls for
 * this business. getBusinessById is the shared read path from db.ts (admin-db
 * only adds admin-specific views); a missing id renders the app-wide 404.
 */
export default async function AdminBusinessDetailPage({ params }: RouteParams) {
  const { id } = await params;
  const business = await getBusinessById(id);
  if (!business) notFound();

  const recentCalls = await adminListRecentCallsForBusiness(id);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <Link href="/admin/businesses" className="transition hover:text-ink">
            Businesses
          </Link>
          <span>/</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-ink">
          {business.billingName ?? business.clientUid ?? business.id}
        </h1>
        <p className="mt-1 font-mono text-xs text-ink-3">
          {business.clientUid ?? "no client UID"} · {business.phoneNumber}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">Profile</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Detail label="Phone (destination number)">
              <span className="font-mono text-xs">{business.phoneNumber}</span>
            </Detail>
            <Detail label="Assigned CallFlow number">
              {business.assignedNumber ? (
                <span className="font-mono text-xs">{business.assignedNumber}</span>
              ) : (
                <span className="text-ink-3">— (shared CallFlow number)</span>
              )}
            </Detail>
            <Detail label="Carrier">{business.carrier}</Detail>
            <Detail label="Forwarding status">
              <StatusPill kind="forwarding" value={business.forwardingStatus} />
            </Detail>
            <Detail label="Last verified at">
              {formatAdminDateTime(business.lastVerifiedAt)}
            </Detail>
            <Detail label="Pending verification for">
              {business.pendingVerificationFor ?? "—"}
            </Detail>
            <Detail label="Created">
              {formatAdminDateTime(business.createdAt)}
            </Detail>
            <Detail label="Updated">
              {formatAdminDateTime(business.updatedAt)}
            </Detail>
          </dl>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">Billing &amp; subscription</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Detail label="Subscription status">
              <StatusPill kind="subscription" value={business.subscriptionStatus} />
            </Detail>
            <Detail label="Trial started">
              {formatAdminDateTime(business.trialStartedAt)}
            </Detail>
            <Detail label="Billing name">{business.billingName ?? "—"}</Detail>
            <Detail label="Billing email">{business.billingEmail ?? "—"}</Detail>
            <Detail label="Billing country">{business.billingCountry ?? "—"}</Detail>
            <Detail label="Dodo customer">
              {business.dodoCustomerId ?? "—"}
            </Detail>
            <Detail label="Dodo subscription">
              {business.dodoSubscriptionId ?? "—"}
            </Detail>
            <Detail label="Owner alert email">
              {business.notificationEmail ?? "—"}
            </Detail>
          </dl>
        </section>
      </div>

      <EditBusinessForm
        businessId={business.id}
        currentAssignedNumber={business.assignedNumber}
      />

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <h2 className="px-5 pt-5 text-sm font-semibold text-ink">
          Recent calls
        </h2>
        <div className="mt-3 overflow-x-auto">
          {recentCalls.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-3">
              No calls assigned to this business yet. Unlinked calls can be
              assigned from the{" "}
              <Link
                href="/admin/calls?filter=unlinked"
                className="underline-offset-2 hover:underline"
              >
                calls page
              </Link>
              .
            </p>
          ) : (
            <table className="w-full min-w-max text-left text-sm">
              <thead className="border-y border-separator bg-black/[0.02] text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-medium">Started</th>
                  <th className="px-5 py-3 font-medium">Caller</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Outcome</th>
                  <th className="px-5 py-3 font-medium">Customer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {recentCalls.map((call) => (
                  <tr key={call.id} className="hover:bg-black/[0.02]">
                    <td className="px-5 py-3 text-xs text-ink-3">
                      {formatAdminDateTime(call.callStartedAt)}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink">
                      {call.callerNumber || "—"}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill kind="call" value={call.callStatus} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill kind="outcome" value={call.outcome} />
                    </td>
                    <td className="px-5 py-3 text-ink-2">
                      {call.customerName ?? "—"}
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