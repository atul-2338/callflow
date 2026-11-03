/**
 * The owner password rule — deliberately dependency-free.
 *
 * This module is imported by BOTH the client form (instant feedback) and the
 * server route (the authority). It therefore imports nothing at all: pulling
 * src/lib/business-password.ts into a client component would drag `crypto` and
 * better-sqlite3 into the browser bundle and fail the build. One rule, one
 * implementation, no duplication — see business-password.ts for the hashing
 * and token machinery that re-exports these for server callers.
 */

/** Minimum owner password length, enforced on the client and again server-side. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Null when the pair is acceptable, otherwise the exact sentence the form
 * shows under the fields. `confirm` is optional so callers that only have one
 * field (a future reset flow) can check the length alone.
 */
export function passwordPolicyError(
  password: string,
  confirm?: string
): string | null {
  if (!password) return "Enter a new password.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (confirm !== undefined && password !== confirm) {
    return "Passwords do not match.";
  }
  return null;
}
