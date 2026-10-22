"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  ChevronDown,
  Headset,
  MessageSquareText,
  Phone,
  RefreshCw,
  Voicemail,
} from "lucide-react";
import type { Call, CallOutcome, FollowUpStatus } from "@/lib/types";
import { apiFetch } from "@/lib/api";
import CallDetailGrid from "@/components/calls/CallDetailGrid";
import FollowUpControls from "@/components/calls/FollowUpControls";
import SetupStatusCard from "@/components/calls/SetupStatusCard";

const OUTCOME_META: Record<
  CallOutcome,
  { label: string; pill: string; iconBg: string; iconColor: string }
> = {
  booked: {
    label: "Booked",
    pill: "bg-booked/10 text-[#1f8a3b]",
    iconBg: "bg-booked/12",
    iconColor: "text-booked",
  },
  callback: {
    label: "Callback",
    pill: "bg-callback/12 text-[#b25e00]",
    iconBg: "bg-callback/12",
    iconColor: "text-callback",
  },
  voicemail: {
    label: "Voicemail",
    pill: "bg-wire/10 text-[#0062cc]",
    iconBg: "bg-wire/10",
    iconColor: "text-wire",
  },
  handled: {
    label: "Handled",
    pill: "bg-ink/6 text-ink-2",
    iconBg: "bg-ink/6",
    iconColor: "text-ink-2",
  },
  other: {
    label: "Other",
    pill: "bg-ink/6 text-ink-3",
    iconBg: "bg-ink/6",
    iconColor: "text-ink-3",
  },
};

const OUTCOME_ICON: Record<CallOutcome, typeof CalendarCheck> = {
  booked: CalendarCheck,
  callback: Phone,
  voicemail: Voicemail,
  handled: Headset,
  other: MessageSquareText,
};

/** Urgency badge on each call row: emergency=red, today=orange, else grey.
 * Canonical levels come from the Dograh webhook (dograh.ts URGENCY_LEVELS);
 * anything the agent captured free-form is shown verbatim on a grey badge. */
const URGENCY_BADGE: Record<string, { label: string; pill: string }> = {
  emergency: { label: "Emergency", pill: "bg-danger/10 text-danger" },
  today: { label: "Today", pill: "bg-callback/15 text-[#b25e00]" },
  this_week: { label: "This week", pill: "bg-ink/6 text-ink-3" },
  flexible: { label: "Flexible", pill: "bg-ink/6 text-ink-3" },
};

function urgencyBadgeOf(call: Call): { label: string; pill: string } | null {
  const raw = call.urgency?.trim();
  if (!raw) return null;
  return URGENCY_BADGE[raw.toLowerCase()] ?? { label: raw, pill: "bg-ink/6 text-ink-3" };
}

