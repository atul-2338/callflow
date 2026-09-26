"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

/**
 * Landing-page waitlist capture (Phase 6 tester acquisition). Posts to
 * /api/waitlist, which is idempotent per email.
 */
export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setState("error");
      setMessage("Enter a valid email address.");
      return;
    }
    setState("sending");
    setMessage("");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source: "landing" }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to join the waitlist.");
      setState("done");
      setMessage("You're on the list — we'll email you when tester slots open.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Unable to join the waitlist.");
    }
  }

  if (state === "done") {
    return (
      <div className="mx-auto flex max-w-md items-center justify-center gap-2.5 rounded-2xl border border-booked/30 bg-booked/10 px-5 py-4 text-sm font-medium text-booked">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        {message}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto mt-6 flex w-full max-w-md flex-col gap-3 sm:flex-row"
    >
      <div className="relative flex-1">
        <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@yourbusiness.com"
          autoComplete="email"
          className="w-full rounded-full border border-white/15 bg-white/10 py-3 pl-10 pr-4 text-sm text-white placeholder-white/40 outline-none transition focus:border-gold/60 focus:bg-white/15"
        />
      </div>
      <button
        type="submit"
        disabled={state === "sending"}
        className="ios-pill-primary shrink-0 px-6 py-3 text-sm disabled:opacity-60"
      >
        {state === "sending" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "Join the waitlist"
        )}
      </button>
      {state === "error" && (
        <p className="text-center text-xs text-danger sm:col-span-2">{message}</p>
      )}
    </form>
  );
}
