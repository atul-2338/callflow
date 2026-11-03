/**
 * POST /api/auth/login — owner sign-in with email + password.
 *
 * The session it mints is the SAME HMAC `callflow_business_session` cookie the
 * signup route and /owner-login mint (src/lib/business-session.ts, untouched):
 * one session mechanism for the whole owner surface, so every existing route
 * that already trusts that cookie — /api/calls, /api/me, /api/settings — keeps
 * working unchanged. No JWT, no second cookie, nothing new to keep in sync.
 *
 * Failure messages, deliberately:
 *   - unknown email or wrong password → ONE generic sentence (401). The two
 *     cases are indistinguishable, including in timing: an unknown email still
 *     pays for one scrypt verification against a throwaway hash, so the
 *     response time never reveals whether an account exists.
 *   - known email with no password yet → the "check your email" sentence (409).
 *     This is the only case that reports anything specific, because the owner
 *     genuinely cannot proceed without it and the alternative is a support
 *     ticket. It reveals "this address has a CallFlow account awaiting
 *     setup" — accepted, and noted in the task report.
 *
 * Rate limit: 5 attempts per 15 minutes per IP, charged on every attempt
 * (success counting is materially the same as failure counting here and is
 * strictly safer), mirroring /api/admin/login.
 */
import { NextResponse } from "next/server";

import {
  findBusinessCredentialsByEmail,
  verifyAgainstDummyHash,
  verifyBusinessPassword,
} from "@/lib/business-password";
import {
  businessSessionCookie,
  createBusinessSessionToken,
} from "@/lib/business-session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const ATTEMPT_LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Exact copy for both bad cases — never field-specific. */
export const INVALID_CREDENTIALS_ERROR = "Invalid email or password";
export const NOT_SET_UP_ERROR =
  "Your account isn't set up yet. Check your email for the setup link.";

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(`owner-login:ip:${clientIp(request)}`, ATTEMPT_LIMIT, WINDOW_MS);
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
    // Malformed body → empty credentials → the generic 401 below.
  }

  const email = readString(body, "email");
  const password = readString(body, "password");

  const credentials = email ? findBusinessCredentialsByEmail(email) : null;
  if (!credentials) {
    verifyAgainstDummyHash(password);
    return NextResponse.json({ error: INVALID_CREDENTIALS_ERROR }, { status: 401 });
  }

  if (!credentials.passwordHash) {
    // Keep the work (and therefore the timing) identical to the wrong-password
    // path before answering anything at all.
    verifyAgainstDummyHash(password);
    return NextResponse.json({ error: NOT_SET_UP_ERROR }, { status: 409 });
  }

  if (!verifyBusinessPassword(password, credentials.passwordHash)) {
    return NextResponse.json({ error: INVALID_CREDENTIALS_ERROR }, { status: 401 });
  }

  const secure =
    process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";

  const response = NextResponse.json({ ok: true });
  response.headers.append(
    "Set-Cookie",
    businessSessionCookie(createBusinessSessionToken(credentials.businessId), secure)
  );
  return response;
}
