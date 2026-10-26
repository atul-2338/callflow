import { adminListAuditEntries } from "@/lib/admin-db";
import { formatAdminDateTime } from "@/lib/admin-format";

/**
 * Admin audit trail (Phase 4): newest-first listing of every recorded admin
 * action (sign-ins, sign-outs, and every admin write). Details are the
 * caller-built JSON written by logAdminAction() — ids/counts only, never
 * secrets, headers, or raw bodies.
 */
export default async function AdminAuditPage() {
  const { entries, total, limit } = await adminListAuditEntries(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Audit log</h1>
        <p className="mt-1 text-sm text-ink-2">
          Showing the latest {entries.length} of {total} entr
          {total === 1 ? "y" : "ies"} (limit {limit}).
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          {entries.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-3">
              No admin actions recorded yet.
            </p>
          ) : (
            <table className="w-full min-w-max text-left text-sm">
              <thead className="border-b border-separator bg-black/[0.02] text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Target</th>
                  <th className="px-5 py-3 font-medium">IP</th>
                  <th className="px-5 py-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-black/[0.02]">
                    <td className="px-5 py-3 text-xs text-ink-3">
                      {formatAdminDateTime(entry.createdAt)}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs font-medium text-ink">
                      {entry.action}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-2">
                      {entry.target ?? "—"}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-2">
                      {entry.ip || "—"}
                    </td>
                    <td className="max-w-80 px-5 py-3">
                      {entry.details ? (
                        <code
                          title={entry.details}
                          className="block truncate font-mono text-xs text-ink-2"
                        >
                          {entry.details}
                        </code>
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
    </div>
  );
}