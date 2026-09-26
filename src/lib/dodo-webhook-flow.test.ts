import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

// Point the app database at a throwaway file *before* `./database` opens it, so
// the suite never touches ./data/callflow.db.
const testDbPath = path.join(os.tmpdir(), `callflow-dodo-test-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = testDbPath;

const { applyDodoWebhookEvent, createBusiness, getBusinessById, updateBusiness } =
  await import("./db");
const { normalizeDodoEvent } = await import("./dodo-events");

type NewBusiness = Parameters<typeof createBusiness>[0];

function seed(overrides: Partial<NewBusiness> = {}): NewBusiness {
  return {
    phoneNumber: "+15550001111",
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

/** Runs a payload through exactly the path the webhook route uses. */
async function deliver(event: unknown, webhookId: string) {
  const normalized = normalizeDodoEvent(event);
  const result = await applyDodoWebhookEvent({
    webhookId,
    eventType: normalized.eventType,
    businessHint: normalized.businessHint,
    customerId: normalized.customerId,
    subscriptionId: normalized.subscriptionId,
    subscriptionStatus: normalized.subscriptionStatus,
    paymentId: normalized.paymentId,
    startTrialAt:
      normalized.eventType === "subscription.active" ? "2026-09-22T12:00:00.000Z" : null,
  });
  return { normalized, result };
}

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${testDbPath}${suffix}`, { force: true });
    } catch {
      // Windows keeps the file locked while the connection is open; the OS
      // clears the temp directory eventually, so the suite must not fail on it.
    }
  }
}

afterAll(cleanup);

describe("checkout → webhook → entitlement", () => {
  it("links the subscription, sets the status, and starts the trial clock", async () => {
    const business = await createBusiness(
      seed({ dodoCustomerId: "cus_hook_1", dodoCheckoutSessionId: "cks_hook_1" })
    );

    const { result } = await deliver(
      {
        business_id: "bus_merchant",
        type: "subscription.active",
        timestamp: "2026-09-22T12:00:00Z",
        data: {
          subscription_id: "sub_hook_1",
          status: "active",
          customer: { customer_id: "cus_hook_1", email: "owner@reeves.test", name: "Owner" },
          metadata: {},
        },
      },
      "evt_hook_1"
    );

    expect(result).toEqual({ accepted: true, businessId: business.id });

    const stored = await getBusinessById(business.id);
    expect(stored?.subscriptionStatus).toBe("active");
    expect(stored?.dodoSubscriptionId).toBe("sub_hook_1");
    expect(stored?.trialStartedAt).toBe("2026-09-22T12:00:00.000Z");
    expect(stored?.dodoCheckoutSessionId).toBe("cks_hook_1");
  });

  it("matches on the checkout metadata hint before anything else", async () => {
    const business = await createBusiness(
      seed({ phoneNumber: "+15550002222", dodoCustomerId: "cus_hint" })
    );

    const { result } = await deliver(
      {
        business_id: "bus_merchant",
        type: "subscription.active",
        data: {
          subscription_id: "sub_hint",
          status: "active",
          customer: { customer_id: "cus_not_ours" },
          metadata: { callflow_business_id: business.id },
        },
      },
      "evt_hint"
    );

    expect(result.businessId).toBe(business.id);
    expect((await getBusinessById(business.id))?.dodoSubscriptionId).toBe("sub_hint");
  });

  it("ignores Dodo's merchant business_id when it is the only identifier", async () => {
    const business = await createBusiness(
      seed({ phoneNumber: "+15550003333", dodoCustomerId: "cus_unlinked" })
    );

    const { result } = await deliver(
      {
        business_id: "cus_unlinked",
        type: "subscription.active",
        data: { subscription_id: "sub_orphan", status: "active" },
      },
      "evt_orphan"
    );

    expect(result).toEqual({ accepted: true, businessId: null });
    const storedOrphan = await getBusinessById(business.id);
    expect(storedOrphan?.subscriptionStatus).toBe("pending_checkout");
    expect(storedOrphan?.dodoSubscriptionId).toBeNull();
  });

  it("records a payment event without corrupting the subscription status", async () => {
    const business = await createBusiness(
      seed({
        phoneNumber: "+15550004444",
        dodoCustomerId: "cus_pay",
        dodoSubscriptionId: "sub_pay",
      })
    );

    await deliver(
      {
        business_id: "bus_merchant",
        type: "payment.succeeded",
        data: { payment_id: "pay_999", status: "succeeded", customer: { customer_id: "cus_pay" } },
      },
      "evt_pay"
    );

    const stored = await getBusinessById(business.id);
    expect(stored?.subscriptionPaymentId).toBe("pay_999");
    expect(stored?.subscriptionStatus).toBe("pending_checkout");
  });

  it("is idempotent per webhook-id and will not steal an owned subscription", async () => {
    const owner = await createBusiness(
      seed({
        phoneNumber: "+15550005555",
        dodoCustomerId: "cus_owner",
        dodoSubscriptionId: "sub_shared",
      })
    );
    const other = await createBusiness(
      seed({ phoneNumber: "+15550006666", dodoCustomerId: "cus_other" })
    );

    const payload = {
      business_id: "bus_merchant",
      type: "subscription.past_due",
      data: {
        subscription_id: "sub_shared",
        status: "past_due",
        customer: { customer_id: "cus_other" },
      },
    };

    const first = await deliver(payload, "evt_dup");
    expect(first.result.businessId).toBe(other.id);

    const replay = await deliver(payload, "evt_dup");
    expect(replay.result).toEqual({ accepted: false, businessId: null });

    // `other` matched on its own customer id, so it must not end up owning the
    // subscription that already belongs to `owner` (unique index).
    const storedOther = await getBusinessById(other.id);
    expect(storedOther?.subscriptionStatus).toBe("past_due");
    expect(storedOther?.dodoSubscriptionId).toBeNull();
    expect((await getBusinessById(owner.id))?.dodoSubscriptionId).toBe("sub_shared");
  });

  it("keeps the first trial start when a later active event arrives", async () => {
    const business = await createBusiness(
      seed({ phoneNumber: "+15550007777", dodoCustomerId: "cus_trial" })
    );
    await updateBusiness(business.id, { trialStartedAt: "2026-01-01T00:00:00.000Z" });

    await deliver(
      {
        business_id: "bus_merchant",
        type: "subscription.active",
        data: {
          subscription_id: "sub_trial",
          status: "active",
          customer: { customer_id: "cus_trial" },
        },
      },
      "evt_trial"
    );

    expect((await getBusinessById(business.id))?.trialStartedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
