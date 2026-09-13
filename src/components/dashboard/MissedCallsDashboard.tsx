"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  Inbox,
  MapPin,
  Phone,
  PhoneCall,
  RefreshCw,
  User,
  Wrench,
} from "lucide-react";

interface Voicemail {
  id: number;
  from_number: string | null;
  recording_duration: number | null;
  transcript: string | null;
  customer_name: string | null;
  customer_address: string | null;
  technical_issue: string | null;
  created_at: string | null;
  local_recording_path: string | null;
}

function formatTime(sqliteTs: string | null) {
  if (!sqliteTs) return "—";
  const normalized = sqliteTs.includes("T") ? sqliteTs : sqliteTs.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return sqliteTs;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function MissedCallsDashboard() {
  const [items, setItems] = useState<Voicemail[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/voicemails", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setItems(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load voicemails");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Missed calls</h1>
          <p className="mt-1 text-sm text-slate-500">
            Voicemails caught while you were busy. Call them back before a competitor does.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-slate-200 shadow-sm transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300">
          <p className="font-semibold">Backend not reachable</p>
          <p className="mt-1">
            {error} — make sure the CallFlow server is running on port 4001
            (<code className="font-mono">npm start</code> in D:\callflow-new).
          </p>
        </div>
      )}

      {!loading && items && items.length === 0 && !error && (
        <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-white/10 bg-[#161a24] px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-400">
            <Inbox className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-lg font-semibold text-white">No missed calls yet</h2>
          <p className="mt-1 max-w-md text-sm text-slate-400">
            Missed-call voicemails will appear here automatically. Dial{" "}
            <b className="text-slate-200">+1 (888) 545-9969</b> and let it ring out to
            record one.
          </p>
          <Link
            href="/setup"
            className="mt-6 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400"
          >
            Set up call forwarding
          </Link>
        </div>
      )}

      <div className="mt-6 space-y-4">
        {items?.map((v) => (
          <div
            key={v.id}
            className="rounded-2xl border border-white/10 bg-[#161a24] p-5 shadow-lg shadow-black/20"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                  <PhoneCall className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-base font-semibold text-white">
                    {v.from_number || "Unknown caller"}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {formatTime(v.created_at)}
                    {v.recording_duration ? ` · ${v.recording_duration}s voicemail` : ""}
                  </p>
                </div>
              </div>
              <a
                href={`tel:${v.from_number}`}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400"
              >
                <Phone className="h-4 w-4" />
                Call back
              </a>
            </div>

            {v.local_recording_path && (
              <audio
                controls
                preload="none"
                src={v.local_recording_path}
                className="mt-4 w-full"
              />
            )}

            {(v.customer_name || v.customer_address || v.technical_issue) && (
              <div className="mt-4 grid gap-3 rounded-xl border border-white/5 bg-white/5 p-4 sm:grid-cols-3">
                <div className="flex items-start gap-2">
                  <User className="mt-0.5 h-4 w-4 text-brand-400" />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Name
                    </p>
                    <p className="text-sm font-medium text-slate-200">
                      {v.customer_name || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 text-brand-400" />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Address
                    </p>
                    <p className="text-sm font-medium text-slate-200">
                      {v.customer_address || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Wrench className="mt-0.5 h-4 w-4 text-brand-400" />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Issue
                    </p>
                    <p className="text-sm font-medium text-slate-200">
                      {v.technical_issue || "—"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {v.transcript && (
              <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.03] p-3.5">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Transcript
                </p>
                <p className="mt-1 text-sm leading-relaxed text-slate-300">
                  “{v.transcript}”
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
