import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/lib/database";
import { createBusiness, getBusinessById } from "@/lib/db";
import {
  businessSessionCookieName,
  createBusinessSessionToken,
} from "@/lib/business-session";
import { DODO_BUSINESS_ID_METADATA_KEY } from "@/lib/billing";
import {
  createCheckoutReturnToken,
  createSignupHandoffToken,
  signupHandoffCookieName,
} from "@/lib/signup-handoff";
import { POST } from "./route";

// The route resolves Dodo's redirect `subscription_id` through getDodoClient();
// swap the SDK for stubs so the suite exercises the route + database without
// network access or credentials.
const dodoMocks = vi.hoisted(() => ({
  subscriptionRetrieve: vi.fn(),
  subscriptionList: vi.fn(),
}));

vi.mock("@/lib/dodo", () => ({
  DODO_TRIAL_DAYS: 3,
  getDodoClient: () => ({
    subscriptions: {
      retrieve: dodoMocks.subscriptionRetrieve,
      list: dodoMocks.subscriptionList,
    },
  }),
  getDodoSoloProductId: () => "pdt_test_solo",
  getDodoReturnUrl: () => "https://callflow.test/checkout/return",
  getDodoCancelUrl: () => "https://callflow.test/onboarding",
  getDodoPortalReturnUrl: () => "https://callflow.test/settings",
}));

const TEST_SECRET = "confirm-route-test-secret";
// Throwaway database (business rows with unique phone numbers per test);
// DATABASE_PATH must be set before the first getDb() call resolves it.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-billing-confirm-test-${process.pid}-${Date.now()}.db`
);
// Automatic number assignment happens on a confirmed checkout, so the pool must
// be a throwaway file too — never ./data/phone_numbers.json.
const TEST_POOL_PATH = path.join(
  os.tmpdir(),
  `callflow-billing-confirm-pool-${process.pid}-${Date.now()}.json`
);
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.NUMBERS_POOL_PATH = TEST_POOL_PATH;

