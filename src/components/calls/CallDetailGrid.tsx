import type { Call } from "@/lib/types";

/**
 * What the AI assistant captured from the caller, laid out as label/value
 * rows. Anything the call did not capture is shown honestly as "Not
 * captured" — we never invent or imply a detail that was not gathered.
 */
export default function CallDetailGrid({ call }: { call: Call }) {
  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Service requested", value: call.serviceRequested },
    { label: "Urgency", value: call.urgency },
    { label: "Callback preference", value: call.preferredCallbackTime },
  ];
  const didNotConnect = call.callStatus === "failed" || call.callStatus === "missed";

  return (
    <div className="mt-1 space-y-1.5">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-start justify-between gap-3">
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-ink-3">
            {label}
          </span>
          <span className="min-w-0 text-right text-[13px] text-ink">
            {value ?? <span className="text-ink-3">Not captured</span>}
          </span>
        </div>
      ))}
      {didNotConnect && (
        <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] font-medium text-danger">
          {call.callStatus === "failed"
            ? "This call failed before the assistant could answer — nothing was captured and nothing was promised."
            : "This call was missed — the assistant never spoke to the caller."}
        </p>
      )}
    </div>
  );
}