"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Admin editor for a business's assigned CallFlow number (business detail
 * page). PATCHes /api/admin/businesses/[id]: the server validates E.164,
 * rejects collisions with any other business's assignedNumber/phoneNumber
 * (409) and audit-logs the change. An empty value clears the assignment, so
 * the business falls back to the shared CallFlow number.
 */
export default function EditBusinessForm({
  businessId,
  currentAssignedNumber,
}: {
  businessId: string;
  currentAssignedNumber: string | null;
}) {
  const router = useRouter();
  const [assignedNumber, setAssignedNumber] = useState(
    currentAssignedNumber ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setSaved(null);
    try {
      const response = await fetch(`/api/admin/businesses/${businessId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedNumber }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.ok) {
        setSaved(
          assignedNumber.trim().length === 0
            ? "Assigned number cleared — this business now shares the CallFlow number."
            : "Assigned number saved."
        );
        router.refresh();
        return;
      }
      setError(
        data &&
        typeof data === "object" &&
        typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : "Could not save the assigned number. Try again."
      );
    } catch {
      setError("Could not save the assigned number. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">Assigned CallFlow number</h2>
      <p className="mt-1 text-xs text-ink-3">
        The CallFlow DID that belongs to this business — calls dialled to it are
        attributed here, and the setup wizard shows it instead of the shared
        number. Must include the country code (E.164). Leave empty to use the
        shared CallFlow number.
      </p>
      <div className="mt-4">
        <label
          htmlFor={`admin-business-assigned-${businessId}`}
          className="mb-1 block text-xs font-medium text-ink-2"
        >
          Assigned number (E.164)
        </label>
        <input
          id={`admin-business-assigned-${businessId}`}
          type="tel"
          placeholder="+1 555 123 4567"
          className="ios-field"
          value={assignedNumber}
          onChange={(event) => setAssignedNumber(event.target.value)}
        />
        <p className="mt-1 text-xs text-ink-3">
          Currently: {currentAssignedNumber ?? "shared CallFlow number"}
        </p>
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {saved && <p className="mt-3 text-sm text-[#1f8a3b]">{saved}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="mt-4 rounded-full bg-[#0b1f3a] px-4 py-2 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save assigned number"}
      </button>
    </form>
  );
}