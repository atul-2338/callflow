"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Phone, PhoneCall, PhoneOff, Radio, RefreshCw } from "lucide-react";

function loadSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.Plivo) {
      resolve(w.Plivo);
      return;
    }
    const s = document.createElement("script");
    s.src = "/plivo-sdk/plivobrowsersdk.js";
    s.async = true;
    s.onload = () => (w.Plivo ? resolve(w.Plivo) : reject(new Error("window.Plivo not set")));
    s.onerror = () => reject(new Error("Failed to load Plivo SDK script"));
    document.head.appendChild(s);
  });
}

export default function BrowserPhone() {
  const clientRef = useRef<any>(null);
  const disposedRef = useRef(false);
  const [status, setStatus] = useState("Connecting to Plivo…");
  const [statusOk, setStatusOk] = useState<boolean | null>(null);
  const [incoming, setIncoming] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [dialTarget, setDialTarget] = useState("");
  const [dialing, setDialing] = useState(false);

  useEffect(() => {
    disposedRef.current = false;
    let client: any = null;
    (async () => {
      try {
        const res = await fetch("/api/browser-phone", { cache: "no-store" });
        const data = await res.json();
        if (!data.username) throw new Error(data.error || "No credentials returned");
        const Plivo = await loadSdk();
        const plivo = new Plivo({ debug: "WARN", enableTracking: false, allowMultipleIncomingCalls: false });
        client = plivo.client || plivo;
        clientRef.current = client;

        client.on("registered", () => {
          if (disposedRef.current) return;
          setStatus("Online — ready to receive calls");
          setStatusOk(true);
        });
        client.on("unregistered", () => {
          if (disposedRef.current) return;
          setStatus("Offline");
          setStatusOk(false);
        });
        client.on("onLogin", () => {
          if (disposedRef.current) return;
          setStatus("Online — ready to receive calls");
          setStatusOk(true);
        });
        client.on("onLoginFailed", (e: any) => {
          if (disposedRef.current) return;
          setStatus("Login failed: " + (e?.message || JSON.stringify(e) || "unknown"));
          setStatusOk(false);
        });
        client.on("onCallTerminated", () => {
          if (disposedRef.current) return;
          setCallId(null);
          setIncoming(null);
          setActive(false);
        });
        client.on("onCallConnected", () => {
          if (disposedRef.current) return;
          setActive(true);
        });
        client.on("incoming", (uuid: string) => {
          if (disposedRef.current) return;
          setIncoming(uuid);
          setCallId(uuid);
          setActive(false);
        });
        client.on("onIncomingCall", (uuid: string) => {
          if (disposedRef.current) return;
          setIncoming(uuid);
          setCallId(uuid);
          setActive(false);
        });

        client.login(data.username, data.password || "");
      } catch (e) {
        if (disposedRef.current) return;
        setStatus("Failed to init: " + (e instanceof Error ? e.message : String(e)));
        setStatusOk(false);
      }
    })();

    return () => {
      disposedRef.current = true;
      try {
        client?.logout?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  async function answer() {
    try {
      clientRef.current?.answer?.(callId || undefined);
    } catch {
      /* ignore */
    }
    setIncoming(null);
  }

  function reject() {
    try {
      clientRef.current?.reject?.(callId || undefined);
    } catch {
      /* ignore */
    }
    setIncoming(null);
    setCallId(null);
  }

  async function makeCall() {
    const to = dialTarget.trim();
    if (!to || !clientRef.current) return;
    setDialing(true);
    try {
      clientRef.current.call(to, {});
    } catch (e) {
      setStatus("Call failed: " + (e instanceof Error ? e.message : String(e)));
      setStatusOk(false);
    } finally {
      setDialing(false);
    }
  }

  function hangup() {
    try {
      clientRef.current?.hangup?.();
    } catch {
      /* ignore */
    }
    setCallId(null);
    setActive(false);
  }

  const statusColor =
    statusOk === null ? "text-slate-400" : statusOk ? "text-emerald-400" : "text-red-400";

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-white">Browser Phone</h1>
      <p className="mt-1 text-sm text-slate-500">
        A Plivo WebRTC softphone in your browser — rings when the forwarding target is dialed.
      </p>

      <div className="mt-8 rounded-2xl border border-white/10 bg-[#161a24] p-6 shadow-lg shadow-black/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                statusOk === false ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"
              }`}
            >
              {statusOk === null ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : statusOk === false ? (
                <PhoneOff className="h-5 w-5" />
              ) : (
                <Radio className="h-5 w-5" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Technician line</p>
              <p className={`text-xs ${statusColor}`}>{status}</p>
            </div>
          </div>
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-400">
            Plivo WebSDK
          </span>
        </div>

        {incoming && (
          <div className="mt-6 rounded-xl border border-brand-500/30 bg-brand-500/10 p-5 text-center">
            <p className="text-lg font-semibold text-white">Incoming call…</p>
            <p className="mt-1 text-sm text-slate-400">
              A customer call is ringing. Answer it or let it ring out to voicemail.
            </p>
            <div className="mt-4 flex justify-center gap-4">
              <button
                type="button"
                onClick={answer}
                className="flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
              >
                <Phone className="h-5 w-5" />
                Answer
              </button>
              <button
                type="button"
                onClick={reject}
                className="flex items-center gap-2 rounded-full bg-red-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-500/20 hover:bg-red-400"
              >
                <PhoneOff className="h-5 w-5" />
                Reject
              </button>
            </div>
          </div>
        )}

        {callId && !incoming && (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-5 text-center">
            <p className="text-lg font-semibold text-white">
              {active ? "On a call" : "Calling…"}
            </p>
            {active && (
              <button
                type="button"
                onClick={hangup}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-red-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-500/20 hover:bg-red-400"
              >
                <PhoneOff className="h-5 w-5" />
                Hang up
              </button>
            )}
          </div>
        )}

        <div className="mt-6 flex gap-3 border-t border-white/5 pt-5">
          <input
            type="tel"
            value={dialTarget}
            onChange={(e) => setDialTarget(e.target.value)}
            placeholder="Dial a number, e.g. +18885459969"
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
          <button
            type="button"
            onClick={makeCall}
            disabled={!clientRef.current || dialing}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400 disabled:opacity-50"
          >
            {dialing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
            Call
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
        <p className="font-medium text-slate-300">How to test in real time:</p>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-xs">
          <li>Keep this page open and registered (status shows Online).</li>
          <li>Trigger a call — run <code className="text-brand-300">npm run testcall</code> in D:\callflow-new or dial from the PC Dialer.</li>
          <li>This phone rings — <b className="text-slate-200">answer it</b>, or let it ring 20s to see the voicemail fallback.</li>
        </ol>
      </div>
    </div>
  );
}
