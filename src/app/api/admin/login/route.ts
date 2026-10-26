/**
 * POST /api/admin/login — password-only sign-in for the app-manager panel.
 *
 * The admin area is intentionally NOT CORS-enabled (unlike the onboarding
 * routes): admin fetches are same-origin only, so no cross-origin site can
 * even read the responses.
 *
 * Rate limit: every attempt consumes one slot (5 per 15 minutes per IP, via
 * the shared in-memory limiter; nginx already sets X-Forwarded-For/X-Real-IP).
 * Successful sign-ins are rare, so counting attempts is materially the same
 * as counting failures and is strictly safer.
 */
import { NextResponse } from "next/server";
import { logAdminAction } from "@/lib/admin-audit";
import { verifyAdminPassword } from "@/lib/admin-password";
import {
  adminConfigured,
  adminPasswordHashFromEnv,
  adminSessionCookie,
  createAdminSessionToken,
} from "@/lib/admin-session";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request): Promise<NextResponse> {
  if (!adminConfigured()) {
    // Missing ADMIN_PASSWORD_HASH / ADMIN_SESSION_SECRET → the whole admin
    // area is invisible, including login (fail closed).
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const limit = rateLimit(`admin-login:${clientIp(request)}`, LOGIN_ATTEMPT_LIMIT, LOGIN_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let password = "";
  try {
    const body: unknown = await request.json();
    if (
      body &&
      typeof body === "object" &&
      typeof (body as { password?: unknown }).password === "string"
    ) {
      password = (body as { password: string }).password;
    }
  } catch {
    // Fall through with an empty password → generic 401 below.
  }

  if (!password || !verifyAdminPassword(password, adminPasswordHashFromEnv())) {
    // One generic message for wrong password / empty body / malformed JSON —
    // never reveal whether the hash is malformed or the password merely wrong.
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Audit the successful sign-in. Failed attempts are deliberately not
  // recorded (spam-prone; abuse is already capped by the rate limiter above).
  logAdminAction({ action: "admin_login", ip: clientIp(request) });

  const response = NextResponse.json({ ok: true });
  response.headers.append(
    "Set-Cookie",
    adminSessionCookie(
      createAdminSessionToken(),
      process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:"
    )
  );
  return response;
}