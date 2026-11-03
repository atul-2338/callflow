"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { LeadStatus } from "@/lib/types";
import { LEAD_STATUSES } from "@/lib/types";

/** Human labels for the four lead statuses (the values are the stored enum). */
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  account_created: "Account created",
  dead: "Dead",
};

/**
 * Status control on the admin Leads tab. Optimistic: the select moves as soon
 * as it is picked, rolls back if PATCH /api/admin/leads/[id] refuses, and
 * refreshes the server component so the row's timestamp matches the database.
 */
export default function LeadStatusSelect({
  leadId,
  status,
}: {
  leadId: string;
  status: LeadStatus;
}) {
  const router = useRouter();
  const [value, setValue] = useState<LeadStatus>(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(next: LeadStatus) {
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setValue(previous);
        setError(data?.error || "Could not update the lead.");
        return;
      }
      router.refresh();
    } catch {
      setValue(previous);
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <select
        value={value}
        disabled={busy}
        aria-label="Lead status"
        onChange={(event) => update(event.target.value as LeadStatus)}
        className="rounded-lg border border-separator bg-white px-2 py-1.5 text-xs text-ink outline-none transition focus:border-wire disabled:opacity-50"
      >
        {LEAD_STATUSES.map((option) => (
          <option key={option} value={option}>
            {LEAD_STATUS_LABELS[option]}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
