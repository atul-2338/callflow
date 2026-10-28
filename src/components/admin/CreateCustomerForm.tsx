"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";

import { formatAdminDateTime } from "@/lib/admin-format";

interface CreatedCustomer {
  business: {
    id: string;
    clientUid: string;
    businessName: string | null;
    ownerName: string | null;
    ownerPhone: string;
    assignedNumber: string | null;
  };
  trialEndsAt: string;
  loginUrl: string;
  loginTokenExpiresAt: string;
}

const EMPTY_FORM = {
  businessName: "",
  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
  assignedNumber: "",
};

const LABEL_CLASS = "block text-xs font-medium text-ink-3";
const FIELD_CLASS =
  "mt-1 w-full rounded-xl border border-separator bg-white px-3 py-2.5 text-sm text-ink outline-none transition focus:border-wire";

/**
 * Admin "Create customer": business name, owner name/email/phone and the
 * assigned number (plain E.164 text for now — a pool dropdown drops in here
 * later). The server creates the business with a 3-day trial starting
 * immediately, no payment, and returns a one-time owner login link that is
 * shown here to copy: CallFlow owners have no password, so that link IS the
 * login.
 */
export default function CreateCustomerForm() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [created, setCreated] = useState<CreatedCustomer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function field(key: keyof typeof EMPTY_FORM) {
    return (event: ChangeEvent<HTMLInputElement>) =>
      setForm((previous) => ({ ...previous, [key]: event.target.value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch("/api/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => null)) as
        | (CreatedCustomer & { error?: string })
        | null;
      if (!response.ok) {
        setCreated(null);
        setError(data?.error || "Could not create the customer. Try again.");
        return;
      }
      if (data) setCreated(data);
      setForm(EMPTY_FORM);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.loginUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("Copy failed — select the link below and copy it manually.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">Create customer</h2>
      <p className="mt-1 text-xs text-ink-3">
        No payment: the 3-day trial starts the moment you submit, and the owner
        gets access through the one-time login link.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={LABEL_CLASS}>
          Business name
          <input
            className={FIELD_CLASS}
            value={form.businessName}
            onChange={field("businessName")}
            placeholder="Acme Plumbing"
            required
          />
        </label>
        <label className={LABEL_CLASS}>
          Owner name
          <input
            className={FIELD_CLASS}
            value={form.ownerName}
            onChange={field("ownerName")}
            placeholder="Alex Rivera"
            required
          />
        </label>
        <label className={LABEL_CLASS}>
          Owner email
          <input
            type="email"
            className={FIELD_CLASS}
            value={form.ownerEmail}
            onChange={field("ownerEmail")}
            placeholder="alex@acmeplumbing.com"
            required
          />
        </label>
        <label className={LABEL_CLASS}>
          Owner phone
          <input
            type="tel"
            className={FIELD_CLASS}
            value={form.ownerPhone}
            onChange={field("ownerPhone")}
            placeholder="+19283311939"
            required
          />
        </label>
        <label className={LABEL_CLASS}>
          Assigned number
          <input
            className={`${FIELD_CLASS} font-mono`}
            value={form.assignedNumber}
            onChange={field("assignedNumber")}
            placeholder="+17373014448"
            required
          />
          <span className="mt-1 block text-[11px] text-ink-3">
            E.164: +1 followed by 10 digits. Rejected if another business
            already uses it.
          </span>
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-4 rounded-full bg-[#0b1f3a] px-4 py-2 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create customer"}
      </button>

      {created && (
        <div className="mt-5 rounded-xl border border-[#1f8a3b]/30 bg-[#1f8a3b]/[0.06] p-4">
          <p className="text-sm font-semibold text-ink">
            {created.business.businessName ?? "Customer"} created ·{" "}
            <span className="font-mono text-xs">
              {created.business.clientUid}
            </span>
          </p>
          <p className="mt-1 text-xs text-ink-2">
            Number {created.business.assignedNumber ?? "pending"} · trial ends{" "}
            {formatAdminDateTime(created.trialEndsAt)}. Send this one-time login
            link to {created.business.ownerName ?? "the owner"} — it works once
            and expires in 7 days.
          </p>
          <code className="mt-3 block max-w-full break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-ink">
            {created.loginUrl}
          </code>
          <button
            type="button"
            onClick={copyLink}
            className="mt-3 rounded-full border border-separator bg-white px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-wire hover:text-wire"
          >
            {copied ? "Copied" : "Copy login link"}
          </button>
        </div>
      )}
    </form>
  );
}
