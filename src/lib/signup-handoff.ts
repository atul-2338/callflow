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

/**
 * Checkout-return token (see `createCheckoutReturnToken` at the bottom): the
 * same signed-identity idea as the handoff cookie, but carried on the URL Dodo
 * redirects to instead of in a cookie.
 */
const RETURN_PARAM = "trial_id";
/** A hosted-checkout link lives 24 hours, so the token that travels with it does too. */
const RETURN_MAX_AGE_SECONDS = 60 * 60 * 24;
const RETURN_KEY_DOMAIN = "callflow-checkout-return:v1";

export interface SignupHandoff {
  businessId: string;
  checkoutSessionId: string;
}

function tokenKey(domain: string): Buffer {
  const secret = process.env.BUSINESS_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("BUSINESS_SESSION_SECRET must be configured");
  }
  return createHmac("sha256", secret).update(domain).digest();
}

function sign(domain: string, payload: string): string {
  return createHmac("sha256", tokenKey(domain)).update(payload).digest("base64url");
}

function signatureMatches(domain: string, payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(domain, payload));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Shared reader for both token families below: `<base64url json>.<hmac>`.
 * Returns `null` for anything that is not signed by us — malformed, tampered,
 * or minted with a different secret. Throws only when the secret is missing
 * (fail closed), exactly like the minting side.
 */
function readToken(domain: string, token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts;
  if (!signatureMatches(domain, payload, signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
  return `${payload}.${sign(KEY_DOMAIN, payload)}`;
}

export function verifySignupHandoffToken(
  token: string | undefined,
  now = Date.now()
): SignupHandoff | null {
  const parsed = readToken(KEY_DOMAIN, token);
  if (!parsed) return null;

  const { b, c, e } = parsed;
  if (
    typeof b !== "string" ||
    !b ||
    typeof c !== "string" ||
    !c ||
    typeof e !== "number" ||
    !Number.isFinite(e) ||
    e <= now
  ) {
    return null;
  }
  return { businessId: b, checkoutSessionId: c };
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

/**
 * Checkout-return token: a signed account id that rides on the URL Dodo sends
 * the browser back to (`/checkout/return?status=success&session_id=…&trial_id=…`).
 *
 * WHY a second transport: the handoff cookie is `SameSite=None; Secure`, which
 * browsers still drop for plenty of cross-site arrivals (Safari's ITP ignores
 * it outright) and which never existed at all when the payer finishes on
 * another device or in a different browser. The return URL is the one thing
 * both sides are guaranteed to share, so the identity travels there as well.
 *
 * It names the business only. `return_url` is fixed *before* Dodo issues
 * `session_id`, so the token cannot be bound to the exact checkout at mint
 * time; `/api/billing/confirm` binds it to whatever checkout the row currently
 * holds instead, and rejects it when the redirect's `session_id` disagrees.
 *
 * It is not a bearer grant. Like the handoff cookie it unlocks the trusted
 * billing state for one business and becomes a real session only after the
 * signature-verified webhook has linked a subscription to it.
 */
export function checkoutReturnParamName(): string {
  return RETURN_PARAM;
}

export function createCheckoutReturnToken(businessId: string, now = Date.now()): string {
  if (!businessId) {
    throw new Error("Checkout return token requires a business id");
  }
  const payload = Buffer.from(
    JSON.stringify({ b: businessId, e: now + RETURN_MAX_AGE_SECONDS * 1000 })
  ).toString("base64url");
  return `${payload}.${sign(RETURN_KEY_DOMAIN, payload)}`;
}

/** The business id the token was minted for, or `null` if it is not ours. */
export function verifyCheckoutReturnToken(
  token: string | null | undefined,
  now = Date.now()
): string | null {
  const parsed = readToken(RETURN_KEY_DOMAIN, token ?? undefined);
  if (!parsed) return null;

  const { b, e } = parsed;
  if (
    typeof b !== "string" ||
    !b ||
    typeof e !== "number" ||
    !Number.isFinite(e) ||
    e <= now
  ) {
    return null;
  }
  return b;
}

/** `returnUrl` with the signed account id appended as `?trial_id=…`. */
export function withCheckoutReturnParam(
  returnUrl: string,
  businessId: string,
  now = Date.now()
): string {
  const url = new URL(returnUrl);
  url.searchParams.set(RETURN_PARAM, createCheckoutReturnToken(businessId, now));
  return url.toString();
}