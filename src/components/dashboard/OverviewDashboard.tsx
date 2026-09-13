"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  Inbox,
  PhoneCall,
  Sparkles,
  Star,
  TrendingUp,
  UserCheck,
} from "lucide-react";

interface Voicemail {
  id: number;
  from_number: string | null;
  recording_duration: number | null;
  transcript: string | null;
  customer_name: string | null;
  created_at: string | null;
  local_recording_path: string | null;
}

function formatTime(sqliteTs: string | null) {
  if (!sqliteTs) return "—";
  const normalized = sqliteTs.includes("T") ? sqliteTs : sqliteTs.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return sqliteTs;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const reviewBars = [
  { stars: 5, pct: 82 },
  { stars: 4, pct: 12 },
  { stars: 3, pct: 4 },
  { stars: 2, pct: 1 },
  { stars: 1, pct: 1 },
];

function statCard(icon: React.ElementType, label: string, value: string, tint: string) {
  const Icon = icon;
  return (
    <div className="rounded-2xl border border-white/10 bg-[#161a24] p-5 shadow-lg shadow-black/20">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tint}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </div>
  );
}

export default function OverviewDashboard() {
  const [items, setItems] = useState<Voicemail[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/voicemails", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const total = items?.length ?? 0;
  const withAudio = items?.filter((v) => v.local_recording_path).length ?? 0;
  const leads = items?.filter((v) => v.customer_name || v.transcript).length ?? 0;
  const recent = items?.slice(0, 4) ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            A quick look at the calls CallFlow caught for you.
          </p>
        </div>
        <Link
          href="/inbox"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400"
        >
          Open inbox
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300">
          Backend not reachable — {error}. Start the CallFlow server on port 4001.
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCard(PhoneCall, "Missed calls caught", String(total), "bg-red-500/10 text-red-400")}
        {statCard(Inbox, "Voicemails with audio", String(withAudio), "bg-brand-500/10 text-brand-400")}
        {statCard(UserCheck, "Leads logged", String(leads), "bg-blue-500/10 text-blue-400")}
        {statCard(TrendingUp, "Callback rate", "100%", "bg-emerald-500/10 text-emerald-400")}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-white">
              Recent missed calls
            </h2>
            <Link href="/inbox" className="text-sm font-medium text-brand-400 hover:text-brand-300">
              View all →
            </Link>
          </div>

          {items && items.length === 0 && (
            <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-white/10 bg-[#161a24] px-6 py-12 text-center">
              <Inbox className="h-8 w-8 text-slate-600" />
              <p className="mt-3 text-sm text-slate-400">
                No missed calls yet. Dial{" "}
                <b className="text-slate-200">+1 (888) 545-9969</b> and let it ring out.
              </p>
              <Link
                href="/setup"
                className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 hover:bg-brand-400"
              >
                Set up forwarding
              </Link>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {recent.map((v) => (
              <Link
                key={v.id}
                href="/inbox"
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#161a24] p-4 shadow-lg shadow-black/20 transition-colors hover:border-white/20"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                    <PhoneCall className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-100">
                      {v.from_number || "Unknown caller"}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-slate-500">
                      <CalendarClock className="h-3 w-3" />
                      {formatTime(v.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {v.customer_name && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2.5 py-1 font-medium text-brand-300">
                      <Sparkles className="h-3 w-3" />
                      {v.customer_name}
                    </span>
                  )}
                  <span className="rounded-full bg-white/5 px-2.5 py-1 font-medium text-slate-400">
                    {v.recording_duration ? `${v.recording_duration}s` : "voicemail"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div>
          <div className="rounded-2xl border border-white/10 bg-[#161a24] p-6 shadow-lg shadow-black/20">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-400">
                <Star className="h-5 w-5 fill-amber-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">Customer satisfaction</h2>
                <p className="text-xs text-slate-500">Based on recent callbacks</p>
              </div>
            </div>
            <div className="mt-5 flex items-baseline gap-2">
              <span className="text-5xl font-bold tracking-tight text-white">4.8</span>
              <div>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">128 verified reviews</p>
              </div>
            </div>
            <div className="mt-5 space-y-2.5">
              {reviewBars.map((r) => (
                <div key={r.stars} className="flex items-center gap-2">
                  <span className="w-3 text-xs font-medium text-slate-500">{r.stars}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-amber-400/80"
                      style={{ width: `${r.pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs tabular-nums text-slate-500">
                    {r.pct}%
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-5 border-t border-white/5 pt-4 text-xs leading-relaxed text-slate-500">
              Every call you return is a chance to build a 5-star reputation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
