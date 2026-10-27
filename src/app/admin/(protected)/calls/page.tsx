import Link from "next/link";

import StatusPill from "@/components/admin/StatusPill";
import { adminListBusinesses, adminListCalls } from "@/lib/admin-db";
import { formatAdminDateTime } from "@/lib/admin-format";

type AdminCallsSearchParams = { page?: string; filter?: string };

function callsPageHref(filter: string, page: number): string {
  const params = new URLSearchParams({ filter, page: String(page) });
  return `/admin/calls?${params.toString()}`;
}

/**
 * Admin calls: paged, newest-first across ALL businesses with an UNLINKED
 * filter, driven entirely by searchParams so filtering/pagination are
 * server-rendered links (no client data fetching). Calls are attributed
 * automatically by assignedNumber — there is no manual assignment control.
 */
export default async function AdminCallsPage({
  searchParams,
}: {
  searchParams: Promise<AdminCallsSearchParams>;
}) {
  const sp = await searchParams;
  const filter = sp.filter === "unlinked" ? "unlinked" : "all";
  const rawPage = Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10);
  const requestedPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const data = await adminListCalls({
    page: requestedPage,
    unlinkedOnly: filter === "unlinked",
  });

  const tabClass = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-medium transition ${
      active
        ? "bg-[#0b1f3a] text-white"
        : "border border-separator bg-white text-ink-2 hover:text-ink"
    }`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Calls</h1>
        <p className="mt-1 text-sm text-ink-2">
          {data.total} call{data.total === 1 ? "" : "s"} total ·{" "}
          {data.calls.length} on this page.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/admin/calls?filter=all&page=1" className={tabClass(filter === "all")}>
          All calls
        </Link>
        <Link
          href="/admin/calls?filter=unlinked&page=1"
          className={tabClass(filter === "unlinked")}
        >
          Unlinked only
        </Link>
      </div>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          {data.calls.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-3">
              {filter === "unlinked"
                ? "No unlinked calls — every call is assigned to a business."
                : "No calls recorded yet."}
            </p>
          ) : (
            <table className="w-full min-w-max text-left text-sm">
              <thead className="border-b border-separator bg-black/[0.02] text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-medium">Started</th>
                  <th className="px-5 py-3 font-medium">Caller</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Outcome</th>
                  <th className="px-5 py-3 font-medium">Business</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {data.calls.map((call) => (
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
                    <td className="px-5 py-3">
                      {call.businessId ? (
                        <Link
                          href={`/admin/businesses/${call.businessId}`}
                          className="text-xs text-ink underline-offset-2 hover:underline"
                        >
                          {call.businessLabel ?? call.businessId}
                        </Link>
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

      <div className="flex items-center justify-between text-sm">
        {data.page > 1 ? (
          <Link
            href={callsPageHref(filter, data.page - 1)}
            className="rounded-lg border border-separator bg-white px-3 py-1.5 text-ink-2 transition hover:text-ink"
          >
            ← Previous
          </Link>
        ) : (
          <span />
        )}
        <span className="text-xs text-ink-3">
          Page {data.page} of {data.pageCount}
        </span>
        {data.page < data.pageCount ? (
          <Link
            href={callsPageHref(filter, data.page + 1)}
            className="rounded-lg border border-separator bg-white px-3 py-1.5 text-ink-2 transition hover:text-ink"
          >
            Next →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}