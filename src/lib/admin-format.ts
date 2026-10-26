/**
 * Admin-panel formatting helpers. Pure functions so both server pages and
 * client components can use them without a client/server boundary concern.
 */

/** ISO timestamp → "Oct 23, 2026, 2:31 PM"; null/absent/invalid → honest fallback. */
export function formatAdminDateTime(
  value: string | null | undefined
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Byte count → human size; unknown → "—". */
export function formatAdminBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}