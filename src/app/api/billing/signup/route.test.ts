import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/rate-limit";
import { closeDb } from "@/lib/database";
import { createBusiness, getBusinessByPhone } from "@/lib/db";
import { verifySignupHandoffToken } from "@/lib/signup-handoff";
import { POST } from "./route";

// The signup route calls the Dodo SDK through getDodoClient(); swap it for
// stubs so the suite exercises the route + database without network access.
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

const TEST_SECRET = "signup-route-test-secret";
// Throwaway database: this suite writes business rows (unique phone index →
// every test uses its own phone number). getDb() resolves DATABASE_PATH lazily,
// so a module-scope assignment is early enough with the static route import.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-billing-signup-test-${process.pid}-${Date.now()}.db`
);
process.env.DATABASE_PATH = TEST_DB_PATH;

type NewBusiness = Parameters<typeof createBusiness>[0];

function seedBusiness(overrides: Partial<NewBusiness> = {}): NewBusiness {
  return {
    phoneNumber: "+12125550009",
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

function signupRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request("http://localhost:3000/api/billing/signup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.7",
    },
    body: JSON.stringify({
      phoneNumber: "+12125550009",
      name: "Reeves Plumbing",
      email: "owner@reeves.test",
      country: "US",
      ...overrides,
    }),
  });
}

function cookieNames(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split("=")[0]);
}

/** Mock-SDK call sequence: each signup gets its own Dodo customer + session. */
let customerSeq = 0;

describe("POST /api/billing/signup", () => {
  beforeEach(() => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    resetRateLimits();
    // Unique Dodo ids per signup call: dodoCustomerId / dodoSubscriptionId /
    // phoneNumber carry UNIQUE indexes in the businesses table, and this suite
    // creates several businesses across tests in one database — so the counter
    // is monotonic across the whole file, never reset between tests.
    dodoMocks.customerCreate.mockReset();
    dodoMocks.customerCreate.mockImplementation(() => ({ customer_id: `cus_seq_${++customerSeq}` }));
    dodoMocks.checkoutCreate.mockReset();
    dodoMocks.checkoutCreate.mockImplementation(() => ({
      session_id: `cs_seq_${customerSeq}`,
      checkout_url: `https://checkout.dodo.test/pay/cs_seq_${customerSeq}`,
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
  });

  it("newly created business: 201, session cookie, no handoff cookie", async () => {
    const response = await POST(
      signupRequest({
        phoneNumber: "+12125550001",
        name: "Fresh Biz",
        email: "fresh@reeves.test",
      })
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.businessId).toBeTruthy();
    expect(body.checkoutUrl).toBe("https://checkout.dodo.test/pay/cs_seq_1");
    expect(body.checkoutSessionId).toBe("cs_seq_1");
    expect(body.alreadySubscribed).toBe(false);
    expect(body.sessionIssued).toBe(true);

    const cookies = response.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("callflow_business_session="));
    expect(session).toBeDefined();
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
    expect(cookieNames(response)).not.toContain("callflow_signup_handoff");
  });

  it("pre-created business (the /setup flow): 201, handoff cookie, NO session cookie", async () => {
    // /api/onboarding/start created the row earlier; billing signup finds it.
    await createBusiness(seedBusiness({ phoneNumber: "+12125550002" }));

    const response = await POST(signupRequest({ phoneNumber: "+12125550002" }));

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    const stored = await getBusinessByPhone("+12125550002");
    expect(stored).toBeDefined();
    expect(body.businessId).toBe(stored!.id);
    expect(body.sessionIssued).toBe(false);
    expect(body.alreadySubscribed).toBe(false);
    expect(body.checkoutUrl).toBe("https://checkout.dodo.test/pay/cs_seq_2");
    // The row now carries the checkout session the handoff binds to.
    expect(stored!.dodoCheckoutSessionId).toBe("cs_seq_2");

    const cookies = response.headers.getSetCookie();
    expect(cookieNames(response)).not.toContain("callflow_business_session");
    const handoff = cookies.find((c) => c.startsWith("callflow_signup_handoff="));
    expect(handoff).toBeDefined();
    expect(handoff).toContain("HttpOnly");
    expect(handoff).toContain("SameSite=Lax");
    expect(handoff).toContain("Max-Age=1800");

    // The handoff token verifies and binds to exactly this business + checkout.
    // Set-Cookie value runs up to the first "; Path=/ …" attribute.
    const token = handoff!.split("=").slice(1).join("=").split(";")[0];
    expect(verifySignupHandoffToken(token)).toEqual({
      businessId: stored!.id,
      checkoutSessionId: "cs_seq_2",
    });
  });

  it("already-subscribed business: 201, no checkout, no cookies at all", async () => {
    await createBusiness(
      seedBusiness({
        phoneNumber: "+12125550003",
        billingName: "Subscribed Biz",
        billingEmail: "sub@reeves.test",
        dodoCustomerId: "cus_sub_test_1",
        dodoSubscriptionId: "sub_test_1",
        dodoCheckoutSessionId: "cs_test_0",
        subscriptionStatus: "active",
        trialStartedAt: "2026-10-20T12:00:00.000Z",
      })
    );

    const response = await POST(signupRequest({ phoneNumber: "+12125550003" }));

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.alreadySubscribed).toBe(true);
    expect(body.checkoutUrl).toBeNull();
    expect(body.sessionIssued).toBe(false);
    // Knowing the phone number of a paying business must mint nothing.
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(dodoMocks.checkoutCreate).not.toHaveBeenCalled();
  });

  it("a different business owning the name is a 400 hard stop before any Dodo call", async () => {
    await createBusiness(seedBusiness({ phoneNumber: "+12125550004" }));

    const response = await POST(
      signupRequest({ phoneNumber: "+12125550005", name: "Reeves Plumbing" })
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string; code?: string };
    expect(body.code).toBe("business_name_taken");
    expect(body.error).toBe(
      "This business name is already taken. Please choose another."
    );
    expect(dodoMocks.customerCreate).not.toHaveBeenCalled();
    expect(dodoMocks.checkoutCreate).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("a phone Dodo would reject is a 400 with the friendly message", async () => {
    const response = await POST(signupRequest({ phoneNumber: "123" }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe(
      "Business phone number must be a valid international number with country code (e.g. +1 555 123 4567)."
    );
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});