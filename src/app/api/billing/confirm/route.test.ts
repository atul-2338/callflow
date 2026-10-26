import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/lib/database";
import { createBusiness } from "@/lib/db";
import {
  businessSessionCookieName,
  createBusinessSessionToken,
} from "@/lib/business-session";
import {
  createSignupHandoffToken,
  signupHandoffCookieName,
} from "@/lib/signup-handoff";
import { POST } from "./route";

const TEST_SECRET = "confirm-route-test-secret";
// Throwaway database (business rows with unique phone numbers per test);
// DATABASE_PATH must be set before the first getDb() call resolves it.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-billing-confirm-test-${process.pid}-${Date.now()}.db`
);
process.env.DATABASE_PATH = TEST_DB_PATH;

type NewBusiness = Parameters<typeof createBusiness>[0];

function seedBusiness(overrides: Partial<NewBusiness> = {}): NewBusiness {
  return {
    phoneNumber: "+12125550041",
    carrier: "other",
    forwardingStatus: "not_started",
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
    billingName: "Reeves Plumbing",
    billingEmail: "owner@reeves.test",
    billingCountry: "US",
    trialStartedAt: null,
    subscriptionStatus: "pending_checkout",
    ...overrides,
  };
}

function confirmRequest(options: { cookie?: string; body?: Record<string, unknown> } = {}): Request {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  return new Request("http://localhost:3000/api/billing/confirm", {
    method: "POST",
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

/** An entitled business as the webhook write path leaves it after activation. */
function subscribedBusiness(
  phone: string,
  checkoutSessionId: string,
  suffix: string
): Partial<NewBusiness> {
  return {
    phoneNumber: phone,
    dodoCustomerId: `cus_confirm_${suffix}`,
    dodoSubscriptionId: `sub_confirm_${suffix}`,
    dodoCheckoutSessionId: checkoutSessionId,
    subscriptionStatus: "active",
    // Two days into the 3-day trial window → describeBillingAccess says "trialing".
    trialStartedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

describe("POST /api/billing/confirm", () => {
  beforeEach(() => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
  });

  it("valid session cookie: 200 trusted state, no cookies touched", async () => {
    const business = await createBusiness(
      seedBusiness({
        ...subscribedBusiness("+12125550001", "cs_test_1", "1"),
        billingName: "Session Biz",
      })
    );

    const response = await POST(
      confirmRequest({ cookie: `callflow_business_session=${createBusinessSessionToken(business.id)}` })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.businessId).toBe(business.id);
    expect(body.subscriptionStatus).toBe("active");
    expect(body.subscriptionId).toBe("sub_confirm_1");
    expect(body.hasSubscription).toBe(true);
    expect(body.checkoutSessionId).toBe("cs_test_1");
    expect(body.access).toEqual({ state: "trialing", entitled: true });
    // The session path never rewrites cookies.
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("missing cookie: exact 401 Unauthorized body, no cookies", async () => {
    const response = await POST(confirmRequest({}));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("tampered session cookie: exact 401 Unauthorized body", async () => {
    const business = await createBusiness(
      seedBusiness({ ...subscribedBusiness("+12125550002", "cs_test_1", "2"), billingName: "Tamper Biz" })
    );
    const token = createBusinessSessionToken(business.id);
    const forged = `${token.slice(0, -4)}aaaa`;

    const response = await POST(
      confirmRequest({ cookie: `${businessSessionCookieName()}=${forged}` })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("handoff with unpaid checkout: 200 awaiting state, NO session minted", async () => {
    // No dodoCustomerId → reconcile is skipped; state stays exactly as written.
    const business = await createBusiness(
      seedBusiness({ dodoCheckoutSessionId: "cs_test_1", billingName: "Awaiting Biz" })
    );
    const token = createSignupHandoffToken(business.id, "cs_test_1");

    const response = await POST(
      confirmRequest({
        cookie: `${signupHandoffCookieName()}=${token}`,
        body: { checkoutSessionId: "cs_test_1" },
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.businessId).toBe(business.id);
    expect(body.subscriptionStatus).toBe("pending_checkout");
    expect(body.access).toEqual({ state: "awaiting_checkout", entitled: false });
    expect(body.hasSubscription).toBe(false);
    // Unpaid checkout proves nothing yet: no session, handoff untouched.
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("handoff + webhook-linked subscription: session minted, handoff cleared", async () => {
    // The webhook write path linked a subscription before the browser came
    // back — the only situation in which the handoff may mint a session.
    const business = await createBusiness(
      seedBusiness({ ...subscribedBusiness("+12125550003", "cs_test_1", "3"), billingName: "Mint Biz" })
    );
    const token = createSignupHandoffToken(business.id, "cs_test_1");

    const response = await POST(
      confirmRequest({
        cookie: `${signupHandoffCookieName()}=${token}`,
        body: { checkoutSessionId: "cs_test_1" },
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.businessId).toBe(business.id);
    expect(body.access).toEqual({ state: "trialing", entitled: true });

    const cookies = response.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith(`${businessSessionCookieName()}=`));
    expect(session).toBeDefined();
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
    // The consumed handoff is expired on the same response.
    const cleared = cookies.find((c) => c.startsWith(`${signupHandoffCookieName()}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toContain("Max-Age=0");
  });

  it("handoff bound to an older checkout session: exact 401, no cookies", async () => {
    // A newer signup overwrote dodoCheckoutSessionId on the row.
    const business = await createBusiness(
      seedBusiness({
        ...subscribedBusiness("+12125550004", "cs_newer", "4"),
        billingName: "Stale Biz",
      })
    );
    const token = createSignupHandoffToken(business.id, "cs_older");

    const response = await POST(
      confirmRequest({ cookie: `${signupHandoffCookieName()}=${token}` })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("handoff + redirect session_id that disagrees with the cookie: exact 401", async () => {
    const business = await createBusiness(
      seedBusiness({
        ...subscribedBusiness("+12125550005", "cs_test_1", "5"),
        billingName: "Mismatch Biz",
      })
    );
    const token = createSignupHandoffToken(business.id, "cs_test_1");

    const response = await POST(
      confirmRequest({
        cookie: `${signupHandoffCookieName()}=${token}`,
        body: { checkoutSessionId: "cs_from_somewhere_else" },
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("expired handoff token: exact 401", async () => {
    const business = await createBusiness(
      seedBusiness({ dodoCheckoutSessionId: "cs_test_1", billingName: "Expired Biz" })
    );
    // Minted 31 minutes ago → past the 30-minute window.
    const token = createSignupHandoffToken(business.id, "cs_test_1", Date.now() - 31 * 60 * 1000);

    const response = await POST(
      confirmRequest({ cookie: `${signupHandoffCookieName()}=${token}` })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});