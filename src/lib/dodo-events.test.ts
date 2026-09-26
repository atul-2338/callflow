import { describe, expect, it } from "vitest";
import {
  DODO_SUBSCRIPTION_STATUSES,
  isDodoSubscriptionStatus,
  normalizeDodoEvent,
} from "./dodo-events";

function subscriptionEvent(overrides: Record<string, unknown> = {}) {
  return {
    business_id: "bus_merchant_1",
    type: "subscription.active",
    timestamp: "2026-09-22T12:00:00Z",
    data: {
      subscription_id: "sub_abc",
      status: "active",
      customer: { customer_id: "cus_abc", email: "owner@biz.test", name: "Owner" },
      metadata: { callflow_business_id: "biz_123" },
      ...overrides,
    },
  };
}

describe("normalizeDodoEvent", () => {
  it("reads ids and status off a subscription event", () => {
    expect(normalizeDodoEvent(subscriptionEvent())).toEqual({
      eventType: "subscription.active",
      relevant: true,
      subscriptionId: "sub_abc",
      customerId: "cus_abc",
      paymentId: null,
      subscriptionStatus: "active",
      businessHint: "biz_123",
    });
  });

  it("never copies a payment status into subscriptionStatus", () => {
    const normalized = normalizeDodoEvent({
      business_id: "bus_merchant_1",
      type: "payment.succeeded",
      timestamp: "2026-09-22T12:00:00Z",
      data: {
        payment_id: "pay_123",
        status: "succeeded",
        customer: { customer_id: "cus_abc" },
      },
    });

    expect(normalized.relevant).toBe(true);
    expect(normalized.subscriptionStatus).toBeNull();
    expect(normalized.paymentId).toBe("pay_123");
    expect(normalized.customerId).toBe("cus_abc");
  });

  it("keeps the current status when a subscription event carries no known one", () => {
    expect(normalizeDodoEvent(subscriptionEvent({ status: undefined })).subscriptionStatus).toBeNull();
    expect(normalizeDodoEvent(subscriptionEvent({ status: "reprocessed" })).subscriptionStatus).toBeNull();
    expect(normalizeDodoEvent(subscriptionEvent({ status: "past_due" })).subscriptionStatus).toBe(
      "past_due"
    );
  });

  it("acknowledges unrelated events without acting on them", () => {
    for (const type of ["refund.succeeded", "payout.created", "dispute.opened", "credit.added"]) {
      const normalized = normalizeDodoEvent({ business_id: "bus_1", type, data: {} });
      expect(normalized.relevant).toBe(false);
      expect(normalized.subscriptionStatus).toBeNull();
      expect(normalized.subscriptionId).toBeNull();
    }
  });

  it("does not mistake Dodo's merchant business_id for a Callflow id", () => {
    const normalized = normalizeDodoEvent({
      ...subscriptionEvent(),
      data: { subscription_id: "sub_abc", status: "active", customer: { customer_id: "cus_abc" } },
    });
    expect(normalized.businessHint).toBeNull();
  });

  it("survives malformed payloads", () => {
    for (const payload of [null, undefined, "nope", 42, [], {}, { type: "" }, { type: 7, data: null }]) {
      const normalized = normalizeDodoEvent(payload);
      expect(normalized.relevant).toBe(false);
      expect(normalized.eventType).toBe("unknown");
    }
  });

  it("ignores non-string metadata and customer fields", () => {
    const normalized = normalizeDodoEvent({
      type: "subscription.updated",
      data: {
        subscription_id: 12345,
        status: "active",
        customer: { customer_id: null },
        metadata: { callflow_business_id: 998 },
      },
    });
    expect(normalized.subscriptionId).toBeNull();
    expect(normalized.customerId).toBeNull();
    expect(normalized.businessHint).toBeNull();
    expect(normalized.subscriptionStatus).toBe("active");
  });

  it("accepts exactly the documented subscription statuses", () => {
    expect(DODO_SUBSCRIPTION_STATUSES).toContain("past_due");
    expect(isDodoSubscriptionStatus("succeeded")).toBe(false);
    expect(isDodoSubscriptionStatus("on_hold")).toBe(true);
  });
});