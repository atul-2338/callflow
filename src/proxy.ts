import { NextResponse, type NextRequest } from "next/server";

import { businessIdFromCookieHeader } from "@/lib/business-session";

/**
 * Proxy (Next.js 16's renamed Middleware) — an optimistic, cheap sign-in gate
 * for the owner pages this brief adds.
 *
 * Scope is deliberately narrow. Only /dashboard and /account are matched:
 *
 *   - /app, /calls, /settings and /contacts keep their existing gates (the
 *     server component redirect on businesses.onboardingStep, and the
 *     OnboardingGate client island). Sending signed-out visitors to /login
 *     instead of /onboarding would silently break the live onboarding funnel.
 *   - /api/* is NOT matched. A redirect is the wrong answer for a fetched API
 *     route — the existing routes already answer 401 themselves (see
 *     resolveCallAccess in src/lib/call-access.ts and the guards in
 *     /api/me, /api/settings). /api/webhooks/dograh authenticates with
 *     WEBHOOK_SECRET and is untouched.
 *
 * This is the "optimistic check" the Next docs describe, not an authorization
 * boundary: it verifies the HMAC session cookie and redirects when it is
 * missing, while every page and route still enforces its own rule. Per the
 * docs, Proxy defaults to the Node.js runtime in v16, so the existing
 * business-session verifier is reused rather than reimplemented.
 */
const PROTECTED_PREFIXES = ["/dashboard", "/account"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (!isProtected(pathname)) return NextResponse.next();

  if (businessIdFromCookieHeader(request.headers.get("cookie"))) {
    return NextResponse.next();
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*", "/account", "/account/:path*"],
};
