import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  businessSessionCookieName,
  createBusinessSessionToken,
} from "@/lib/business-session";
import { proxy } from "./proxy";

const TEST_SECRET = "proxy-test-secret";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${path}`), {
    headers: cookie ? { cookie } : {},
  });
}

/** Proxy passed the request through untouched. */
function passedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

/**
 * The gate exists to keep signed-out visitors out of /dashboard and /account —
 * and, just as importantly, to leave every other existing route exactly as it
 * was. Both halves are asserted here: /app, /calls and the whole onboarding
 * funnel must NOT start redirecting to /login, and /api/* must never be turned
 * into a redirect (the routes answer 401 themselves).
 */
describe("proxy (auth gate)", () => {
  beforeEach(() => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects a signed-out visitor from /dashboard to /login", () => {
    const response = proxy(request("/dashboard"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("redirects signed-out visitors from /account and its children", () => {
    for (const path of ["/account", "/account/security"]) {
      const response = proxy(request(path));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    }
  });

  it("drops any query string when redirecting", () => {
    const response = proxy(request("/dashboard?next=%2Fsettings"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("lets a valid owner session through to /dashboard", () => {
    const cookie = `${businessSessionCookieName()}=${createBusinessSessionToken("biz-1")}`;
    const response = proxy(request("/dashboard", cookie));
    expect(response.status).toBe(200);
    expect(passedThrough(response)).toBe(true);
  });

  it("ignores a tampered session cookie", () => {
    const token = createBusinessSessionToken("biz-1");
    const tampered = `${businessSessionCookieName()}=${token.slice(0, -2)}xx`;
    const response = proxy(request("/dashboard", tampered));
    expect(response.status).toBe(307);
  });

  it("leaves every existing route alone, session or not", () => {
    // The live onboarding funnel, the legacy dashboard and the marketing pages
    // must keep behaving exactly as before this gate existed.
    for (const path of ["/", "/app", "/calls", "/settings", "/onboarding", "/login", "/setup-password", "/owner-login", "/pricing"]) {
      const response = proxy(request(path));
      expect(response.status).toBe(200);
      expect(passedThrough(response)).toBe(true);
    }
  });

  it("never rewrites API responses into redirects", () => {
    // /api/webhooks/dograh authenticates with WEBHOOK_SECRET, and the rest
    // answer 401 themselves — a 307 to /login would be wrong for all of them.
    for (const path of ["/api/calls", "/api/me", "/api/webhooks/dograh"]) {
      const response = proxy(request(path));
      expect(passedThrough(response)).toBe(true);
    }
  });
});
