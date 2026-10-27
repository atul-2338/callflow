import Link from "next/link";

import AddNumbersForm from "@/components/admin/AddNumbersForm";
import ReleaseNumberButton from "@/components/admin/ReleaseNumberButton";
import { adminListBusinesses } from "@/lib/admin-db";
import { formatAdminDateTime } from "@/lib/admin-format";
import { getPoolFilePath, listPool } from "@/lib/numbers-pool";

export const dynamic = "force-dynamic";

/**
 * Admin Numbers: the pool behind every business's assignedNumber. Paste new
 * "+1"-prefixed numbers to grow the pool, see what is assigned to whom, and
 * release a number back to the pool. The available count turns red below 3.
 */
export default async function AdminNumbersPage() {
  const [entries, businesses] = await Promise.all([
    Promise.resolve(listPool()),
    adminListBusinesses(),
  ]);
  const businessNameById = new Map(
    businesses.map((b) => [b.id, b.billingName ?? b.clientUid ?? b.id])
  );
  const available = entries.filter((e) => e.status === "available").length;
  const assigned = entries.filter((e) => e.status === "assigned").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Numbers</h1>
        <p className="mt-1 text-sm text-ink-2">
          The number pool — every business gets exactly one number from here,
          and the Dograh webhook attributes calls by it.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div
          className={`rounded-2xl p-5 shadow-sm ${
            available < 3 ? "bg-danger/10 ring-1 ring-danger/30" : "bg-white"
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
            Available
          </p>
          <p
            className={`mt-2 text-3xl font-bold ${
              available < 3 ? "text-danger" : "text-ink"
            }`}
          >
            {available}
          </p>
          {available < 3 && (
            <p className="mt-1 text-xs font-medium text-danger">
              Low pool — add numbers below before the next signup.
            </p>
          )}
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
            Assigned
          </p>
          <p className="mt-2 text-3xl font-bold text-ink">{assigned}</p>
        </div>
      </div>

      <AddNumbersForm />

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          {entries.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-3">
              The pool is empty — paste numbers above to get started.
            </p>
          ) : (
            <table className="w-full min-w-max text-left text-sm">
              <thead className="border-b border-separator bg-black/[0.02] text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-medium">Number</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Business</th>
                  <th className="px-5 py-3 font-medium">Assigned at</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {entries.map((entry) => (
                  <tr key={entry.number} className="hover:bg-black/[0.02]">
                    <td className="px-5 py-3 font-mono text-xs text-ink">
                      {entry.number}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                          entry.status === "available"
                            ? "bg-booked/10 text-[#1f8a3b]"
                            : "bg-wire/10 text-wire"
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-ink">
                      {entry.businessId ? (
                        <Link
                          href={`/admin/businesses/${entry.businessId}`}
                          className="text-xs underline-offset-2 hover:underline"
                        >
                          {businessNameById.get(entry.businessId) ??
                            entry.businessId}
                        </Link>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-3">
                      {entry.assignedAt
                        ? formatAdminDateTime(entry.assignedAt)
                        : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {entry.status === "assigned" && entry.businessId ? (
                        <ReleaseNumberButton businessId={entry.businessId} />
                      ) : (
                        <span className="text-xs text-ink-3">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <p className="text-xs text-ink-3">Pool file: {getPoolFilePath()}</p>
    </div>
  );
}