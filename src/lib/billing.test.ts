import { describe, expect, it } from "vitest";
import {
  DODO_BUSINESS_ID_METADATA_KEY,
  buildSoloCheckoutSessionRequest,
  describeBillingAccess,
  dodoErrorDetails,
  isTrialExpired,
  trialEndsAt,
  trustedCheckoutUrl,
} from "./billing";
import { DODO_TRIAL_DAYS } from "./dodo";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-22T12:00:00.000Z");

const baseRequest = {
  businessId: "biz_123",
  customerId: "cus_test_1",
  country: "us",
  productId: "pdt_solo_monthly",
  returnUrl: "https://callflow.biz/checkout/return",
  cancelUrl: "https://callflow.biz/onboarding",
};

describe("buildSoloCheckoutSessionRequest", () => {
  it("builds the current Checkout Sessions payload, not the deprecated subscription endpoint", () => {
    const request = buildSoloCheckoutSessionRequest(baseRequest);

    expect(request.product_cart).toEqual([{ product_id: "pdt_solo_monthly", quantity: 1 }]);
    expect(request.customer).toEqual({ customer_id: "cus_test_1" });
    expect(request.subscription_data).toEqual({ trial_period_days: DODO_TRIAL_DAYS });
    expect(request.return_url).toBe("https://callflow.biz/checkout/return");
    expect(request.cancel_url).toBe("https://callflow.biz/onboarding");
    expect(request.metadata).toEqual({ [DODO_BUSINESS_ID_METADATA_KEY]: "biz_123" });
    // `payment_link` / `product_id` at the top level belong to the deprecated
    // POST /subscriptions shape and must never reappear here.
    expect(request).not.toHaveProperty("product_id");
    expect(request).not.toHaveProperty("payment_link");
  });

  it("normalizes the billing country to an upper-case ISO code", () => {
    expect(buildSoloCheckoutSessionRequest({ ...baseRequest, country: "in " }).billing_address)
      .toEqual({ country: "IN" });
  });

  it("always charges exactly one unit of the configured product", () => {
    const request = buildSoloCheckoutSessionRequest(baseRequest);
    expect(request.product_cart).toHaveLength(1);
    expect(request.product_cart[0].quantity).toBe(1);
  });

  it("refuses a country that is not a two-letter code", () => {
    expect(() => buildSoloCheckoutSessionRequest({ ...baseRequest, country: "USA" })).toThrow(
      /two-letter ISO country code/
    );
  });
});

describe("trustedCheckoutUrl", () => {
  const OWN_SITE = "https://callflow.biz/checkout/return?trial_id=abc";

  it("accepts Dodo's absolute https checkout link, query and all", () => {
    const link = "https://checkout.dodopayments.com/session/cs_123?x=1";
    expect(trustedCheckoutUrl(link, OWN_SITE)).toBe(link);
  });

  it("rejects anything that is not an absolute https URL", () => {
    for (const value of [
      "",
      "   ",
      "/pay/cs_1",
      "checkout.dodopayments.com/pay/cs_1",
      "http://checkout.dodopayments.com/pay/cs_1",
      "javascript:alert(1)",
      null,
      undefined,
      42,
      { href: "https://checkout.dodopayments.com/pay/cs_1" },
    ]) {
      expect(trustedCheckoutUrl(value, "https://callflow.biz/checkout/return")).toBeNull();
    }
  });

  it("rejects our own return page, so a mis-set return URL can never be the target", () => {
    // The exact failure this guards: Dodo (or a wrong env value) handing back
    // DODO_PAYMENTS_RETURN_URL as the "checkout" link would drop the payer on
    // /checkout/return with no payment form.
    expect(trustedCheckoutUrl("https://callflow.biz/checkout/return", OWN_SITE)).toBeNull();
    expect(
      trustedCheckoutUrl("https://callflow.biz/checkout/return?status=success", OWN_SITE)
    ).toBeNull();
  });
});

describe("dodoErrorDetails", () => {
  it("keeps only the HTTP status and the error code", () => {
    const error = Object.assign(new Error("nope"), {
      status: 401,
      error: { code: "UNAUTHORIZED", message: "bad key" },
      request: { headers: { authorization: "Bearer secret-value" } },
    });
    expect(dodoErrorDetails(error)).toEqual({ status: 401, code: "UNAUTHORIZED" });
  });

  it("returns nulls for anything it cannot read", () => {
    expect(dodoErrorDetails(new Error("offline"))).toEqual({ status: null, code: null });
    expect(dodoErrorDetails(null)).toEqual({ status: null, code: null });
    expect(dodoErrorDetails("boom")).toEqual({ status: null, code: null });
  });
});

describe("trial window", () => {
  it("ends DODO_TRIAL_DAYS after it started", () => {
    expect(trialEndsAt(NOW.toISOString())).toBe(new Date(NOW.getTime() + DODO_TRIAL_DAYS * DAY_MS).toISOString());
  });

  it("is expired only after the trial window has fully elapsed", () => {
    const started = new Date(NOW.getTime() - 2 * DAY_MS).toISOString();
    expect(isTrialExpired(started, NOW)).toBe(false);
    // Exactly on the 3-day boundary the trial still counts...
    expect(isTrialExpired(started, new Date(NOW.getTime() + DAY_MS))).toBe(false);
    // ...and expires a millisecond later.
    expect(isTrialExpired(started, new Date(NOW.getTime() + DAY_MS + 1))).toBe(true);
  });
});

describe("describeBillingAccess", () => {
  const inTrial = { trialStartedAt: new Date(NOW.getTime() - DAY_MS).toISOString() };
  const trialOver = { trialStartedAt: new Date(NOW.getTime() - 10 * DAY_MS).toISOString() };

  it("grants nothing before the webhook links a subscription", () => {
    expect(
      describeBillingAccess({ ...inTrial, subscriptionStatus: "pending_checkout" }, NOW)
    ).toEqual({ state: "trialing", entitled: true });
    expect(
      describeBillingAccess({ trialStartedAt: null, subscriptionStatus: "pending_checkout" }, NOW)
    ).toEqual({ state: "awaiting_checkout", entitled: false });
  });

  it("labels an active subscription by the local trial window", () => {
    expect(describeBillingAccess({ ...inTrial, subscriptionStatus: "active" }, NOW).state).toBe(
      "trialing"
    );
    expect(describeBillingAccess({ ...trialOver, subscriptionStatus: "active" }, NOW)).toEqual({
      state: "active",
      entitled: true,
    });
  });

  it("keeps service on through dunning and pauses it on hold", () => {
    expect(describeBillingAccess({ ...trialOver, subscriptionStatus: "past_due" }, NOW)).toEqual({
      state: "past_due",
      entitled: true,
    });
    expect(describeBillingAccess({ ...trialOver, subscriptionStatus: "on_hold" }, NOW).entitled).toBe(
      false
    );
    expect(describeBillingAccess({ ...inTrial, subscriptionStatus: "on_hold" }, NOW).entitled).toBe(
      true
    );
  });

  it("revokes access once the subscription is over", () => {
    for (const status of ["cancelled", "expired", "failed", "paused", "unheard_of"]) {
      expect(
        describeBillingAccess({ ...inTrial, subscriptionStatus: status }, NOW)
      ).toEqual({ state: "lapsed", entitled: false });
    }
  });
});