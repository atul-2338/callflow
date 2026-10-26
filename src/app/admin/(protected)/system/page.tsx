import StatusPill from "@/components/admin/StatusPill";
import { adminSystemInfo } from "@/lib/admin-db";
import { formatAdminBytes, formatAdminDateTime } from "@/lib/admin-format";

/**
 * Admin system status (Phase 4): runtime versions, database location, env
 * NAMES with set/not-set badges (values are never rendered — the data layer
 * never even reads them), and Dograh webhook results DERIVED from the calls
 * table (dograhRunId IS NOT NULL) instead of any persisted webhook log — the
 * Dograh webhook handler is off-limits to admin changes.
 */
export default async function AdminSystemPage() {
  const info = await adminSystemInfo();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">System</h1>
        <p className="mt-1 text-sm text-ink-2">
          Runtime, database, and configuration status. Secret values are never
          shown — only whether each variable is set.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">Runtime</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
                Node
              </dt>
              <dd className="mt-1 font-mono text-sm text-ink">{info.nodeVersion}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
                CallFlow
              </dt>
              <dd className="mt-1 font-mono text-sm text-ink">
                {info.appVersion ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
                Next / React / better-sqlite3
              </dt>
              <dd className="mt-1 font-mono text-xs text-ink">
                {info.versions
                  ? `${info.versions.next ?? "?"} / ${info.versions.react ?? "?"} / ${
                      info.versions.betterSqlite3 ?? "?"
                    }`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
                Database file
              </dt>
              <dd className="mt-1 font-mono text-xs text-ink">
                {info.dbPath}
                {info.dbFileBytes != null
                  ? ` · ${formatAdminBytes(info.dbFileBytes)}`
                  : ""}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">Configuration</h2>
          <p className="mt-1 text-xs text-ink-3">
            Variable names and set/not-set only. Values live exclusively in the
            server&apos;s env file.
          </p>
          <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {info.envStatus.map((entry) => (
              <li
                key={entry.name}
                className="flex items-center justify-between gap-2 rounded-lg border border-separator px-3 py-1.5"
              >
                <span className="font-mono text-xs text-ink">{entry.name}</span>
                <span
                  className={`text-xs font-medium ${
                    entry.set ? "text-[#1f8a3b]" : "text-ink-3"
                  }`}
                >
                  {entry.set ? "Set" : "Not set"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="px-5 pt-5">
          <h2 className="text-sm font-semibold text-ink">
            Dograh webhook results (derived)
          </h2>
          <p className="mt-1 text-xs text-ink-3">
            Latest end-of-call webhook deliveries, derived from the calls table
            (rows with a Dograh run id). {info.dograhCallCount} ingested total.
          </p>
        </div>
        <div className="mt-3 overflow-x-auto">
          {info.recentDograhCalls.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-3">
              No Dograh webhook results ingested yet.
            </p>
          ) : (
            <table className="w-full min-w-max text-left text-sm">
              <thead className="border-y border-separator bg-black/[0.02] text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-medium">Started</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Outcome</th>
                  <th className="px-5 py-3 font-medium">Disposition</th>
                  <th className="px-5 py-3 font-medium">Call id</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-separator">
                {info.recentDograhCalls.map((call) => (
                  <tr key={call.id} className="hover:bg-black/[0.02]">
                    <td className="px-5 py-3 text-xs text-ink-3">
                      {formatAdminDateTime(call.callStartedAt)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill kind="call" value={call.callStatus} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill kind="outcome" value={call.outcome} />
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-2">
                      {call.dograhDisposition ?? "—"}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink">
                      {call.id}
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