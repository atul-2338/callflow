/**
 * POST /api/admin/logout — clears the admin session cookie. Guarded like every
 * /api/admin/* route; the client component navigates to /admin/login
 * afterwards either way, so a stale session signing out just sees a 401 and
 * lands on the login page.
 */
import { NextResponse } from "next/server";
import { logAdminAction } from "@/lib/admin-audit";
import { clearedAdminSessionCookie, requireAdminApi } from "@/lib/admin-session";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const guard = requireAdminApi(request);
  if (guard) return guard;

  // Audit the sign-out (security event; same success-only policy as login).
  logAdminAction({ action: "admin_logout", ip: clientIp(request) });

  const response = NextResponse.json({ ok: true });
  response.headers.append(
    "Set-Cookie",
    clearedAdminSessionCookie(
      process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:"
    )
  );
  return response;
}