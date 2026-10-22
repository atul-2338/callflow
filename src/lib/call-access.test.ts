import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCallAccess } from "./call-access";
import {
  businessSessionCookieName,
  createBusinessSessionToken,
} from "./business-session";

afterEach(() => {
  vi.unstubAllEnvs();
});

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/calls", { headers });
}

describe("resolveCallAccess", () => {
  it("authorizes and scopes a valid business session cookie", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", "vitest-secret");
    const token = createBusinessSessionToken("biz-123");
    const access = resolveCallAccess(
      requestWith({ cookie: `${businessSessionCookieName()}=${token}` })
    );
    expect(access).toEqual({ businessId: "biz-123", authorized: true });
  });

  it("rejects an invalid session token when APP_AUTH_TOKEN is unset", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", "vitest-secret");
    vi.stubEnv("APP_AUTH_TOKEN", "");
    const access = resolveCallAccess(
      requestWith({ cookie: `${businessSessionCookieName()}=garbage.token.sig` })
    );
    // APP_AUTH_TOKEN unset → nothing to match a bearer against; no open fallback.
    expect(access.authorized).toBe(false);
    expect(access.businessId).toBeNull();
  });

  it("authorizes the shared bearer token, unscoped", () => {
    vi.stubEnv("APP_AUTH_TOKEN", "secret-token");
    const access = resolveCallAccess(
      requestWith({ authorization: "Bearer secret-token" })
    );
    expect(access).toEqual({ businessId: null, authorized: true });
  });

  it("rejects a wrong or missing bearer token when APP_AUTH_TOKEN is set", () => {
    vi.stubEnv("APP_AUTH_TOKEN", "secret-token");
    expect(
      resolveCallAccess(requestWith({ authorization: "Bearer nope" })).authorized
    ).toBe(false);
    expect(resolveCallAccess(requestWith({})).authorized).toBe(false);
  });

  it("rejects requests when APP_AUTH_TOKEN is unset (no open-access fallback)", () => {
    vi.stubEnv("APP_AUTH_TOKEN", "");
    expect(resolveCallAccess(requestWith({}))).toEqual({
      businessId: null,
      authorized: false,
    });
  });

  it("the session cookie wins over an absent/invalid bearer", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", "vitest-secret");
    vi.stubEnv("APP_AUTH_TOKEN", "secret-token");
    const token = createBusinessSessionToken("biz-456");
    const access = resolveCallAccess(
      requestWith({
        cookie: `${businessSessionCookieName()}=${token}`,
        authorization: "Bearer wrong",
      })
    );
    expect(access).toEqual({ businessId: "biz-456", authorized: true });
  });
});