function outcomeOf(call: Call): CallOutcome {
  return call.outcome ?? "other";
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday(iso)) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export default function DashboardPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | CallOutcome>("all");
  const [followUpFilter, setFollowUpFilter] = useState<"all" | FollowUpStatus>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Owner-facing display name from /api/me (businesses.billingName). Absent →
  // the header falls back to a plain "Welcome".
  const [businessName, setBusinessName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ name?: string | null }>) : null))
      .then((data) => {
        if (!cancelled && data?.name) setBusinessName(data.name);
      })
      .catch(() => {
        // Signed out or transient failure: header shows plain "Welcome".
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function refresh() {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }

  /** Replace one call in place after a follow-up update. */
  function handleCallUpdated(updated: Call) {
    setCalls((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/calls")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json() as Promise<Call[]>;
      })
      .then((data) => {
        if (cancelled) return;
        setCalls(Array.isArray(data) ? data : []);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load your calls. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const stats = useMemo(() => {
    const today = calls.filter((c) => isToday(c.callStartedAt));
    // Still open = the owner has not closed the call out with "Called back"
    // yet (followUpStatus resolved). Emergencies count only while open.
    const open = calls.filter((c) => c.followUpStatus !== "resolved");
    return {
      today: today.length,
      emergency: open.filter((c) => c.urgency === "emergency").length,
      awaiting: open.length,
    };
  }, [calls]);

  const visible = useMemo(
    () =>
      calls
        .filter((c) => (filter === "all" ? true : outcomeOf(c) === filter))
        .filter((c) =>
          followUpFilter === "all" ? true : c.followUpStatus === followUpFilter
        ),
    [calls, filter, followUpFilter]
  );

  const followUpCounts = useMemo(
    () => ({
      needed: calls.filter((c) => c.followUpStatus === "needed").length,
      resolved: calls.filter((c) => c.followUpStatus === "resolved").length,
    }),
    [calls]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-3">
            CallFlow
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">
            {businessName ? `Welcome, ${businessName}` : "Welcome"}
          </h1>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink-2 shadow-sm transition active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {/* Forwarding + billing setup status, with the owner's manual steps */}
      <SetupStatusCard />

      {/* Today's stats */}
      <section className="grid grid-cols-3 gap-3" aria-label="Today at a glance">
        {[
          { label: "Calls today", value: stats.today, color: "text-ink" },
          { label: "Emergency", value: stats.emergency, color: "text-danger" },
          { label: "Awaiting callback", value: stats.awaiting, color: "text-callback" },
        ].map((s) => (
          <div key={s.label} className="ios-card px-3 py-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              {s.label}
            </p>
          </div>
        ))}
      </section>

      {/* Outcome filter */}
      <nav aria-label="Filter calls" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {(["all", "booked", "callback", "voicemail", "handled", "other"] as const).map(
          (key) => {
            const active = filter === key;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition ${
                  active
                    ? "bg-[#0b1f3a] text-white shadow-sm"
                    : "bg-white text-ink-2 shadow-sm active:scale-95"
                }`}
              >
                {key === "all" ? `All (${calls.length})` : key}
              </button>
            );
          }
        )}
      </nav>

      {/* Follow-up filter */}
      <nav aria-label="Filter follow-ups" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {(
          [
            ["all", `All (${calls.length})`],
            ["needed", `Needs follow-up (${followUpCounts.needed})`],
            ["resolved", `Resolved (${followUpCounts.resolved})`],
          ] as const
        ).map(([key, label]) => {
          const active = followUpFilter === key;
          return (
            <button
              key={key}
              onClick={() => setFollowUpFilter(key)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
                active
                  ? "bg-callback/15 text-[#b25e00] shadow-sm"
                  : "bg-white text-ink-2 shadow-sm active:scale-95"
              }`}
            >
              {label}
            </button>
          );
        })}
      </nav>

      {/* Call list */}
      <section aria-label="Recent calls" className="space-y-3">
        {error && (
          <div className="ios-card px-4 py-4 text-sm text-danger">
            {error}{" "}
            <button onClick={refresh} className="font-semibold underline">
              Try again
            </button>
          </div>
        )}

        {loading && calls.length === 0 && !error && (
          <div className="ios-card px-4 py-12 text-center text-sm text-ink-3">
            Loading your calls…
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="ios-card px-4 py-12 text-center">
            <Voicemail className="mx-auto h-8 w-8 text-ink-3" />
            <p className="mt-3 text-sm font-semibold text-ink">
              {calls.length === 0 ? "No calls yet" : "Nothing matches this filter"}
            </p>
            <p className="mt-1 text-sm text-ink-3">
              {calls.length === 0
                ? "When CallFlow catches a missed call, it lands here."
                : "Try another filter above."}
            </p>
          </div>
        )}

        {visible.map((call) => {
          const outcome = outcomeOf(call);
          const meta = OUTCOME_META[outcome];
          const Icon = OUTCOME_ICON[outcome];
          const open = expanded === call.id;
          const didNotConnect =
            call.callStatus === "failed" || call.callStatus === "missed";
          const urgency = urgencyBadgeOf(call);
          return (
            <article key={call.id} className="ios-card overflow-hidden">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : call.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/5"
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.iconBg} ${meta.iconColor}`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">
                    {call.customerName || call.callerNumber || "Unknown caller"}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-3">
                    {formatWhen(call.callStartedAt)} · {formatDuration(call.durationSeconds)}
                    {call.customerName ? ` · ${call.callerNumber}` : ""}
                    {didNotConnect
                      ? ` · ${call.callStatus === "failed" ? "Call failed" : "Missed"}`
                      : ""}
                  </span>
                  {call.serviceRequested && (
                    <span className="mt-0.5 block truncate text-[13px] text-ink-2">
                      {call.serviceRequested}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {urgency && (
                    <span
                      className={`max-w-[110px] truncate rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${urgency.pill}`}
                    >
                      {urgency.label}
                    </span>
                  )}
                  {call.followUpStatus === "needed" && (
                    <span className="rounded-full bg-callback/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#b25e00]">
                      Follow up
                    </span>
                  )}
                  {call.followUpStatus === "resolved" && (
                    <span className="rounded-full bg-booked/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#1f8a3b]">
                      Called back
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${meta.pill}`}
                  >
                    {meta.label}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </span>
              </button>

              {open && (
                <div className="border-t border-separator bg-[#fafafa] px-4 py-3">
                  {call.callbackNumber && (
                    <a
                      href={`tel:${call.callbackNumber}`}
                      className="ios-pill-primary mb-3 flex w-full items-center justify-center gap-2 px-4 py-3 text-[15px]"
                    >
                      <Phone className="h-4 w-4" /> Call back {call.callbackNumber}
                    </a>
                  )}
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
                      className="mt-2 mr-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-wire"
                    >
                      ▶ Listen to recording
                    </a>
                  )}
                  {call.transcriptUrl && (
                    <a
                      href={call.transcriptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-wire"
                    >
                      📄 Open transcript
                    </a>
                  )}
                  {call.calendarEventId && (
                    <p className="mt-2 text-[12px] text-ink-3">
                      Calendar event: <code>{call.calendarEventId}</code>
                    </p>
                  )}
                  <FollowUpControls call={call} onUpdated={handleCallUpdated} />
                </div>
              )}
            </article>
          );
        })}
      </section>

      {/* Footer */}
      <footer className="pt-2 text-center text-[13px] text-ink-3">
        <Link href="/calls" className="font-semibold text-wire">
          Full call log →
        </Link>
      </footer>
    </div>
  );
}


