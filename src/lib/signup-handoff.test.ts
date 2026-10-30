import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSignupHandoffCookie,
  createSignupHandoffToken,
  signupHandoffCookie,
  signupHandoffCookieName,
  signupHandoffFromCookieHeader,
  verifySignupHandoffToken,
} from "./signup-handoff";

const TEST_SECRET = "signup-handoff-test-secret";
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

describe("signup handoff token", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips business + checkout session ids inside the expiry window", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    const now = Date.now();
    const token = createSignupHandoffToken("biz_1", "cs_1", now);
    expect(verifySignupHandoffToken(token, now + 1000)).toEqual({
      businessId: "biz_1",
      checkoutSessionId: "cs_1",
    });
  });

  it("expires after 30 minutes", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    const now = Date.now();
    const token = createSignupHandoffToken("biz_1", "cs_1", now);
    expect(verifySignupHandoffToken(token, now + THIRTY_MINUTES_MS)).toBeNull();
    expect(verifySignupHandoffToken(token, now + THIRTY_MINUTES_MS - 1)).toEqual({
      businessId: "biz_1",
      checkoutSessionId: "cs_1",
    });
  });

  it("rejects tampered payloads, signatures, and junk", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    const token = createSignupHandoffToken("biz_1", "cs_1");
    const [payload, signature] = token.split(".");

    // Same signature, different business id → signature no longer matches.
    const swapped = Buffer.from(
      JSON.stringify({ b: "biz_2", c: "cs_1", e: Date.now() + 60_000 })
    ).toString("base64url");
    expect(verifySignupHandoffToken(`${swapped}.${signature}`)).toBeNull();
    // Same payload, corrupted signature.
    expect(verifySignupHandoffToken(`${payload}.${signature.slice(0, -4)}aaaa`)).toBeNull();
    // Junk / missing values.
    expect(verifySignupHandoffToken(undefined)).toBeNull();
    expect(verifySignupHandoffToken("garbage")).toBeNull();
    expect(verifySignupHandoffToken("a.b.c")).toBeNull();
    expect(verifySignupHandoffToken("")).toBeNull();
  });

  it("refuses tokens minted with a different secret", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    const token = createSignupHandoffToken("biz_1", "cs_1");
    vi.stubEnv("BUSINESS_SESSION_SECRET", "another-secret-entirely");
    expect(verifySignupHandoffToken(token)).toBeNull();
  });

  it("refuses to mint or verify without BUSINESS_SESSION_SECRET (fail closed)", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", "");
    expect(() => createSignupHandoffToken("biz_1", "cs_1")).toThrow(
      /BUSINESS_SESSION_SECRET/
    );
    expect(() => verifySignupHandoffToken("x.y")).toThrow(/BUSINESS_SESSION_SECRET/);
  });

  it("throws when asked to mint without business or checkout session", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    expect(() => createSignupHandoffToken("", "cs_1")).toThrow(/requires a business/);
    expect(() => createSignupHandoffToken("biz_1", "")).toThrow(/requires a business/);
  });

  it("reads and validates the handoff from a raw cookie header", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    const token = createSignupHandoffToken("biz_1", "cs_1");
    const header = `${signupHandoffCookieName()}=${token}; other=cookie`;

    expect(signupHandoffFromCookieHeader(header)).toEqual({
      businessId: "biz_1",
      checkoutSessionId: "cs_1",
    });
    expect(signupHandoffFromCookieHeader(`${signupHandoffCookieName()}=nope`)).toBeNull();
    expect(signupHandoffFromCookieHeader("unrelated=1")).toBeNull();
    expect(signupHandoffFromCookieHeader(null)).toBeNull();
  });

  it("formats the cookie like the session cookie: always SameSite=None and Secure", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    const token = createSignupHandoffToken("biz_1", "cs_1");
    const cookie = signupHandoffCookie(token, true);
    expect(cookie.startsWith(`${signupHandoffCookieName()}=${token}`)).toBe(true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    // The checkout return arrives cross-site from checkout.dodo.com, so the
    // cookie needs SameSite=None + Secure or the browser drops it before
    // /api/billing/confirm can read it.
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Max-Age=1800");
    expect(cookie).toContain("Secure");
    // Secure is unconditional: the attribute is not selectable any more.
    expect(signupHandoffCookie(token, false)).toContain("Secure");

    const cleared = clearSignupHandoffCookie(false);
    expect(cleared.startsWith(`${signupHandoffCookieName()}=;`)).toBe(true);
    expect(cleared).toContain("Max-Age=0");
    // The clear must carry the same attributes, or the browser ignores it.
    expect(cleared).toContain("SameSite=None");
    expect(cleared).toContain("Secure");
  });
});