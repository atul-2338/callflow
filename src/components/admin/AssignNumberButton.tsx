"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Assign the next available pool number to a pending business (admin
 * businesses list + detail page). The server answers 503 with a clear error
 * when the pool is empty.
 */
export default function AssignNumberButton({
  businessId,
  label = "Assign number",
}: {
  businessId: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigned, setAssigned] = useState<string | null>(null);

  async function assign() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/businesses/${businessId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = (await response.json().catch(() => null)) as {
        assignedNumber?: string | null;
        error?: string;
      } | null;
      if (!response.ok) {
        setError(data?.error || "Could not assign a number.");
        return;
      }
      if (data?.assignedNumber) {
        setAssigned(data.assignedNumber);
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (assigned) {
    return (
      <span className="font-mono text-xs text-[#1f8a3b]">
        → {assigned}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={assign}
        disabled={busy}
        className="rounded-full bg-[#0b1f3a] px-3 py-1.5 text-xs font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? "Assigning…" : label}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}