/**
 * POST /api/auth/logout — clear the owner session cookie and go to /login.
 *
 * The owner session is a stateless HMAC cookie (src/lib/business-session.ts):
 * there is no server-side session store, so signing out means clearing the
 * cookie in the browser. The clearing header is composed here from the
 * module's own exported cookie name rather than adding a helper to that file —
 * business-session.ts sits on this repo's protected surface, and this task has
 * no reason to touch it. (Attribute-wise only `Path` and the name matter for a
 * deletion; HttpOnly/SameSite/Secure are repeated for consistency with
 * clearedAdminSessionCookie in src/lib/admin-session.ts.)
 *
 * POST only, deliberately: a GET that clears a cookie can be triggered by any
 * cross-site link (top-level navigations still send SameSite=Lax cookies), so
 * signing out stays a deliberate, same-origin action. The dashboard button
 * posts here and then navigates to /login itself, exactly like
 * AdminLogoutButton.
 */
import { NextResponse } from "next/server";

import { businessSessionCookieName } from "@/lib/business-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clearing variant of the owner session cookie. */
export function clearedBusinessSessionCookie(secure: boolean): string {
  return `${businessSessionCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
    secure ? "; Secure" : ""
  }`;
}

export async function POST(request: Request): Promise<NextResponse> {
  const secure =
    process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.headers.append("Set-Cookie", clearedBusinessSessionCookie(secure));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
