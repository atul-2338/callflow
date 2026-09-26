import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const COOKIE_NAME = "callflow_business_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function sessionSecret(): string {
  const secret = process.env.BUSINESS_SESSION_SECRET?.trim();
  if (!secret) throw new Error("BUSINESS_SESSION_SECRET must be configured");
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

export function businessSessionCookieName(): string {
  return COOKIE_NAME;
}

export function createBusinessSessionToken(businessId: string): string {
  const nonce = randomBytes(16).toString("base64url");
  const value = `${businessId}.${nonce}`;
  return `${value}.${sign(value)}`;
}

export function verifyBusinessSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;

  const value = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(value));
  const received = Buffer.from(parts[2]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  return parts[0];
}

export function businessSessionCookie(token: string, secure: boolean): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${
    secure ? "; Secure" : ""
  }`;
}

/**
 * Business id from a raw `Cookie` header, or `null` when the request carries no
 * valid session. Route handlers use this instead of `cookies()` so the check
 * stays synchronous and identical across `/api/me` and the billing routes.
 */
export function businessIdFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  const value = header
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === COOKIE_NAME)
    ?.slice(1)
    .join("=");
  return verifyBusinessSessionToken(value);
}