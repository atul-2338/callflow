/**
 * GET /owner-login?token=… — consume a one-time owner login link.
 *
 * Admin-created customers get no password (CallFlow has none): an admin mints a
 * link on /admin/customers and hands it to the owner. This handler verifies the
 * token, marks it used, mints the SAME owner session cookie the signup route
 * mints — it only uses the existing helpers in src/lib/business-session.ts,
 * nothing there changes — and sends the browser to the owner dashboard /app.
 *
 * A Route Handler rather than a page, on purpose: only a handler may set
 * cookies. Every failure (unknown, expired, already used) answers the same
 * honest page and never says which case it was; the token is never echoed into
 * the HTML, and the response is never cached.
 */
import { NextResponse } from "next/server";

import { redeemOwnerLoginToken } from "@/lib/admin-customers";
import {
  businessSessionCookie,
  createBusinessSessionToken,
} from "@/lib/business-session";
import { getBusinessById } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVALID_LINK_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CallFlow — login link</title>
  </head>
  <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f2f2f7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111">
    <main style="max-width:32rem;padding:2rem">
      <h1 style="font-size:1.25rem;margin:0 0 .5rem">This login link has expired</h1>
      <p style="margin:0 0 1rem;line-height:1.5;color:#555">
        CallFlow login links work once and are valid for 7 days. Ask your
        CallFlow contact for a new link.
      </p>
      <a href="/" style="color:#0b1f3a;font-weight:600">Back to CallFlow</a>
    </main>
  </body>
</html>
`;

function invalidLinkResponse(status: number): NextResponse {
  return new NextResponse(INVALID_LINK_HTML, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  // The token is 256 bits of randomness, so guessing is hopeless — this cap
  // only stops a link-scanner from hammering the database.
  const limit = rateLimit(`owner-login:ip:${clientIp(request)}`, 30, 60 * 60 * 1000);
  if (!limit.allowed) return invalidLinkResponse(429);

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const businessId = redeemOwnerLoginToken(token);
  if (!businessId || !(await getBusinessById(businessId))) {
    return invalidLinkResponse(400);
  }

  const secure =
    process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";

  // Relative Location on purpose: behind nginx request.url can still report
  // localhost, and a relative redirect always stays on the host the owner is
  // already talking to.
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: "/app" },
  });
  response.headers.append(
    "Set-Cookie",
    businessSessionCookie(createBusinessSessionToken(businessId), secure)
  );
  return response;
}
