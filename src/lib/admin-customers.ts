/**
 * Admin "Create customer" (/admin/customers) — admin-only customer creation.
 *
 * WHY: the self-serve path (POST /api/billing/signup → createBillingSignup →
 * createBusiness) creates a business and then requires a paid Dodo checkout
 * before access. When an admin onboards a pilot customer by hand there is no
 * payment, so this module writes the SAME row, in the SAME table, the same way
 * — with three deliberate differences:
 *   - `onboardingStep` is 'done' (an admin-created customer already has a
 *     number and needs no forwarding wizard; /app redirects to /onboarding
 *     until the step is 'done'),
 *   - `assignedNumber` comes from the typed E.164 number instead of the pool,
 *   - the 3-day trial starts immediately, exactly as
 *     scripts/activate-pilot.cjs does for a self-serve business:
 *     subscriptionStatus 'active', trialStartedAt = now, and a clearly-local
 *     `sub_local_pilot_…` marker in dodoSubscriptionId (never a real Dodo id).
 *
 * The business row and the owner's one-time login token are written in ONE
 * synchronous SQLite transaction. better-sqlite3 transactions must be
 * synchronous, which is why the INSERT mirrors `createBusiness()` in
 * src/lib/db.ts column-for-column instead of calling it — `createBusiness` is
 * async and could not run inside `db.transaction()`.
 *
 * Owner login is a LINK, not a password: CallFlow has no `users` table and no
 * owner password — an owner session is the HMAC-signed
 * `callflow_business_session` cookie (src/lib/business-session.ts) that the
 * signup route mints. The link minted here leads to /owner-login, which mints
 * that exact same cookie, so admin-created owners log in through the identical
 * mechanism as self-serve owners.
 */
import { createHash, randomBytes, randomUUID } from "crypto";

import type { Business } from "./types";
import { BusinessNameTakenError, trialEndsAt } from "./billing";
import { getDb } from "./database";
import { getBusinessByName, getBusinessByPhone } from "./db";
import { claimPoolNumberEntry, findNumberOwner } from "./numbers-pool";
import { generateClientUid, normalizeEnvValue } from "./util";

/** One-time owner login links live 7 days; they work exactly once. */
export const OWNER_LOGIN_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Path of the link's handler — src/app/owner-login/route.ts. */
export const OWNER_LOGIN_PATH = "/owner-login";

export const CUSTOMER_NUMBER_TAKEN_ERROR =
  "That number is already assigned to another business.";
export const CUSTOMER_OWNER_PHONE_TAKEN_ERROR =
  "A business already exists for this owner phone number.";

export class CustomerNumberTakenError extends Error {
  constructor(message: string = CUSTOMER_NUMBER_TAKEN_ERROR) {
    super(message);
    this.name = "CustomerNumberTakenError";
  }
}

export class CustomerOwnerPhoneTakenError extends Error {
  constructor(message: string = CUSTOMER_OWNER_PHONE_TAKEN_ERROR) {
    super(message);
    this.name = "CustomerOwnerPhoneTakenError";
  }
}

export interface CreateCustomerInput {
  /** businesses.billingName — the customer-facing display name. */
  businessName: string;
  /** businesses.ownerName — this form is the only writer of that column. */
  ownerName: string;
  /** Owner email, lowercased — written to billingEmail AND notificationEmail. */
  ownerEmail: string;
  /** Owner phone, already normalized to E.164 by the caller. */
  ownerPhone: string;
  /** E.164 "+1" + 10 digits, already validated by the caller. */
  assignedNumber: string;
}

export interface CreateCustomerResult {
  business: Business;
  /** Raw one-time token for the login link — never stored; only its hash is. */
  loginToken: string;
  loginTokenExpiresAt: string;
  /** End of the 3-day trial (same window as the Dodo trial / activate-pilot). */
  trialEndsAt: string;
}

/** SHA-256 of the raw token — the only form that ever touches the database. */
export function hashOwnerLoginToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateOwnerLoginToken(now: Date): {
  token: string;
  tokenHash: string;
  expiresAt: string;
} {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashOwnerLoginToken(token),
    expiresAt: new Date(now.getTime() + OWNER_LOGIN_TOKEN_TTL_MS).toISOString(),
  };
}

