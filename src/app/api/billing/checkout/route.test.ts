import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { businessSessionCookieName, createBusinessSessionToken } from "@/lib/business-session";
import { closeDb, getDb } from "@/lib/database";
import { createBusiness, getBusinessById } from "@/lib/db";
import { resetRateLimits } from "@/lib/rate-limit";
import { POST } from "./route";

// The route builds the checkout session through getDodoClient(); swap the SDK
// for stubs so the suite never touches the network (same pattern as
// src/app/api/billing/signup/route.test.ts).
const dodoMocks = vi.hoisted(() => ({
  customerCreate: vi.fn(),
  checkoutCreate: vi.fn(),
}));

vi.mock("@/lib/dodo", () => ({
  DODO_TRIAL_DAYS: 3,
  getDodoClient: () => ({
    customers: { create: dodoMocks.customerCreate },
    checkoutSessions: { create: dodoMocks.checkoutCreate },
  }),
  getDodoSoloProductId: () => "pdt_test_solo",
  getDodoReturnUrl: () => "https://callflow.test/checkout/return",
  getDodoCancelUrl: () => "https://callflow.test/onboarding",
  getDodoPortalReturnUrl: () => "https://callflow.test/settings",
}));

const TEST_SECRET = "billing-checkout-route-test-secret";
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-billing-checkout-test-${process.pid}-${Date.now()}.db`
);
process.env.DATABASE_PATH = TEST_DB_PATH;

type NewBusiness = Parameters<typeof createBusiness>[0];

let phoneSeq = 0;

function seedBusiness(overrides: Partial<NewBusiness> = {}): NewBusiness {
  phoneSeq += 1;
  return {
    phoneNumber: `+1212555${String(1000 + phoneSeq)}`,
    carrier: "other",
    forwardingStatus: "not_started",
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
    billingName: "Reeves Plumbing",
    billingEmail: "owner@reeves.test",
    billingCountry: "US",
    trialStartedAt: "2026-10-01T00:00:00.000Z",
    subscriptionStatus: "not_started",
    ...overrides,
  };
}

function ownerCookie(businessId: string): string {
  return `${businessSessionCookieName()}=${createBusinessSessionToken(businessId)}`;
}

function checkoutRequest(cookie?: string, ip = "203.0.113.77"): Request {
  return new Request("http://localhost:3000/api/billing/checkout", {
    method: "POST",
    headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
  });
}

let sessionSeq = 0;
let customerSeq = 0;

describe("POST /api/billing/checkout", () => {
  beforeEach(() => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    resetRateLimits();
    customerSeq = 0;
    sessionSeq = 0;
    dodoMocks.customerCreate.mockReset();
    dodoMocks.customerCreate.mockImplementation(() => ({
      customer_id: `cus_checkout_${++customerSeq}`,
    }));
    dodoMocks.checkoutCreate.mockReset();
    dodoMocks.checkoutCreate.mockImplementation(() => {
      sessionSeq += 1;
      return {
        session_id: `cs_checkout_${sessionSeq}`,
        checkout_url: `https://checkout.dodo.test/pay/cs_checkout_${sessionSeq}`,
      };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
    getDb().prepare("DELETE FROM businesses").run();
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
  });

  it("401s without an owner session", async () => {
    const response = await POST(checkoutRequest());
    expect(response.status).toBe(401);
    expect(dodoMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("404s when the session points at a business that no longer exists", async () => {
    const response = await POST(checkoutRequest(ownerCookie("biz-missing")));
    expect(response.status).toBe(404);
  });

  it("refuses to open a second subscription for a business that already has one", async () => {
    const business = await createBusiness(
      seedBusiness({ dodoSubscriptionId: "sub_existing_1", dodoCustomerId: "cus_existing_1" })
    );

    const response = await POST(checkoutRequest(ownerCookie(business.id)));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toMatch(/already set up/i);
    expect(dodoMocks.customerCreate).not.toHaveBeenCalled();
    expect(dodoMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("mints a fresh checkout session and stores the ids (no status rewrite)", async () => {
    const business = await createBusiness(seedBusiness());

    const response = await POST(checkoutRequest(ownerCookie(business.id)));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      checkoutUrl: string;
      checkoutSessionId: string;
    };
    expect(body.checkoutUrl).toMatch(/^https:\/\/checkout\.dodo\.test\/pay\//);
    expect(body.checkoutSessionId).toMatch(/^cs_checkout_\d+$/);

    // The payload binds the session to THIS business, with the Solo product and
    // a US billing address — exactly what createBillingSignup sends.
    const payload = dodoMocks.checkoutCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.metadata).toEqual({ callflow_business_id: business.id });
    expect(payload.product_cart).toEqual([{ product_id: "pdt_test_solo", quantity: 1 }]);
    expect(payload.billing_address).toEqual({ country: "US" });

    const stored = await getBusinessById(business.id);
    expect(stored!.dodoCustomerId).toBe("cus_checkout_1");
    expect(stored!.dodoCheckoutSessionId).toBe("cs_checkout_1");
    // subscriptionStatus is owned by the verified webhook — never touched here.
    expect(stored!.subscriptionStatus).toBe("not_started");
    expect(stored!.trialStartedAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("reuses an existing Dodo customer id instead of creating another", async () => {
    const business = await createBusiness(seedBusiness({ dodoCustomerId: "cus_known_9" }));

    const response = await POST(checkoutRequest(ownerCookie(business.id)));
    expect(response.status).toBe(200);
    expect(dodoMocks.customerCreate).not.toHaveBeenCalled();
    const payload = dodoMocks.checkoutCreate.mock.calls[0][0] as {
      customer: { customer_id: string };
    };
    expect(payload.customer.customer_id).toBe("cus_known_9");
  });

  it("409s when the business has no billing email to bill", async () => {
    const business = await createBusiness(seedBusiness({ billingEmail: null }));

    const response = await POST(checkoutRequest(ownerCookie(business.id)));
    expect(response.status).toBe(409);
    expect(dodoMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("rate-limits a business after 5 sessions in the window", async () => {
    const business = await createBusiness(seedBusiness());

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await POST(checkoutRequest(ownerCookie(business.id)))).status).toBe(200);
    }
    const blocked = await POST(checkoutRequest(ownerCookie(business.id)));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
  });
});
