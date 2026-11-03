/**
 * Owner passwords + one-time password-setup links.
 *
 * WHY a link and not a temp password: an admin creates every account, so the
 * owner never types a password the admin chose. The admin's action mints a
 * 48-hour, single-use link (emailed, and also copyable from /admin/customers);
 * the owner opens it, chooses their own password, and from then on signs in at
 * /login.
 *
 * Two rules carried over from the rest of this codebase:
 *
 *   1. Password hashes use the EXACT stored format the admin panel already
 *      uses — `scrypt$N$r$p$<salt-hex>$<hash-hex>` (src/lib/admin-password.ts).
 *      That module owns the only copy of the crypto; this one borrows it, so
 *      there is no second, subtly-different implementation and no new
 *      dependency (bcrypt is not installed here).
 *   2. The raw setup token never touches the database — only its SHA-256 is
 *      stored, exactly like owner_login_tokens.tokenHash (see
 *      src/lib/admin-customers.ts). Consumption is one conditional UPDATE, so
 *      two requests carrying the same link can never both win.
 *
 * Secrets hygiene: no function here logs, returns or embeds a password, a raw
 * token or a stored hash beyond the value the caller already has.
 */
import { createHash, randomBytes } from "crypto";

import { hashAdminPassword, verifyAdminPassword } from "./admin-password";
import { getDb } from "./database";

// The password rule itself lives in ./password-policy so the client form can
// enforce the identical rule without importing this module's server-only
// dependencies (crypto + better-sqlite3). Re-exported here for server callers.
export { MIN_PASSWORD_LENGTH, passwordPolicyError } from "./password-policy";

/** Setup links are valid for 48 hours, per the owner-auth brief. */
export const SETUP_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;
/** Path of the page that consumes the link — src/app/setup-password/page.tsx. */
export const SETUP_PASSWORD_PATH = "/setup-password";

/** Same stored format as ADMIN_PASSWORD_HASH — one implementation, borrowed. */
export function hashBusinessPassword(password: string): string {
  return hashAdminPassword(password);
}

/** Constant-time, fail-closed verification (delegated — see the module note). */
export function verifyBusinessPassword(password: string, stored: string): boolean {
  return verifyAdminPassword(password, stored);
}

/**
 * A hash of a throwaway string, verified against when the email is unknown.
 * Without it, "no such account" would return before any scrypt work and be
 * measurably faster than "wrong password" — a timing oracle for which emails
 * have accounts. Computed once, lazily: scrypt is deliberately slow, so doing
 * it at module load would tax every cold start.
 */
/**
 * A hash of a throwaway string, verified against when the email is unknown.
 * Without it, "no such account" would return before any scrypt work and be
 * measurably faster than "wrong password" — a timing oracle for which emails
 * have accounts. Computed once, lazily: scrypt is deliberately slow, so doing
 * it at module load would tax every cold start.
 */
let dummyHash: string | null = null;
export function verifyAgainstDummyHash(password: string): false {
  if (!dummyHash) dummyHash = hashAdminPassword(randomBytes(16).toString("hex"));
  verifyBusinessPassword(password, dummyHash);
  return false;
}

export interface BusinessCredentials {
  businessId: string;
  /** NULL when the owner has never completed /setup-password. */
  passwordHash: string | null;
}

/**
 * Sign-in lookup by owner email (businesses.billingEmail — the column the
 * signup wizard and the admin "Create customer" form both fill).
 *
 * Case- and whitespace-insensitive, like getBusinessByName. `billingEmail` is
 * NOT unique (one owner can hold two businesses), so when several rows share an
 * address the one that already has a password wins, then the most recently
 * updated one — a hashless row can never shadow a working login.
 */
export function findBusinessCredentialsByEmail(
  email: string
): BusinessCredentials | null {
  const trimmed = email.trim();
  if (!trimmed) return null;
  const row = getDb()
    .prepare(
      `SELECT id, passwordHash FROM businesses
        WHERE LOWER(TRIM(billingEmail)) = LOWER(TRIM(?))
        ORDER BY (passwordHash IS NULL) ASC, updatedAt DESC
        LIMIT 1`
    )
    .get(trimmed) as { id: string; passwordHash: string | null } | undefined;
  return row ? { businessId: row.id, passwordHash: row.passwordHash } : null;
}

