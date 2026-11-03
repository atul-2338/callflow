"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";

import Link from "next/link";

/**
 * Public lead-intake form on /start (the page a prospect is sent to after a
 * demo call). Deliberately dumb: it posts exactly what was typed and shows the
 * server's message when something is wrong — the route is the authority
 * (nobody can submit a lead without a name, a real phone number and an email).
 */
const EMPTY_FORM = { name: "", phone: "", email: "" };

export default function StartForm() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function field(key: keyof typeof EMPTY_FORM) {
    return (event: ChangeEvent<HTMLInputElement>) =>
      setForm((previous) => ({ ...previous, [key]: event.target.value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (response.ok) {
        setSubmittedName(form.name.trim().split(/\s+/)[0] || "there");
        setForm(EMPTY_FORM);
        return;
      }
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not submit your details. Please try again.");
    } catch {
      setError("Could not reach CallFlow. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (submittedName) {
    return (
      <div className="mt-6 rounded-2xl border border-[#1f8a3b]/30 bg-[#1f8a3b]/10 p-5">
        <p className="text-base font-semibold text-ink">Thanks, {submittedName}!</p>
        <p className="mt-1.5 text-sm text-ink-2">
          We have your details and will call you back about getting CallFlow set
          up — usually the same day.
        </p>
        <p className="mt-3 text-xs text-ink-3">
          Already a customer?{" "}
          <Link href="/login" className="font-medium text-wire underline">
            Log in
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
      <div>
        <label htmlFor="lead-name" className="block text-sm font-medium text-ink">
          Your name
        </label>
        <input
          id="lead-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          value={form.name}
          onChange={field("name")}
          className="mt-1.5 w-full rounded-[10px] border border-separator bg-white px-3 py-2.5 text-ink outline-none focus:border-wire"
        />
      </div>

      <div>
        <label htmlFor="lead-phone" className="block text-sm font-medium text-ink">
          Phone
        </label>
        <input
          id="lead-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          required
          placeholder="+1 928 331 9394"
          value={form.phone}
          onChange={field("phone")}
          className="mt-1.5 w-full rounded-[10px] border border-separator bg-white px-3 py-2.5 text-ink outline-none focus:border-wire"
        />
      </div>

      <div>
        <label htmlFor="lead-email" className="block text-sm font-medium text-ink">
          Email
        </label>
        <input
          id="lead-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={field("email")}
          className="mt-1.5 w-full rounded-[10px] border border-separator bg-white px-3 py-2.5 text-ink outline-none focus:border-wire"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-[#c0392b]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-[10px] bg-gold px-4 py-2.5 text-sm font-semibold text-[#0b1f3a] shadow-[var(--shadow-pill)] disabled:opacity-60"
      >
        {busy ? "Sending…" : "Get set up"}
      </button>

      <p className="text-center text-xs text-ink-3">
        No card needed now — we&apos;ll call you first.
      </p>
    </form>
  );
}
