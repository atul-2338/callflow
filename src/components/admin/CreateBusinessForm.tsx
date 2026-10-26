"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { CARRIERS } from "@/lib/types";

/**
 * Admin "Create business" form (Phase 4). POSTs to /api/admin/businesses; the
 * server validates E.164 + duplicate-phone and returns 400/409 with a
 * human-readable message, which is shown inline. On success the new clientUid
 * is surfaced and the server-rendered list refreshes.
 */
export default function CreateBusinessForm() {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [billingName, setBillingName] = useState("");
  const [carrier, setCarrier] = useState<string>("other");
  const [error, setError] = useState<string | null>(null);
  const [createdUid, setCreatedUid] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setCreatedUid(null);
    try {
      const response = await fetch("/api/admin/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber,
          billingName: billingName.trim() || undefined,
          carrier,
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const business =
          data && typeof data === "object"
            ? (data as { business?: { clientUid?: unknown } }).business
            : undefined;
        setCreatedUid(
          business && typeof business.clientUid === "string"
            ? business.clientUid
            : "created"
        );
        setPhoneNumber("");
        setBillingName("");
        setCarrier("other");
        router.refresh();
        return;
      }
      setError(
        data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : "Could not create the business. Try again."
      );
    } catch {
      setError("Could not create the business. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">Create business</h2>
      <p className="mt-1 text-xs text-ink-3">
        The phone number must include the country code (E.164). Each business
        gets a permanent TE- client UID on creation.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label
            htmlFor="admin-business-phone"
            className="mb-1 block text-xs font-medium text-ink-2"
          >
            Phone number (E.164)
          </label>
          <input
            id="admin-business-phone"
            type="tel"
            required
            placeholder="+1 555 123 4567"
            className="ios-field"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
          />
        </div>
        <div className="sm:col-span-1">
          <label
            htmlFor="admin-business-name"
            className="mb-1 block text-xs font-medium text-ink-2"
          >
            Billing name (optional)
          </label>
          <input
            id="admin-business-name"
            type="text"
            maxLength={200}
            placeholder="Acme Plumbing LLC"
            className="ios-field"
            value={billingName}
            onChange={(event) => setBillingName(event.target.value)}
          />
        </div>
        <div className="sm:col-span-1">
          <label
            htmlFor="admin-business-carrier"
            className="mb-1 block text-xs font-medium text-ink-2"
          >
            Carrier
          </label>
          <select
            id="admin-business-carrier"
            className="w-full rounded-lg border border-separator bg-white px-3 py-2 text-sm text-ink focus:border-wire focus:outline-none focus:ring-2 focus:ring-wire/20"
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
          >
            {CARRIERS.map((entry) => (
              <option key={entry} value={entry}>
                {entry.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {createdUid && (
        <p className="mt-3 text-sm text-[#1f8a3b]">
          Business created — client UID {createdUid}.
        </p>
      )}
      <button
        type="submit"
        disabled={submitting || phoneNumber.trim().length === 0}
        className="mt-4 rounded-full bg-[#0b1f3a] px-4 py-2 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create business"}
      </button>
    </form>
  );
}