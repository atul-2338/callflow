"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, PhoneCall, RefreshCw } from "lucide-react";
import type { Call, FollowUpStatus } from "@/lib/types";
import CallDetailGrid from "@/components/calls/CallDetailGrid";
import FollowUpControls from "@/components/calls/FollowUpControls";

const statusStyles: Record<string, string> = {
  answered: "bg-booked/10 text-[#1f8a3b]",
  missed: "bg-danger/10 text-danger",
  busy: "bg-callback/12 text-[#b25e00]",
  failed: "bg-danger/10 text-danger",
  voicemail_left: "bg-gold/15 text-gold-strong",
};

const followUpStyles: Record<FollowUpStatus, string> = {
  none: "bg-ink/6 text-ink-3",
  needed: "bg-callback/15 text-[#b25e00]",
  resolved: "bg-booked/12 text-[#1f8a3b]",
};

const FOLLOW_UP_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Any follow-up state" },
  { value: "none", label: "No action yet" },
  { value: "needed", label: "Needs follow-up" },
  { value: "resolved", label: "Resolved" },
];

export default function CallLogs() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [followUpFilter, setFollowUpFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);

  function handleCallUpdated(updated: Call) {
    setCalls((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  function callUrl() {
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    if (followUpFilter) params.set("followUp", followUpFilter);
    const query = params.toString();
    return query ? `/api/calls?${query}` : "/api/calls";
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(callUrl());
      const data = await res.json();
      setCalls(Array.isArray(data) ? data : []);
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const url = callUrl();
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setCalls(Array.isArray(data) ? data : []);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, followUpFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
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
          <select
            value={followUpFilter}
            onChange={(e) => setFollowUpFilter(e.target.value)}
            className="rounded-lg border border-separator bg-white px-3 py-2 text-sm text-ink focus:border-wire focus:outline-none focus:ring-2 focus:ring-wire/20"
          >
            {FOLLOW_UP_OPTIONS.map(({ value, label }) => (
              <option key={value || "any"} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
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
                  Follow-up
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">
                  Voicemail
                </th>
                <th className="w-8 px-2 py-3" aria-label="Expand row" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-ink-3">
                    Loading call logs...
                  </td>
                </tr>
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-ink-3">
                    No call logs yet.
                  </td>
                </tr>
              ) : (
                calls.map((call) => {
                  const open = expanded === call.id;
                  return (
                    <Fragment key={call.id}>
                      <tr className="border-b border-separator hover:bg-black/[0.02]">
                        <td className="px-4 py-4">
                          <button
                            type="button"
                            onClick={() => setExpanded(open ? null : call.id)}
                            className="flex items-center gap-2 text-left font-medium text-ink"
                            aria-expanded={open}
                          >
                            <PhoneCall className="h-4 w-4 shrink-0 text-ink-3" />
                            {call.customerName || call.callerNumber || "Unknown"}
                            {call.customerName ? (
                              <span className="text-xs text-ink-3">· {call.callerNumber}</span>
                            ) : null}
                          </button>
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
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${followUpStyles[call.followUpStatus]}`}
                          >
                            {call.followUpStatus === "none"
                              ? "—"
                              : call.followUpStatus === "needed"
                                ? "Needed"
                                : "Resolved"}
                          </span>
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
                        <td className="px-2 py-4 text-center">
                          <ChevronDown
                            className={`h-4 w-4 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
                          />
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-separator bg-[#fafafa]">
                          <td colSpan={7} className="px-4 py-4">
                            <CallDetailGrid call={call} />
                            {call.transcript && (
                              <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-2">
                                {call.transcript}
                              </pre>
                            )}
                            {call.recordingUrl && (
                              <a
                                href={call.recordingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-wire"
                              >
                                ▶ Listen to recording
                              </a>
                            )}
                            <FollowUpControls call={call} onUpdated={handleCallUpdated} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
