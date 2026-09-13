"use client";

import { useEffect, useState } from "react";
import { Phone, PhoneOff, Plus, Delete, History, Loader2 } from "lucide-react";

interface LogEntry {
  number: string;
  message: string;
  ok: boolean;
  time: string;
}

const LOG_KEY = "callflow_dialer_history";

function loadLog(): LogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export default function PcDialer() {
  const [number, setNumber] = useState("");
  const [calling, setCalling] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  useEffect(() => {
    setLog(loadLog());
  }, []);

  function press(d: string) {
    setNumber((n) => n + d);
  }

  function appendToLog(entry: LogEntry) {
    const next = [entry, ...loadLog()].slice(0, 8);
    try {
      window.localStorage.setItem(LOG_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    setLog(next);
  }

  async function call() {
    const to = number.trim();
    if (!to) {
      setStatus({ ok: false, text: "Enter a number first." });
      return;
    }
    setCalling(true);
    setStatus(null);
    try {
      const body = new URLSearchParams({ to });
      const res = await fetch("/api/dial", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const data = await res.json();
      const ok = res.ok;
      setStatus({ ok, text: data.message || (ok ? "Call queued." : "Call failed.") });
      appendToLog({ number: to, message: data.message || "", ok, time: new Date().toLocaleTimeString() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setStatus({ ok: false, text: msg });
      appendToLog({ number: to, message: msg, ok: false, time: new Date().toLocaleTimeString() });
    } finally {
      setCalling(false);
    }
  }

  const keys = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["*", "0", "#"],
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-white">PC Dialer</h1>
      <p className="mt-1 text-sm text-slate-500">
        Dial a number from your PC — CallFlow places the call through Plivo.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-[#161a24] p-6 shadow-lg shadow-black/20">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-right">
            <p className="text-3xl font-semibold tracking-wide text-white">{number || " "}</p>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2.5">
            {keys.flat().map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => press(k)}
                className="rounded-xl border border-white/10 bg-white/5 py-3.5 text-xl font-semibold text-white transition-colors hover:bg-white/10 active:scale-95"
              >
                {k}
              </button>
            ))}
            <button
              type="button"
              onClick={() => press("+")}
              className="rounded-xl border border-white/10 bg-white/5 py-3.5 text-xl font-semibold text-white transition-colors hover:bg-white/10 active:scale-95"
            >
              <Plus className="mx-auto h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setNumber("")}
              className="rounded-xl border border-white/10 bg-white/5 py-3.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/10 active:scale-95"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setNumber((n) => n.slice(0, -1))}
              className="rounded-xl border border-white/10 bg-white/5 py-3.5 text-slate-300 transition-colors hover:bg-white/10 active:scale-95"
            >
              <Delete className="mx-auto h-5 w-5" />
            </button>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={call}
              disabled={calling}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:bg-emerald-400 disabled:opacity-50"
            >
              {calling ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Phone className="h-5 w-5" />
              )}
              Call
            </button>
            <button
              type="button"
              onClick={() => {
                setNumber("");
                setStatus(null);
              }}
              className="flex items-center justify-center gap-2 rounded-xl bg-red-500/80 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-500/20 transition-colors hover:bg-red-500"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
          </div>

          {status && (
            <p
              className={`mt-4 rounded-lg px-3 py-2 text-sm ${
                status.ok
                  ? "bg-emerald-500/10 text-emerald-300"
                  : "bg-red-500/10 text-red-300"
              }`}
            >
              {status.text}
            </p>
          )}

          <p className="mt-3 text-xs text-slate-500">
            Tip: dial <b className="text-slate-300">+18885459969</b> to trigger the missed-call
            → voicemail flow.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#161a24] p-6 shadow-lg shadow-black/20">
          <div className="flex items-center gap-2.5">
            <History className="h-5 w-5 text-brand-400" />
            <h2 className="text-base font-semibold text-white">Call history</h2>
          </div>
          {log.length === 0 ? (
            <p className="mt-6 text-center text-sm text-slate-500">
              No calls yet. Dial a number to get started.
            </p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {log.map((entry, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-white/5 bg-white/5 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">
                      {entry.number}
                    </span>
                    <span className="text-xs text-slate-500">{entry.time}</span>
                  </div>
                  <p
                    className={`mt-1 text-xs ${
                      entry.ok ? "text-emerald-300" : "text-red-300"
                    }`}
                  >
                    {entry.message}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
