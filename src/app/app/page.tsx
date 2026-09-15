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
import type { Call, CallOutcome } from "@/lib/types";
import { apiFetch } from "@/lib/api";

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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  function refresh() {
    setLoading(true);
    setReloadKey((k) => k + 1);
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
    const count = (o: CallOutcome) =>
      today.filter((c) => outcomeOf(c) === o).length;
    return {
      booked: count("booked"),
      callback: count("callback"),
      voicemail: count("voicemail"),
    };
  }, [calls]);

  const visible = useMemo(
    () =>
      filter === "all" ? calls : calls.filter((c) => outcomeOf(c) === filter),
    [calls, filter]
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
            Today
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

      {/* Today's stats */}
      <section className="grid grid-cols-3 gap-3" aria-label="Today at a glance">
        {[
          { label: "Booked", value: stats.booked, color: "text-booked" },
          { label: "Callbacks", value: stats.callback, color: "text-callback" },
          { label: "Voicemails", value: stats.voicemail, color: "text-wire" },
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
          const details = call.transcript || call.recordingUrl;
          return (
            <article key={call.id} className="ios-card overflow-hidden">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : call.id)}
                disabled={!details}
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left ${
                  details ? "active:bg-black/5" : "cursor-default"
                }`}
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
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${meta.pill}`}
                  >
                    {meta.label}
                  </span>
                  {details && (
                    <ChevronDown
                      className={`h-4 w-4 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  )}
                </span>
              </button>

              {open && details && (
                <div className="border-t border-separator bg-[#fafafa] px-4 py-3">
                  {call.transcript && (
                    <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-2">
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
                  {call.calendarEventId && (
                    <p className="mt-2 text-[12px] text-ink-3">
                      Calendar event: <code>{call.calendarEventId}</code>
                    </p>
                  )}
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


