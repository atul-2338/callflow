import Link from "next/link";

import {
  adminCountBusinesses,
  adminCountCalls,
  adminCountUnlinkedCalls,
  adminListAuditEntries,
} from "@/lib/admin-db";
import { formatAdminDateTime } from "@/lib/admin-format";

/**
 * Admin overview body (Phase 4). Four live stat cards plus the latest admin
 * activity; every section links deeper into the panel. Rendered by the /admin
 * entry page for signed-in admins, inside AdminPanelShell — access control
 * lives in adminPageSessionActive(), not here.
 */
export default async function AdminOverview() {
  const [businesses, calls, unlinked, audit] = await Promise.all([
    adminCountBusinesses(),
    adminCountCalls(),
    adminCountUnlinkedCalls(),
    adminListAuditEntries(5),
  ]);

  const cards = [
    { label: "Businesses", value: businesses, href: "/admin/businesses" },
    { label: "Calls", value: calls, href: "/admin/calls" },
    { label: "Unlinked calls", value: unlinked, href: "/admin/calls?filter=unlinked" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Overview</h1>
        <p className="mt-1 text-sm text-ink-2">
          Live counts across the whole CallFlow instance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-2xl bg-white p-5 shadow-sm transition hover:shadow"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
              {card.label}
            </p>
            <p className="mt-2 text-3xl font-bold text-ink">{card.value}</p>
          </Link>
        ))}
        <Link
          href="/admin/audit"
          className="rounded-2xl bg-white p-5 shadow-sm transition hover:shadow"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
            Audit entries
          </p>
          <p className="mt-2 text-3xl font-bold text-ink">{audit.total}</p>
        </Link>
      </div>

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Latest admin activity</h2>
          <Link
            href="/admin/audit"
            className="text-xs font-medium text-ink-2 transition hover:text-ink"
          >
            View full audit log →
          </Link>
        </div>
        {audit.entries.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">
            No admin actions recorded yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-separator">
            {audit.entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="font-mono text-xs text-ink">{entry.action}</span>
                <span className="text-xs text-ink-3">
                  {formatAdminDateTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}