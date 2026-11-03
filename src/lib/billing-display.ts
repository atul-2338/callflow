/**
 * Owner-facing billing display helpers — deliberately dependency-free.
 *
 * WHY a separate module: React's purity rule (`react-hooks/purity`) forbids
 * calling `Date.now()` inside a component body, so the trial countdown is
 * computed here instead — one implementation shared by the /app page (server)
 * and, if ever needed, a client component. Nothing here imports the Dodo SDK or
 * the database, so it is safe on both sides of the client/server boundary.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days from now until an ISO timestamp, rounded UP so a trial with 12
 * hours left reads "1 day left" rather than "0". Never negative: a past or
 * unparseable timestamp gives null (there is nothing to count down), and an
 * expired-but-today one gives 0.
 */
export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
}
