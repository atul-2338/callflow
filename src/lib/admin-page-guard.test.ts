/**
 * Phase 5 safety tests for the page-side guard (requireAdminPage), which the
 * admin/(protected) layout calls once for every /admin page.
 *
 * next/headers and next/navigation are faked to their real contract:
 * cookies() hands back raw token VALUES keyed by name, and redirect() /
 * notFound() abort rendering by throwing — so the guard's outcome is
 * observable from a unit test.
 *
 * The point of this file is session isolation: a genuinely valid owner
 * (callflow_business_session) cookie — minted here by the real
 * business-session module — must never satisfy the admin guard.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const cookieStoreState = vi.hoisted(() => ({
  present: false,
  name: "",
  value: "",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieStoreState.present && cookieStoreState.name === name
        ? { name, value: cookieStoreState.value }
        : undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: (): never => {
    throw new Error("NOT_FOUND");
  },
}));

import { ADMIN_SESSION_COOKIE_NAME, createAdminSessionToken } from "./admin-session";
import { businessSessionCookieName, createBusinessSessionToken } from "./business-session";
import { requireAdminPage } from "./admin-page-guard";

const ADMIN_SECRET = "page-guard-test-admin-secret";
const OWNER_SECRET = "page-guard-test-owner-secret";
// adminConfigured() only checks non-emptiness, so a realistic-looking but
// unused placeholder is enough for the page guard tests.
const HASH_PLACEHOLDER = "scrypt$16384$8$1$deadbeef$cafebabe";

function setCookie(name: string, value: string): void {
  cookieStoreState.present = true;
  cookieStoreState.name = name;
  cookieStoreState.value = value;
}

describe("requireAdminPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    cookieStoreState.present = false;
    cookieStoreState.name = "";
    cookieStoreState.value = "";
  });

  function stubAdminConfigured(): void {
    vi.stubEnv("ADMIN_PASSWORD_HASH", HASH_PLACEHOLDER);
    vi.stubEnv("ADMIN_SESSION_SECRET", ADMIN_SECRET);
  }

  it("redirects to /admin/login when only the owner session cookie is present", async () => {
    stubAdminConfigured();
    vi.stubEnv("BUSINESS_SESSION_SECRET", OWNER_SECRET);
    // A genuinely valid owner token from the real owner session module.
    setCookie(businessSessionCookieName(), createBusinessSessionToken("biz-owner-1"));
    await expect(requireAdminPage()).rejects.toThrow("REDIRECT:/admin/login");
  });

  it("rejects an owner-format token even if it is placed under the admin cookie name", async () => {
    stubAdminConfigured();
    vi.stubEnv("BUSINESS_SESSION_SECRET", OWNER_SECRET);
    setCookie(ADMIN_SESSION_COOKIE_NAME, createBusinessSessionToken("biz-owner-1"));
    // The owner token has 3 dot-separated parts; the admin verifier demands
    // the 5-part admin.v1.<expires>.<nonce>.<hmac> shape, so this fails.
    await expect(requireAdminPage()).rejects.toThrow("REDIRECT:/admin/login");
  });

  it("redirects when no session cookie is present", async () => {
    stubAdminConfigured();
    await expect(requireAdminPage()).rejects.toThrow("REDIRECT:/admin/login");
  });

  it("rejects a forged admin token", async () => {
    stubAdminConfigured();
    setCookie(ADMIN_SESSION_COOKIE_NAME, "admin.v1.99999999999999.somelongnonce.forged");
    await expect(requireAdminPage()).rejects.toThrow("REDIRECT:/admin/login");
  });

  it("lets a valid admin session through without redirecting", async () => {
    stubAdminConfigured();
    setCookie(ADMIN_SESSION_COOKIE_NAME, createAdminSessionToken());
    await expect(requireAdminPage()).resolves.toBeUndefined();
  });

  it("notFound()s when the admin env vars are missing, even with a valid token", async () => {
    // Mint the token while the secret is configured, then fail the env closed.
    vi.stubEnv("ADMIN_SESSION_SECRET", ADMIN_SECRET);
    const token = createAdminSessionToken();
    vi.stubEnv("ADMIN_PASSWORD_HASH", "");
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    setCookie(ADMIN_SESSION_COOKIE_NAME, token);
    await expect(requireAdminPage()).rejects.toThrow("NOT_FOUND");
  });
});