/**
 * The stored scrypt hash for a business, or null when the owner has never
 * completed /setup-password. Read straight from the column because
 * `businesses.passwordHash` is deliberately NOT part of the Business type
 * (src/lib/types.ts) — a hash must never ride along on a business object a
 * page or API response serializes.
 */
export function getBusinessPasswordHash(businessId: string): string | null {
  const row = getDb()
    .prepare("SELECT passwordHash FROM businesses WHERE id = ?")
    .get(businessId) as { passwordHash: string | null } | undefined;
  return row?.passwordHash ?? null;
}

/**
 * Store a new owner password hash (change-password). Returns false when the
 * business no longer exists — the caller turns that into a 404 rather than
 * silently reporting success. Only this column and updatedAt are touched.
 */
export function storeBusinessPassword(businessId: string, passwordHash: string): boolean {
  const info = getDb()
    .prepare(
      `UPDATE businesses
          SET passwordHash = @passwordHash, updatedAt = @now
        WHERE id = @id`
    )
    .run({ id: businessId, passwordHash, now: new Date().toISOString() });
  return info.changes === 1;
}

/** SHA-256 of the raw token — the only form that ever reaches the database. */
export function hashSetupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface MintedSetupToken {
  /** Raw token for the link. Never stored, never logged. */
  token: string;
  tokenHash: string;
  expiresAt: string;
}

/** 256 bits of randomness, 48 hours of life. */
export function generateSetupToken(now = new Date()): MintedSetupToken {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashSetupToken(token),
    expiresAt: new Date(now.getTime() + SETUP_TOKEN_TTL_MS).toISOString(),
  };
}

/** Absolute setup URL for a minted token (origin from requestOrigin()). */
export function setupPasswordUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${SETUP_PASSWORD_PATH}?token=${encodeURIComponent(token)}`;
}

export type SetupTokenState =
  | { state: "valid"; businessId: string; expiresAt: string }
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "used" };

interface SetupTokenRow {
  id: string;
  setupTokenExpiry: string | null;
  setupTokenUsedAt: string | null;
}

/**
 * Read-only inspection for the page: is this link still open? The write path
 * re-checks atomically in consumeSetupToken, so a link that goes stale between
 * page render and submit is still refused.
 */
export function inspectSetupToken(token: string, now = new Date()): SetupTokenState {
  if (!token) return { state: "invalid" };
  const row = getDb()
    .prepare(
      `SELECT id, setupTokenExpiry, setupTokenUsedAt FROM businesses
        WHERE setupTokenHash = ?`
    )
    .get(hashSetupToken(token)) as SetupTokenRow | undefined;
  if (!row) return { state: "invalid" };
  if (row.setupTokenUsedAt) return { state: "used" };
  if (!row.setupTokenExpiry || row.setupTokenExpiry <= now.toISOString()) {
    return { state: "expired" };
  }
  return { state: "valid", businessId: row.id, expiresAt: row.setupTokenExpiry };
}

export type ConsumeSetupTokenResult =
  | { ok: true; businessId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/**
 * Consume the link and store the password in one atomic step.
 *
 * `changes === 1` is the only success signal: the WHERE clause repeats every
 * validity condition, so two submissions racing on one link cannot both write.
 * The business id read first is used only for the success response — it can
 * never be handed out when the UPDATE wrote nothing.
 */
export function consumeSetupToken(
  token: string,
  passwordHash: string,
  now = new Date()
): ConsumeSetupTokenResult {
  if (!token || !passwordHash) return { ok: false, reason: "invalid" };
  const inspected = inspectSetupToken(token, now);
  if (inspected.state !== "valid") return { ok: false, reason: inspected.state };

  const nowIso = now.toISOString();
  const info = getDb()
    .prepare(
      `UPDATE businesses
          SET passwordHash = @passwordHash,
              setupTokenHash = NULL,
              setupTokenExpiry = NULL,
              setupTokenUsedAt = @now,
              updatedAt = @now
        WHERE setupTokenHash = @tokenHash
          AND setupTokenUsedAt IS NULL
          AND setupTokenExpiry IS NOT NULL
          AND setupTokenExpiry > @now`
    )
    .run({ passwordHash, tokenHash: hashSetupToken(token), now: nowIso });

  if (info.changes !== 1) return { ok: false, reason: "used" };
  return { ok: true, businessId: inspected.businessId };
}
