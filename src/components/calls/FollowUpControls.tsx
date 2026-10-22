"use client";

import { useState } from "react";
import { Flag, Save, CheckCircle2, RotateCcw } from "lucide-react";
import type { Call, FollowUpStatus } from "@/lib/types";
import { updateCallFollowUp } from "@/lib/api";

const STATUS_COPY: Record<Exclude<FollowUpStatus, "none">, string> = {
  needed: "Flagged for follow-up",
  resolved: "Called back",
};

/**
 * Owner follow-up controls for one call: flag it, resolve it, and keep
 * free-form notes. Failures are surfaced inline — the optimistic state is
 * never "saved" until the API says so.
 */
export default function FollowUpControls({
  call,
  onUpdated,
}: {
  call: Call;
  onUpdated: (call: Call) => void;
}) {
  const [notes, setNotes] = useState(call.followUpNotes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(update: {
    followUpStatus?: FollowUpStatus;
    followUpNotes?: string;
  }) {
    setBusy(true);
    setError(null);
    try {
      const updated = await updateCallFollowUp(call.id, update);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const notesDirty = notes !== (call.followUpNotes || "");

  return (
    <div className="mt-3 border-t border-separator pt-3">
      {call.followUpStatus !== "none" && (
        <p className="text-[12px] text-ink-3">
          {STATUS_COPY[call.followUpStatus]}
          {call.followUpUpdatedAt
            ? ` · updated ${new Date(call.followUpUpdatedAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}`
            : ""}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {call.followUpStatus !== "needed" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => apply({ followUpStatus: "needed" })}
            className="inline-flex items-center gap-1.5 rounded-full bg-callback/15 px-3.5 py-2 text-[13px] font-semibold text-[#b25e00] transition active:scale-[0.98] disabled:opacity-50"
          >
            <Flag className="h-3.5 w-3.5" /> Flag for follow-up
          </button>
        )}
        {call.followUpStatus !== "resolved" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => apply({ followUpStatus: "resolved" })}
            className="inline-flex items-center gap-1.5 rounded-full bg-booked/12 px-3.5 py-2 text-[13px] font-semibold text-[#1f8a3b] transition active:scale-[0.98] disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark called back
          </button>
        )}
        {call.followUpStatus !== "none" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => apply({ followUpStatus: "none" })}
            className="inline-flex items-center gap-1.5 rounded-full bg-ink/6 px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition active:scale-[0.98] disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
      <textarea
        value={notes}
        maxLength={2000}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes for this call (e.g. quoted price, promised callback time)…"
        className="ios-field mt-2 min-h-[72px] resize-y text-[14px]"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !notesDirty}
          onClick={() => apply({ followUpNotes: notes })}
          className="ios-pill-primary px-4 py-2 text-[13px]"
        >
          <Save className="h-3.5 w-3.5" /> Save notes
        </button>
        {error && <span className="text-[12px] text-danger">{error}</span>}
      </div>
    </div>
  );
}