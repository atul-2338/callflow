/**
 * POST /api/auth/setup-password — finish the one-time setup link.
 *
 * Body: `{ token, password, confirm }`. Validation happens twice on purpose:
 * the form checks the pair before submitting (instant feedback) and this route
 * checks it again with the same shared function (src/lib/business-password.ts),
 * because the client is never the authority.
 *
 * Every unusable-link case answers ONE sentence and never says which it was —
 * unknown, already used and expired are indistinguishable, so the endpoint
 * cannot be used to probe which links were ever issued. On success the token is
 * consumed and the password hash written in a single conditional UPDATE, so a
 * double submit (or two tabs) cannot both succeed.
 *
 * The token is never logged, never echoed back, and never stored raw.
 */
import { NextResponse } from "next/server";

import {
  consumeSetupToken,
  hashBusinessPassword,
  inspectSetupToken,
  passwordPolicyError,
} from "@/lib/business-password";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Same sentence the page shows, per the owner-auth brief. */
export const LINK_INVALID_ERROR =
  "This link has expired or is invalid. Please contact support at atul@callflow.biz";

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request): Promise<NextResponse> {
  // Scrypt is the expensive part of this route, so cap submissions per IP.
  const limit = rateLimit(`setup-password:ip:${clientIp(request)}`, 10, 60 * 60 * 1000);
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
    return NextResponse.json({ error: LINK_INVALID_ERROR }, { status: 400 });
  }

  const token = readString(body, "token");
  const password = readString(body, "password");
  const confirm = readString(body, "confirm");

  // The pair first: never spend a scrypt run (or a token read) on input we
  // already know is unacceptable.
  const policyError = passwordPolicyError(password, confirm);
  if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });

  // Cheap read of the link before hashing — hashing is the slow part.
  if (inspectSetupToken(token).state !== "valid") {
    return NextResponse.json({ error: LINK_INVALID_ERROR }, { status: 400 });
  }

  const consumed = consumeSetupToken(token, hashBusinessPassword(password));
  if (!consumed.ok) {
    return NextResponse.json({ error: LINK_INVALID_ERROR }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
