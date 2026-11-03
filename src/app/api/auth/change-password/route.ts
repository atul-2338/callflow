/**
 * POST /api/auth/change-password — change (or first-set) the owner password
 * from /account while signed in.
 *
 * Same pattern as POST /api/auth/login: the business comes from the EXISTING
 * `callflow_business_session` cookie (src/lib/business-session.ts, untouched),
 * the stored hash is scrypt in the one shared format
 * (`scrypt$N$r$p$salt$hash`, via src/lib/business-password.ts), and the request
 * is rate-limited per IP because scrypt is the expensive part.
 *
 * Two owner states, deliberately handled in one endpoint:
 *   - a password already exists → the current password is required and
 *     verified first (401 when wrong, so nothing is overwritten by a stolen
 *     session alone);
 *   - no password yet (the owner has only ever used a login link) → the new
 *     password is simply set, with nothing to verify against.
 *
 * The session itself is never rebound or re-minted: it is an HMAC session
 * token, not a password-derived credential, so changing the password does not
 * sign the owner out (or anyone else) — that is the existing session model.
 *
 * Secrets hygiene: no password, hash or cookie value is logged or echoed.
 */
import { NextResponse } from "next/server";

import {
  businessIdFromCookieHeader,
} from "@/lib/business-session";
import {
  getBusinessPasswordHash,
  hashBusinessPassword,
  passwordPolicyError,
  storeBusinessPassword,
  verifyBusinessPassword,
} from "@/lib/business-password";
import { getBusinessById } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const ATTEMPT_LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;

export const NO_SESSION_ERROR = "Sign in again to change your password.";
export const WRONG_CURRENT_PASSWORD_ERROR = "Current password is incorrect.";
export const MISSING_CURRENT_PASSWORD_ERROR = "Enter your current password.";

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request): Promise<NextResponse> {
  const businessId = businessIdFromCookieHeader(request.headers.get("cookie"));
  if (!businessId) {
    return NextResponse.json({ error: NO_SESSION_ERROR }, { status: 401 });
  }

  const limit = rateLimit(
    `owner-change-password:ip:${clientIp(request)}`,
    ATTEMPT_LIMIT,
    WINDOW_MS
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const currentPassword = readString(body, "currentPassword");
  const newPassword = readString(body, "newPassword");
  const confirm = readString(body, "confirm");

  // The pair first: never spend a scrypt run on input already known bad. The
  // identical rule is enforced in the form for instant feedback (one shared
  // implementation, src/lib/password-policy.ts).
  const policyError = passwordPolicyError(newPassword, confirm);
  if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });

  const business = await getBusinessById(businessId);
  if (!business) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const stored = getBusinessPasswordHash(businessId);
  if (stored) {
    if (!currentPassword) {
      return NextResponse.json({ error: MISSING_CURRENT_PASSWORD_ERROR }, { status: 400 });
    }
    if (!verifyBusinessPassword(currentPassword, stored)) {
      return NextResponse.json({ error: WRONG_CURRENT_PASSWORD_ERROR }, { status: 401 });
    }
  }

  if (!storeBusinessPassword(businessId, hashBusinessPassword(newPassword))) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
