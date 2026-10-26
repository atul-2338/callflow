import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  adminConfigured,
  adminSessionCookie,
  clearedAdminSessionCookie,
  createAdminSessionToken,
  hasAdminSessionCookie,
  requireAdminApi,
  verifyAdminSessionToken,
} from "./admin-session";

const TEST_SECRET = "unit-test-secret";
const TEST_HASH = "scrypt$16384$8$1$00$00"; // non-empty is all adminConfigured checks

function validToken(options: { now?: number; ttlSeconds?: number } = {}): string {
  return createAdminSessionToken({ secret: TEST_SECRET, ...options });
}

describe("admin session tokens", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a freshly created token", () => {
    expect(verifyAdminSessionToken(validToken(), { secret: TEST_SECRET })).toBe(true);
  });

  it("rejects a token signed with a different secret", () => {
    const token = validToken();
    expect(verifyAdminSessionToken(token, { secret: "another-secret" })).toBe(false);
  });

  it("rejects expired tokens", () => {
    const token = validToken({ ttlSeconds: -10 });
    expect(verifyAdminSessionToken(token, { secret: TEST_SECRET })).toBe(false);
  });

  it("rejects tampered and malformed tokens", () => {
    const token = validToken();
    expect(verifyAdminSessionToken(`${token}x`, { secret: TEST_SECRET })).toBe(false);
    expect(verifyAdminSessionToken(token.slice(0, -2), { secret: TEST_SECRET })).toBe(false);
    expect(verifyAdminSessionToken("biz123.nonce.sig", { secret: TEST_SECRET })).toBe(false);
    expect(verifyAdminSessionToken("garbage", { secret: TEST_SECRET })).toBe(false);
    expect(verifyAdminSessionToken(undefined, { secret: TEST_SECRET })).toBe(false);
    expect(verifyAdminSessionToken(null, { secret: TEST_SECRET })).toBe(false);
  });

  it("fails closed without a secret", () => {
    const token = createAdminSessionToken({ secret: TEST_SECRET });
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    expect(verifyAdminSessionToken(token)).toBe(false);
  });
});

describe("admin configuration (fail closed)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off unless BOTH env vars are set", () => {
    expect(adminConfigured({})).toBe(false);
    expect(adminConfigured({ ADMIN_PASSWORD_HASH: TEST_HASH })).toBe(false);
    expect(adminConfigured({ ADMIN_SESSION_SECRET: TEST_SECRET })).toBe(false);
    expect(
      adminConfigured({ ADMIN_PASSWORD_HASH: TEST_HASH, ADMIN_SESSION_SECRET: TEST_SECRET })
    ).toBe(true);
  });

  it("treats whitespace-only and quoted values as configured values correctly", () => {
    expect(adminConfigured({ ADMIN_PASSWORD_HASH: "   ", ADMIN_SESSION_SECRET: TEST_SECRET })).toBe(
      false
    );
    expect(
      adminConfigured({
        ADMIN_PASSWORD_HASH: `"${TEST_HASH}"`,
        ADMIN_SESSION_SECRET: `"${TEST_SECRET}"`,
      })
    ).toBe(true);
  });
});

describe("admin session cookie", () => {
  it("carries the required attributes", () => {
    const cookie = adminSessionCookie("tok", true);
    expect(cookie.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=tok;`)).toBe(true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain(`Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`);
    expect(ADMIN_SESSION_MAX_AGE_SECONDS).toBe(28800);
    expect(cookie).toContain("; Secure");
    expect(adminSessionCookie("tok", false)).not.toContain("Secure");
  });

  it("clearing cookie expires immediately", () => {
    const cleared = clearedAdminSessionCookie(true);
    expect(cleared.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=;`)).toBe(true);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
  });

  it("finds a valid session in a multi-cookie header", () => {
    const header = `other=1; ${ADMIN_SESSION_COOKIE_NAME}=${validToken()}; extra=2`;
    expect(hasAdminSessionCookie(header, { secret: TEST_SECRET })).toBe(true);
    expect(hasAdminSessionCookie(null, { secret: TEST_SECRET })).toBe(false);
    expect(hasAdminSessionCookie("other=1", { secret: TEST_SECRET })).toBe(false);
  });
});

describe("requireAdminApi", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function adminRequest(cookie?: string): Request {
    return new Request("http://localhost:3000/api/admin/overview", {
      headers: cookie ? { cookie } : {},
    });
  }

  it("returns null for an authenticated request", () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", TEST_HASH);
    vi.stubEnv("ADMIN_SESSION_SECRET", TEST_SECRET);
    const header = `a=1; ${ADMIN_SESSION_COOKIE_NAME}=${validToken()}`;
    expect(requireAdminApi(adminRequest(header))).toBeNull();
  });

  it("returns 401 without a cookie or with an invalid one", () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", TEST_HASH);
    vi.stubEnv("ADMIN_SESSION_SECRET", TEST_SECRET);
    expect(requireAdminApi(adminRequest())?.status).toBe(401);
    expect(requireAdminApi(adminRequest(`${ADMIN_SESSION_COOKIE_NAME}=forged.junk`))?.status).toBe(
      401
    );
  });

  it("returns 404 when the admin env vars are missing — even with a cookie", () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "");
    vi.stubEnv("ADMIN_SESSION_SECRET", TEST_SECRET);
    const header = `${ADMIN_SESSION_COOKIE_NAME}=${validToken()}`;
    expect(requireAdminApi(adminRequest(header))?.status).toBe(404);
    expect(requireAdminApi(adminRequest())?.status).toBe(404);
  });

  it("rejects an owner-shaped cookie value", () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", TEST_HASH);
    vi.stubEnv("ADMIN_SESSION_SECRET", TEST_SECRET);
    const ownerToken = `biz-123.noncevalue.sigvalue`; // owner token shape, wrong secret/shape
    const header = `callflow_business_session=${ownerToken}`;
    expect(requireAdminApi(adminRequest(header))?.status).toBe(401);
  });
});