/** Keep the temp pool stocked so confirmed checkouts can claim a number. */
function seedPool(count = 12) {
  const entries = Array.from({ length: count }, (_, index) => ({
    number: `+1555010${String(2000 + index)}`,
    status: "available",
    businessId: null,
    assignedAt: null,
  }));
  fs.writeFileSync(TEST_POOL_PATH, JSON.stringify(entries));
}

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
    dodoMocks.subscriptionRetrieve.mockReset();
    dodoMocks.subscriptionList.mockReset();
    // Fresh pool per test: every confirmed checkout may claim one number.
    seedPool();
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
    fs.rmSync(TEST_POOL_PATH, { force: true });
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

  it("signed trial_id on the return URL, no cookies at all: 200 and a session is minted", async () => {
    // The browser is back from Dodo with nothing but the URL: no session
    // cookie, no handoff cookie. The signed trial_id must be enough.
    const business = await createBusiness(
      seedBusiness({
        ...subscribedBusiness("+12125550006", "cs_test_1", "6"),
        billingName: "Url Biz",
      })
    );

    const response = await POST(
      confirmRequest({
        body: {
          trialId: createCheckoutReturnToken(business.id),
          checkoutSessionId: "cs_test_1",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.businessId).toBe(business.id);
    expect(body.access).toEqual({ state: "trialing", entitled: true });

    const session = response.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${businessSessionCookieName()}=`));
    expect(session).toBeDefined();
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
  });

  it("signed trial_id before the webhook linked a subscription: trusted state, no session", async () => {
    // No dodoCustomerId → reconcile is skipped, so this proves the URL identity
    // only reports what the webhook has written instead of granting anything.
    const business = await createBusiness(
      seedBusiness({
        phoneNumber: "+12125550007",
        dodoCheckoutSessionId: "cs_test_pending",
        billingName: "Awaiting Url Biz",
      })
    );

    const response = await POST(
      confirmRequest({ body: { trialId: createCheckoutReturnToken(business.id) } })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.hasSubscription).toBe(false);
    expect(body.subscriptionStatus).toBe("pending_checkout");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("signed trial_id whose redirect session_id disagrees with the row: exact 401", async () => {
    const business = await createBusiness(
      seedBusiness({
        ...subscribedBusiness("+12125550008", "cs_recorded", "8"),
        billingName: "Url Mismatch Biz",
      })
    );

    const response = await POST(
      confirmRequest({
        body: {
          trialId: createCheckoutReturnToken(business.id),
          checkoutSessionId: "cs_someone_else",
        },
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("signed trial_id for a business that never started a checkout: exact 401", async () => {
    const business = await createBusiness(
      seedBusiness({ phoneNumber: "+12125550009", billingName: "No Checkout Biz" })
    );

    const response = await POST(
      confirmRequest({ body: { trialId: createCheckoutReturnToken(business.id) } })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("forged or expired trial_id: exact 401", async () => {
    const business = await createBusiness(
      seedBusiness({
        ...subscribedBusiness("+12125550010", "cs_test_1", "10"),
        billingName: "Stale Url Biz",
      })
    );

    const forged = await POST(confirmRequest({ body: { trialId: "garbage.garbage" } }));
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ error: "Unauthorized" });

    // Minted 25 hours ago → past the 24-hour checkout-link window.
    const expired = await POST(
      confirmRequest({
        body: {
          trialId: createCheckoutReturnToken(business.id, Date.now() - 25 * 60 * 60 * 1000),
        },
      })
    );
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ error: "Unauthorized" });
    expect(expired.headers.getSetCookie()).toEqual([]);
  });

  it("subscription_id only: resolved through the Dodo customer, not 401", async () => {
    // The new-signup case the return page actually hits: no session cookie, no
    // handoff cookie, and Dodo's redirect did not keep our trial_id — only
    // `subscription_id`. Dodo's record carries no checkout metadata, so the
    // `dodoCustomerId` stored before the redirect is the identity.
    const business = await createBusiness(
      seedBusiness({
        phoneNumber: "+12125550021",
        dodoCustomerId: "cus_fallback_active",
        dodoCheckoutSessionId: "cs_fallback_active",
        subscriptionStatus: "pending_checkout",
        billingName: "Fallback Active Biz",
      })
    );
    const startedAt = new Date().toISOString();
    dodoMocks.subscriptionRetrieve.mockResolvedValue({
      subscription_id: "sub_fallback_active",
      status: "active",
      created_at: startedAt,
      customer: { customer_id: "cus_fallback_active" },
    });
    dodoMocks.subscriptionList.mockResolvedValue({
      items: [
        {
          subscription_id: "sub_fallback_active",
          status: "active",
          created_at: startedAt,
          customer: { customer_id: "cus_fallback_active" },
        },
      ],
    });

    const response = await POST(confirmRequest({ body: { subscriptionId: "sub_fallback_active" } }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.businessId).toBe(business.id);
    expect(body.subscriptionStatus).toBe("active");
    expect(body.hasSubscription).toBe(true);
    expect(body.trialStartedAt).toBe(startedAt);
    // Proven through Dodo itself, so the account gets its real session; the
    // signed redirect on its own never grants anything.
    expect(
      response.headers.getSetCookie().some((c) => c.startsWith(`${businessSessionCookieName()}=`))
    ).toBe(true);
  });
  it("empty metadata and no subscription yet: 200 pending state, not 401", async () => {
    const business = await createBusiness(
      seedBusiness({
        phoneNumber: "+12125550022",
        dodoCustomerId: "cus_fallback_pending",
        dodoCheckoutSessionId: "cs_fallback_pending",
        subscriptionStatus: "pending_checkout",
        billingName: "Fallback Pending Biz",
      })
    );
    // The metadata the webhook would have trusted is missing, and Dodo has not
    // linked a subscription to this customer yet: the account is still
    // identified, the state is simply unconfirmed.
    dodoMocks.subscriptionRetrieve.mockResolvedValue({
      subscription_id: "sub_fallback_pending",
      status: "pending",
      metadata: {},
      customer: { customer_id: "cus_fallback_pending" },
    });
    dodoMocks.subscriptionList.mockResolvedValue({ items: [] });

    const response = await POST(
      confirmRequest({
        body: {
          subscriptionId: "sub_fallback_pending",
          checkoutSessionId: "cs_fallback_pending",
        },
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.businessId).toBe(business.id);
    expect(body.subscriptionStatus).toBe("pending_checkout");
    expect(body.hasSubscription).toBe(false);
    expect(body.access).toEqual({ state: "awaiting_checkout", entitled: false });
    // Nothing is proven yet → no session and no cookie changes.
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("contradictory customer id: exact 401 and a booleans-only log", async () => {
    const business = await createBusiness(
      seedBusiness({
        phoneNumber: "+12125550023",
        dodoCustomerId: "cus_fallback_ours",
        dodoCheckoutSessionId: "cs_fallback_conflict",
        subscriptionStatus: "pending_checkout",
        billingName: "Conflict Biz",
      })
    );
    // The subscription names our business in its metadata but Dodo attributes
    // it to another customer — a contradiction must prove nothing.
    dodoMocks.subscriptionRetrieve.mockResolvedValue({
      subscription_id: "sub_fallback_conflict",
      status: "active",
      metadata: { [DODO_BUSINESS_ID_METADATA_KEY]: business.id },
      customer: { customer_id: "cus_someone_else" },
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await POST(
      confirmRequest({
        body: {
          subscriptionId: "sub_fallback_conflict",
          // Dodo's redirect session_id, which no row claims (otherwise the
          // legacy session lookup would identify the business instead).
          checkoutSessionId: "cs_redirect_conflict",
        },
      })
    );
    const logged = warn.mock.calls.find(([message]) =>
      String(message).includes("no verifiable checkout identity")
    );
    warn.mockRestore();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers.getSetCookie()).toEqual([]);
    // A rejected proof never reaches the reconcile step.
    expect(dodoMocks.subscriptionList).not.toHaveBeenCalled();

    // Booleans and ids only — never the token, cookie value, key or secret.
    expect(logged?.[1]).toEqual({
      hasSessionCookie: false,
      hasHandoff: false,
      trialIdPresent: false,
      trialIdValid: false,
      subscriptionIdPresent: true,
      businessId: null,
      checkoutSessionId: "cs_redirect_conflict",
    });
  });

  it("subscription still processing: linked, 200, and still not entitled", async () => {
    const business = await createBusiness(
      seedBusiness({
        phoneNumber: "+12125550024",
        dodoCustomerId: "cus_fallback_processing",
        dodoCheckoutSessionId: "cs_fallback_processing",
        subscriptionStatus: "pending_checkout",
        billingName: "Processing Biz",
      })
    );
    dodoMocks.subscriptionRetrieve.mockResolvedValue({
      subscription_id: "sub_fallback_processing",
      status: "pending",
      metadata: {},
      customer: { customer_id: "cus_fallback_processing" },
    });
    dodoMocks.subscriptionList.mockResolvedValue({
      items: [
        {
          subscription_id: "sub_fallback_processing",
          status: "pending",
          created_at: new Date().toISOString(),
          customer: { customer_id: "cus_fallback_processing" },
        },
      ],
    });

    const response = await POST(
      confirmRequest({ body: { subscriptionId: "sub_fallback_processing" } })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.businessId).toBe(business.id);
    expect(body.subscriptionStatus).toBe("pending");
    expect(body.hasSubscription).toBe(true);
    // Reconciled through the webhook write path only: unconfirmed work is not
    // access, so the trial clock has not started either.
    expect(body.trialStartedAt).toBeNull();
    expect((body.access as { entitled: boolean }).entitled).toBe(false);
  });

  it("confirmed active checkout with no number: the number is assigned automatically", async () => {
    // The case that used to need an admin click: paid, active subscription, and
    // no assignedNumber (Dodo's webhook lagged or never delivered).
    const business = await createBusiness(
      seedBusiness({
        phoneNumber: "+12125550061",
        dodoCustomerId: "cus_confirm_auto",
        dodoSubscriptionId: "sub_confirm_auto",
        dodoCheckoutSessionId: "cs_confirm_auto",
        subscriptionStatus: "active",
        billingName: "Auto Number Biz",
      })
    );

    const response = await POST(
      confirmRequest({
        cookie: `callflow_business_session=${createBusinessSessionToken(business.id)}`,
      })
    );

    expect(response.status).toBe(200);
    // A number came from the pool (which entry is first depends on the rows
    // earlier tests in this file left behind — the claim is what matters).
    const assigned = (await getBusinessById(business.id))?.assignedNumber;
    expect(assigned).toMatch(/^\+1555010\d{4}$/);

    // Polling again must not consume a second number (idempotent + atomic).
    const again = await POST(
      confirmRequest({
        cookie: `callflow_business_session=${createBusinessSessionToken(business.id)}`,
      })
    );
    expect(again.status).toBe(200);
    expect((await getBusinessById(business.id))?.assignedNumber).toBe(assigned);
  });
});