const INSERT_LOGIN_TOKEN_SQL = `INSERT INTO owner_login_tokens
   (id, businessId, tokenHash, createdAt, expiresAt, usedAt)
   VALUES (?, ?, ?, ?, ?, NULL)`;

/** Absolute owner login URL for a minted token. */
export function ownerLoginUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${OWNER_LOGIN_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * Absolute origin for the login link: PUBLIC_BASE_URL when configured (what
 * the VPS deployment sets), otherwise the request's own scheme+host. Behind
 * nginx the x-forwarded-* headers carry the real values, so the link an admin
 * copies is always the https host, never localhost.
 */
export function requestOrigin(request: Request): string {
  const configured = normalizeEnvValue(process.env.PUBLIC_BASE_URL).replace(/\/+$/, "");
  if (configured) return configured;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    new URL(request.url).protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

/**
 * Mint a fresh one-time login link for an EXISTING business (admin "Copy new
 * login link"). Previously issued links stay valid until they expire — each
 * row is independent, so re-minting never invalidates a link already handed to
 * an owner.
 */
export function createOwnerLoginLink(
  businessId: string,
  origin: string
): { url: string; expiresAt: string } {
  const now = new Date();
  const { token, tokenHash, expiresAt } = generateOwnerLoginToken(now);
  getDb()
    .prepare(INSERT_LOGIN_TOKEN_SQL)
    .run(randomUUID(), businessId, tokenHash, now.toISOString(), expiresAt);
  return { url: ownerLoginUrl(origin, token), expiresAt };
}

/**
 * Consume a one-time token: returns the business id when the token is valid,
 * unused and unexpired, otherwise null. Consumption is a single conditional
 * UPDATE, so two requests carrying the same link can never both win — exactly
 * one sees changes === 1 ("single use" is enforced by the query, not by
 * read-then-write code).
 */
export function redeemOwnerLoginToken(token: string): string | null {
  if (!token) return null;
  const hash = hashOwnerLoginToken(token);
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `UPDATE owner_login_tokens
          SET usedAt = @now
        WHERE tokenHash = @hash AND usedAt IS NULL AND expiresAt > @now`
    )
    .run({ hash, now });
  if (info.changes !== 1) return null;

  const row = getDb()
    .prepare("SELECT businessId FROM owner_login_tokens WHERE tokenHash = ?")
    .get(hash) as { businessId: string } | undefined;
  return row?.businessId ?? null;
}

/**
 * The INSERT is the same statement `createBusiness()` in src/lib/db.ts runs —
 * same table, same columns, same defaults — with `onboardingStep` 'done', the
 * assigned number, the local trial marker and `ownerName` filled in. `address`
 * is deliberately absent from the column list: this form never sets one, so the
 * column stays NULL exactly as it does for a fresh self-serve row.
 */
const INSERT_BUSINESS_SQL = `INSERT INTO businesses (
   id, clientUid, phoneNumber, assignedNumber, onboardingStep, carrier,
   forwardingStatus, lastVerifiedAt, pendingVerificationFor,
   pendingVerificationExpiresAt, billingName, billingEmail, billingCountry,
   trialStartedAt, dodoCustomerId, dodoSubscriptionId, dodoCheckoutSessionId,
   subscriptionStatus, subscriptionPaymentId, smsVerificationCode,
   smsVerificationExpiresAt, notificationEmail, ownerName, createdAt, updatedAt
 ) VALUES (
   @id, @clientUid, @phoneNumber, @assignedNumber, @onboardingStep, @carrier,
   @forwardingStatus, @lastVerifiedAt, @pendingVerificationFor,
   @pendingVerificationExpiresAt, @billingName, @billingEmail, @billingCountry,
   @trialStartedAt, @dodoCustomerId, @dodoSubscriptionId, @dodoCheckoutSessionId,
   @subscriptionStatus, @subscriptionPaymentId, @smsVerificationCode,
   @smsVerificationExpiresAt, @notificationEmail, @ownerName, @createdAt, @updatedAt
 )`;

/** Same generation rule (and same retry) as createBusiness in src/lib/db.ts. */
function generateUniqueClientUid(): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateClientUid();
    if (!getDb().prepare("SELECT 1 FROM businesses WHERE clientUid = ?").get(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not generate a unique client UID. Please try again.");
}

/**
 * Create one customer exactly the way onboarding creates a business, plus the
 * assigned number, a trial that starts now (no payment) and a one-time owner
 * login link — all in one DB transaction.
 *
 * Order of operations:
 *   1. friendly pre-checks (name, owner phone, number) so nothing is written
 *      for a request that cannot succeed, and the admin gets a clear message;
 *   2. ONE synchronous SQLite transaction: the business row plus the login
 *      token row. The number is re-checked INSIDE it (one indexed SELECT), so
 *      two concurrent creates can never land on the same number — the whole
 *      transaction rolls back if that check trips;
 *   3. the pool FILE is synced after the commit (file I/O cannot join a SQLite
 *      transaction). This mirrors the onboarding ordering "row first, then
 *      pool": a failure is logged loudly but never fails the creation, because
 *      Dograh routes by businesses.assignedNumber, which is already correct.
 */
export async function createAdminCustomer(
  input: CreateCustomerInput
): Promise<CreateCustomerResult> {
  const nameClash = await getBusinessByName(input.businessName);
  if (nameClash) throw new BusinessNameTakenError();
  const phoneClash = await getBusinessByPhone(input.ownerPhone);
  if (phoneClash) throw new CustomerOwnerPhoneTakenError();
  if (await findNumberOwner(input.assignedNumber)) throw new CustomerNumberTakenError();

  const now = new Date();
  const createdAt = now.toISOString();
  const trialStartedAt = createdAt;
  // Self-describing local marker (mirrors activate-pilot.cjs): it can never be
  // mistaken for a real Dodo id, and the random suffix keeps two creations in
  // the same millisecond from colliding on idx_businesses_dodo_subscription.
  const localSubscriptionId = `sub_local_pilot_${now.getTime()}_${randomBytes(4).toString(
    "hex"
  )}`;
  const { token, tokenHash, expiresAt: loginTokenExpiresAt } = generateOwnerLoginToken(now);

  const business: Business = {
    id: randomUUID(),
    clientUid: generateUniqueClientUid(),
    phoneNumber: input.ownerPhone,
    assignedNumber: input.assignedNumber,
    // Already on a number: the forwarding wizard is not part of this flow.
    onboardingStep: "done",
    carrier: "other",
    forwardingStatus: "not_started",
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
    billingName: input.businessName,
    billingEmail: input.ownerEmail,
    // All pool numbers are US, so the billing country default is US.
    billingCountry: "US",
    trialStartedAt,
    dodoCustomerId: null,
    dodoSubscriptionId: localSubscriptionId,
    dodoCheckoutSessionId: null,
    // 'active' is what activate-pilot writes; with trialStartedAt set, access
    // resolves to "trialing"/entitled for DODO_TRIAL_DAYS and no payment.
    subscriptionStatus: "active",
    subscriptionPaymentId: null,
    smsVerificationCode: null,
    smsVerificationExpiresAt: null,
    // Call alerts go to the owner email the admin just entered.
    notificationEmail: input.ownerEmail,
    ownerName: input.ownerName,
    createdAt,
    updatedAt: createdAt,
  };

  getDb()
    .transaction(() => {
      const clash = getDb()
        .prepare("SELECT id FROM businesses WHERE assignedNumber = ?")
        .get(input.assignedNumber) as { id: string } | undefined;
      if (clash) throw new CustomerNumberTakenError();

      getDb().prepare(INSERT_BUSINESS_SQL).run(business);
      getDb()
        .prepare(INSERT_LOGIN_TOKEN_SQL)
        .run(randomUUID(), business.id, tokenHash, createdAt, loginTokenExpiresAt);
    })
    .immediate();

  try {
    claimPoolNumberEntry(business.id, input.assignedNumber);
  } catch (error) {
    console.error(
      `[admin-customers] business ${business.id} has assignedNumber ${input.assignedNumber}, but the pool file could not be updated — ` +
        "fix data/phone_numbers.json by hand (routing is unaffected, which uses businesses.assignedNumber):",
      error
    );
  }

  return {
    business,
    loginToken: token,
    loginTokenExpiresAt,
    trialEndsAt: trialEndsAt(trialStartedAt),
  };
}


