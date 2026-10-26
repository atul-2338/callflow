"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * Per-row "assign to business" control on /admin/calls (unlinked rows only).
 * POSTs to /api/admin/calls/[id]/assign and refreshes the server-rendered
 * table on success; server errors (unknown business, lost session) surface
 * inline.
 */
export default function AssignCallControl({
  callId,
  businesses,
}: {
  callId: string;
  businesses: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [businessId, setBusinessId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (businesses.length === 0) {
    return <span className="text-xs text-ink-3">No businesses yet</span>;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !businessId) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/calls/${callId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      if (response.ok) {
        setBusinessId("");
        router.refresh();
        return;
      }
      const data: unknown = await response.json().catch(() => null);
      setError(
        data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : "Assign failed. Try again."
      );
    } catch {
      setError("Assign failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-1.5">
      <select
        aria-label={`Assign call ${callId} to a business`}
        className="max-w-40 rounded-lg border border-separator bg-white px-2 py-1 text-xs text-ink focus:border-wire focus:outline-none focus:ring-2 focus:ring-wire/20"
        value={businessId}
        onChange={(event) => setBusinessId(event.target.value)}
      >
        <option value="">Pick a business…</option>
        {businesses.map((business) => (
          <option key={business.id} value={business.id}>
            {business.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={submitting || !businessId}
        className="rounded-full bg-[#0b1f3a] px-3 py-1 text-xs font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
      >
        {submitting ? "…" : "Assign"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}