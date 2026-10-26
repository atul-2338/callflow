/**
 * Shared status pill for admin tables. Server component (no "use client") so
 * server pages can render it directly; client components may import it too.
 * Styles reuse the owner dashboard's semantic colors (CallLogs.tsx).
 */
const CALL_STATUS_STYLES: Record<string, string> = {
  answered: "bg-booked/10 text-[#1f8a3b]",
  missed: "bg-danger/10 text-danger",
  busy: "bg-callback/12 text-[#b25e00]",
  failed: "bg-danger/10 text-danger",
  voicemail_left: "bg-gold/15 text-gold-strong",
};

const OUTCOME_STYLES: Record<string, string> = {
  booked: "bg-booked/10 text-[#1f8a3b]",
  callback: "bg-callback/12 text-[#b25e00]",
  voicemail: "bg-gold/15 text-gold-strong",
  handled: "bg-ink/6 text-ink-3",
  other: "bg-ink/6 text-ink-3",
};

const FORWARDING_STYLES: Record<string, string> = {
  not_started: "bg-ink/6 text-ink-3",
  pending: "bg-callback/12 text-[#b25e00]",
  active: "bg-booked/12 text-[#1f8a3b]",
  failed: "bg-danger/10 text-danger",
};

const SUBSCRIPTION_STYLES: Record<string, string> = {
  not_started: "bg-ink/6 text-ink-3",
  trialing: "bg-callback/12 text-[#b25e00]",
  active: "bg-booked/12 text-[#1f8a3b]",
  canceled: "bg-danger/10 text-danger",
  failed: "bg-danger/10 text-danger",
};

const PILL_MAPS = {
  call: CALL_STATUS_STYLES,
  outcome: OUTCOME_STYLES,
  forwarding: FORWARDING_STYLES,
  subscription: SUBSCRIPTION_STYLES,
} as const;

export type StatusPillKind = keyof typeof PILL_MAPS;

export default function StatusPill({
  kind,
  value,
}: {
  kind: StatusPillKind;
  value: string | null | undefined;
}) {
  if (!value) {
    return <span className="text-xs text-ink-3">—</span>;
  }
  const cls = PILL_MAPS[kind][value] ?? "bg-ink/6 text-ink-3";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}