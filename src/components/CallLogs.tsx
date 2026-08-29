"use client";

import { useEffect, useState } from "react";
import { PhoneCall, RefreshCw } from "lucide-react";
import type { Call } from "@/lib/types";

const statusStyles: Record<string, string> = {
  answered: "bg-green-500/15 text-green-400",
  missed: "bg-red-500/15 text-red-400",
  busy: "bg-amber-500/15 text-amber-400",
  failed: "bg-red-500/15 text-red-400",
  voicemail_left: "bg-gold-500/15 text-gold-400",
};

export default function CallLogs() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const url = filter ? `/api/calls?status=${encodeURIComponent(filter)}` : "/api/calls";
      const res = await fetch(url);
      const data = await res.json();
      setCalls(data);
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const url = filter ? `/api/calls?status=${encodeURIComponent(filter)}` : "/api/calls";
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setCalls(data);
      })
      .catch(() => {
        if (!cancelled) setCalls([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-navy-600 bg-navy-800 px-3 py-2 text-sm text-white focus:border-gold-400 focus:outline-none"
        >
          <option value="">All calls</option>
          <option value="answered">Answered</option>
          <option value="missed">Missed</option>
          <option value="busy">Busy</option>
          <option value="failed">Failed</option>
          <option value="voicemail_left">Voicemail left</option>
        </select>
        <button
          onClick={load}
          className="flex items-center gap-2 self-start rounded-lg border border-navy-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-navy-800"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-navy-700 bg-navy-900 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-700 bg-navy-800/60">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Caller
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Started
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Duration
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Voicemail
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                    Loading call logs...
                  </td>
                </tr>
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                    No call logs yet.
                  </td>
                </tr>
              ) : (
                calls.map((call) => (
                  <tr key={call.id} className="border-b border-navy-800 hover:bg-navy-800/40">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 font-medium text-white">
                        <PhoneCall className="h-4 w-4 text-slate-500" />
                        {call.callerNumber || "Unknown"}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          statusStyles[call.callStatus] || "bg-slate-500/15 text-slate-400"
                        }`}
                      >
                        {call.callStatus.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-400">
                      {new Date(call.callStartedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-400">
                      {call.durationSeconds != null ? `${call.durationSeconds}s` : "—"}
                    </td>
                    <td className="max-w-xs px-4 py-4">
                      {call.callStatus === "voicemail_left" ? (
                        <div className="space-y-1">
                          {call.transcript && (
                            <p className="truncate text-sm text-slate-300" title={call.transcript}>
                              &ldquo;{call.transcript}&rdquo;
                            </p>
                          )}
                          {call.recordingUrl && (
                            <a
                              href={call.recordingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-gold-400 hover:underline"
                            >
                              Listen to recording
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
