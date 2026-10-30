import { createHmac, timingSafeEqual } from "crypto";

/**
 * Checkout-bound signup handoff.
 *
 * `POST /api/billing/signup` must not mint a session for an EXISTING business:
 * whoever submits the phone number is not proven to be its owner (that is the
 * takeover bug the old "cookie on every signup" behaviour created). But the
 * pre-created-business flows need the checkout return page to see the trusted
 * billing state — `/setup` creates the row in `/api/onboarding/start` before
 * billing ever runs, and a returning owner re-running the wizard already has
 * a row — so without a bridge `/api/billing/confirm` 401s right after a
 * successful payment.
 *
 * The handoff is that bridge, and nothing more: an HMAC-signed, 30-minute
 * cookie bound to the exact Dodo checkout session the server just created for
 * that business. It only lets `/api/billing/confirm` read the trusted state
 * for that one checkout session, and converts into a full session there only
 * after the signature-verified webhook write path has linked a subscription
 * to the business. Knowing the phone number still yields nothing but an
 * "awaiting_checkout" view; the token is HttpOnly and cannot be forged
 * without BUSINESS_SESSION_SECRET.
 *
 * Keyed with BUSINESS_SESSION_SECRET — the same source as the business
 * session cookie — but domain-separated into its own HMAC key, so the two
 * token families can never be confused for one another and neither
 * validation is weakened.
 */

const COOKIE_NAME = "callflow_signup_handoff";
/** Hosted checkouts are short interactions; 30 minutes is a generous window. */
const MAX_AGE_SECONDS = 60 * 30;
/** Domain separator: makes this HMAC key distinct from the session-cookie key. */
const KEY_DOMAIN = "callflow-signup-handoff:v1";

export interface SignupHandoff {
  businessId: string;
  checkoutSessionId: string;
}

function handoffKey(): Buffer {
  const secret = process.env.BUSINESS_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("BUSINESS_SESSION_SECRET must be configured");
  }
  return createHmac("sha256", secret).update(KEY_DOMAIN).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", handoffKey()).update(payload).digest("base64url");
}

export function signupHandoffCookieName(): string {
  return COOKIE_NAME;
}

export function createSignupHandoffToken(
  businessId: string,
  checkoutSessionId: string,
  now = Date.now()
): string {
  if (!businessId || !checkoutSessionId) {
    throw new Error("Signup handoff requires a business and checkout session id");
  }
  const payload = Buffer.from(
    JSON.stringify({
      b: businessId,
      c: checkoutSessionId,
      e: now + MAX_AGE_SECONDS * 1000,
    })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySignupHandoffToken(
  token: string | undefined,
  now = Date.now()
): SignupHandoff | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts;

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      b?: unknown;
      c?: unknown;
      e?: unknown;
    };
    if (
      typeof parsed.b !== "string" ||
      !parsed.b ||
      typeof parsed.c !== "string" ||
      !parsed.c ||
      typeof parsed.e !== "number" ||
      !Number.isFinite(parsed.e) ||
      parsed.e <= now
    ) {
      return null;
    }
    return { businessId: parsed.b, checkoutSessionId: parsed.c };
  } catch {
    return null;
  }
}

export function signupHandoffCookie(token: string, secure: boolean): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${MAX_AGE_SECONDS}`;
}

/** Expires the handoff once it has been consumed (session minted) or superseded. */
export function clearSignupHandoffCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`;
}

/**
 * Handoff from a raw `Cookie` header, or `null` when the request carries no
 * valid handoff. Mirrors `businessIdFromCookieHeader` so the billing routes
 * stay synchronous and identical in style. The token body is base64url (no
 * `=` padding, no `;`), so the same split-and-join cookie parsing is safe.
 */
export function signupHandoffFromCookieHeader(header: string | null): SignupHandoff | null {
  if (!header) return null;
  const value = header
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === COOKIE_NAME)
    ?.slice(1)
    .join("=");
  return verifySignupHandoffToken(value);
}