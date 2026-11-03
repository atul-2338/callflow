import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkoutReturnParamName,
  clearSignupHandoffCookie,
  createCheckoutReturnToken,
  createSignupHandoffToken,
  signupHandoffCookie,
  signupHandoffCookieName,
  signupHandoffFromCookieHeader,
  verifyCheckoutReturnToken,
  verifySignupHandoffToken,
  withCheckoutReturnParam,
} from "./signup-handoff";

const TEST_SECRET = "signup-handoff-test-secret";
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const RETURN_URL = "https://callflow.test/checkout/return";

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

describe("checkout return token (trial_id on the return URL)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips the business id through the return URL", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    const token = createCheckoutReturnToken("biz_1");
    expect(verifyCheckoutReturnToken(token)).toBe("biz_1");

    const url = new URL(withCheckoutReturnParam(RETURN_URL, "biz_1"));
    expect(`${url.origin}${url.pathname}`).toBe(RETURN_URL);
    const carried = url.searchParams.get(checkoutReturnParamName());
    expect(carried).toBeTruthy();
    expect(verifyCheckoutReturnToken(carried)).toBe("biz_1");
  });

  it("keeps query parameters the configured return URL already carries", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    const url = new URL(withCheckoutReturnParam(`${RETURN_URL}?campaign=spring`, "biz_1"));
    expect(url.searchParams.get("campaign")).toBe("spring");
    expect(verifyCheckoutReturnToken(url.searchParams.get("trial_id"))).toBe("biz_1");
  });

  it("lives 24 hours: a checkout link must outlast a slow payer, not a leaked URL", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    const now = Date.parse("2026-10-27T12:00:00Z");
    const token = createCheckoutReturnToken("biz_1", now);
    expect(verifyCheckoutReturnToken(token, now + TWENTY_FOUR_HOURS_MS - 1)).toBe("biz_1");
    expect(verifyCheckoutReturnToken(token, now + TWENTY_FOUR_HOURS_MS)).toBeNull();
  });

  it("is a separate token family from the handoff cookie", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    // Domain separation: neither token verifies under the other's key, even
    // though both are signed with BUSINESS_SESSION_SECRET.
    expect(verifyCheckoutReturnToken(createSignupHandoffToken("biz_1", "cs_1"))).toBeNull();
    expect(verifySignupHandoffToken(createCheckoutReturnToken("biz_1"))).toBeNull();
  });

  it("rejects tampered, foreign-secret, and junk tokens", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    const token = createCheckoutReturnToken("biz_1");
    const [payload, signature] = token.split(".");

    // Same signature, different business id.
    const swapped = Buffer.from(
      JSON.stringify({ b: "biz_2", e: Date.now() + 60_000 })
    ).toString("base64url");
    expect(verifyCheckoutReturnToken(`${swapped}.${signature}`)).toBeNull();
    // Same payload, corrupted signature.
    expect(verifyCheckoutReturnToken(`${payload}.${signature.slice(0, -4)}aaaa`)).toBeNull();
    // A handoff token carries a checkout id as well, and lives under its own key.
    expect(verifyCheckoutReturnToken(createSignupHandoffToken("biz_1", "cs_1"))).toBeNull();
    expect(verifyCheckoutReturnToken(null)).toBeNull();
    expect(verifyCheckoutReturnToken(undefined)).toBeNull();
    expect(verifyCheckoutReturnToken("garbage")).toBeNull();
    expect(verifyCheckoutReturnToken("a.b.c")).toBeNull();
    expect(verifyCheckoutReturnToken("")).toBeNull();
    expect(verifyCheckoutReturnToken(null)).toBeNull();
    expect(verifyCheckoutReturnToken(undefined)).toBeNull();
    expect(verifyCheckoutReturnToken("garbage")).toBeNull();
    expect(verifyCheckoutReturnToken("a.b.c")).toBeNull();
    expect(verifyCheckoutReturnToken("")).toBeNull();

    vi.stubEnv("BUSINESS_SESSION_SECRET", "another-secret-entirely");
    expect(verifyCheckoutReturnToken(token)).toBeNull();
  });

  it("fails closed without BUSINESS_SESSION_SECRET", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", "");
    expect(() => createCheckoutReturnToken("biz_1")).toThrow(/BUSINESS_SESSION_SECRET/);
    expect(() => withCheckoutReturnParam(RETURN_URL, "biz_1")).toThrow(/BUSINESS_SESSION_SECRET/);
    expect(() => verifyCheckoutReturnToken("x.y")).toThrow(/BUSINESS_SESSION_SECRET/);
  });

  it("refuses to mint without a business id", () => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    expect(() => createCheckoutReturnToken("")).toThrow(/requires a business id/);
  });
});
