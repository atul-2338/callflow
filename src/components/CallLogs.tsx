"use client";

import { useEffect, useState } from "react";
import { PhoneCall, RefreshCw } from "lucide-react";
import type { Call } from "@/lib/types";

const statusStyles: Record<string, string> = {
  answered: "bg-booked/10 text-[#1f8a3b]",
  missed: "bg-danger/10 text-danger",
  busy: "bg-callback/12 text-[#b25e00]",
  failed: "bg-danger/10 text-danger",
  voicemail_left: "bg-gold/15 text-gold-strong",
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
          className="rounded-lg border border-separator bg-white px-3 py-2 text-sm text-ink focus:border-wire focus:outline-none focus:ring-2 focus:ring-wire/20"
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
          className="flex items-center gap-2 self-start rounded-lg border border-separator bg-white px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-black/[0.03]"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-separator bg-black/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Caller
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Started
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Duration
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Voicemail
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-ink-3">
                    Loading call logs...
                  </td>
                </tr>
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-ink-3">
                    No call logs yet.
                  </td>
                </tr>
              ) : (
                calls.map((call) => (
                  <tr key={call.id} className="border-b border-separator hover:bg-black/[0.02]">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2 font-medium text-ink">
                        <PhoneCall className="h-4 w-4 text-ink-3" />
                        {call.callerNumber || "Unknown"}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          statusStyles[call.callStatus] || "bg-ink/6 text-ink-3"
                        }`}
                      >
                        {call.callStatus.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-ink-2">
                      {new Date(call.callStartedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-sm text-ink-2">
                      {call.durationSeconds != null ? `${call.durationSeconds}s` : "—"}
                    </td>
                    <td className="max-w-xs px-4 py-4">
                      {call.callStatus === "voicemail_left" ? (
                        <div className="space-y-1">
                          {call.transcript && (
                            <p className="truncate text-sm text-ink-2" title={call.transcript}>
                              &ldquo;{call.transcript}&rdquo;
                            </p>
                          )}
                          {call.recordingUrl && (
                            <a
                              href={call.recordingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-wire hover:underline"
                            >
                              Listen to recording
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-ink-3">—</span>
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
