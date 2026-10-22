import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";

// Point the app database at a throwaway file *before* `./database` opens it, so
// the suite never touches ./data/callflow.db.
const testDbPath = path.join(os.tmpdir(), `callflow-reconcile-test-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = testDbPath;

const { createBusiness } = await import("./db");
const { describeBillingAccess, reconcileDodoCheckout } = await import("./billing");
const { getDb } = await import("./database");

type NewBusiness = Parameters<typeof createBusiness>[0];

// The businesses table has unique indexes on phoneNumber, dodoCustomerId and
// dodoSubscriptionId, so every test gets its own ids.
let seq = 0;
function uniqueIds() {
  seq += 1;
  return {
    phoneNumber: `+1555000${String(1000 + seq)}`,
    customerId: `cus_rec_${seq}`,
    subscriptionId: `sub_rec_${seq}`,
  };
}

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

/** A stub standing in for the Dodo SDK client's `subscriptions.list`. */
function stubClient(items: unknown[], error?: Error) {
  return {
    subscriptions: {
      list: vi.fn(async () => {
        if (error) throw error;
        return { items };
      }),
    },
  };
}

function activeSubscription(created_at: string, customerId: string, subscriptionId: string) {
  return {
    subscription_id: subscriptionId,
    status: "active",
    created_at,
    customer: { customer_id: customerId },
  };
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

describe("reconcileDodoCheckout", () => {
  it("keeps reconciling across polls: pending first, then active", async () => {
    const ids = uniqueIds();
    const business = await createBusiness(
      seed({ phoneNumber: ids.phoneNumber, dodoCustomerId: ids.customerId })
    );

    // Poll 1: Dodo has created the subscription but the payment is still
    // processing — the id links, no trial starts, state stays unconfirmed.
    const afterPending = await reconcileDodoCheckout(
      business,
      stubClient([
        { ...activeSubscription("2026-09-22T12:00:00.000Z", ids.customerId, ids.subscriptionId), status: "pending" },
      ]) as never
    );
    expect(afterPending.subscriptionStatus).toBe("pending");
    expect(afterPending.dodoSubscriptionId).toBe(ids.subscriptionId);
    expect(afterPending.trialStartedAt).toBeNull();

    // Poll 2: the same subscription has gone active — the existing link must
    // not stop the next reconcile from picking it up (no webhook-id
    // idempotency trap between polls).
    const afterActive = await reconcileDodoCheckout(
      afterPending,
      stubClient([activeSubscription("2026-09-23T12:00:00.000Z", ids.customerId, ids.subscriptionId)]) as never
    );
    expect(afterActive.subscriptionStatus).toBe("active");
    expect(afterActive.trialStartedAt).toBe("2026-09-23T12:00:00.000Z");
    expect(describeBillingAccess(afterActive).entitled).toBe(true);
  });

  it("does nothing without a Dodo customer to ask about", async () => {
    const ids = uniqueIds();
    const business = await createBusiness(seed({ phoneNumber: ids.phoneNumber }));
    const client = stubClient([]);

    const result = await reconcileDodoCheckout(business, client as never);

    expect(client.subscriptions.list).not.toHaveBeenCalled();
    expect(result.subscriptionStatus).toBe("pending_checkout");
  });

  it("applies the subscription Dodo's API reports as active, with Dodo's trial clock", async () => {
    const ids = uniqueIds();
    const business = await createBusiness(
      seed({ phoneNumber: ids.phoneNumber, dodoCustomerId: ids.customerId })
    );
    // Dodo's own creation timestamp — recent, so the 3-day trial window is live.
    const startedAt = new Date().toISOString();
    const client = stubClient([activeSubscription(startedAt, ids.customerId, ids.subscriptionId)]);

    const result = await reconcileDodoCheckout(business, client as never);

    expect(client.subscriptions.list).toHaveBeenCalledWith({ customer_id: ids.customerId });
    expect(result.subscriptionStatus).toBe("active");
    expect(result.dodoSubscriptionId).toBe(ids.subscriptionId);
    expect(result.trialStartedAt).toBe(startedAt);

    const access = describeBillingAccess(result);
    expect(access).toEqual({ state: "trialing", entitled: true });

    // The write went through the audited webhook path, so the reconcile is
    // visible in the same event log a genuine delivery would be. Scoped to this
    // test's subscription id — the file shares one throwaway database.
    const audit = getDb()
      .prepare(
        "SELECT eventType FROM dodo_webhook_events WHERE webhookId LIKE ?"
      )
      .all(`reconcile:${ids.subscriptionId}:%`) as Array<{ eventType: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0].eventType).toBe("subscription.active");
  });

  it("keeps waiting when Dodo has no subscription yet", async () => {
    const ids = uniqueIds();
    const business = await createBusiness(
      seed({ phoneNumber: ids.phoneNumber, dodoCustomerId: ids.customerId })
    );
    const client = stubClient([]);

    const result = await reconcileDodoCheckout(business, client as never);

    expect(client.subscriptions.list).toHaveBeenCalledOnce();
    expect(result.subscriptionStatus).toBe("pending_checkout");
    expect(result.dodoSubscriptionId).toBeNull();
    expect(result.trialStartedAt).toBeNull();
  });

  it("ignores subscriptions Dodo attributes to a different customer", async () => {
    const ids = uniqueIds();
    const business = await createBusiness(
      seed({ phoneNumber: ids.phoneNumber, dodoCustomerId: ids.customerId })
    );
    const client = stubClient([
      activeSubscription("2026-09-22T12:00:00.000Z", "cus_someone_else", ids.subscriptionId),
    ]);

    const result = await reconcileDodoCheckout(business, client as never);

    expect(result.subscriptionStatus).toBe("pending_checkout");
    expect(result.dodoSubscriptionId).toBeNull();
  });

  it("survives a Dodo API failure without throwing", async () => {
    const ids = uniqueIds();
    const business = await createBusiness(
      seed({ phoneNumber: ids.phoneNumber, dodoCustomerId: ids.customerId })
    );
    const client = stubClient([], new Error("502 upstream"));

    const result = await reconcileDodoCheckout(business, client as never);

    expect(result.subscriptionStatus).toBe("pending_checkout");
    expect(result.dodoSubscriptionId).toBeNull();
  });

  it("applies a later status change instead of being swallowed by idempotency", async () => {
    const ids = uniqueIds();
    const business = await createBusiness(
      seed({ phoneNumber: ids.phoneNumber, dodoCustomerId: ids.customerId })
    );

    const afterActive = await reconcileDodoCheckout(
      business,
      stubClient([activeSubscription("2026-09-22T12:00:00.000Z", ids.customerId, ids.subscriptionId)]) as never
    );
    expect(afterActive.subscriptionStatus).toBe("active");
    expect(afterActive.trialStartedAt).toBe("2026-09-22T12:00:00.000Z");

    const afterCancelled = await reconcileDodoCheckout(
      afterActive,
      stubClient([
        { ...activeSubscription("2026-09-22T12:00:00.000Z", ids.customerId, ids.subscriptionId), status: "cancelled" },
      ]) as never
    );
    expect(afterCancelled.subscriptionStatus).toBe("cancelled");
    // The trial stamp is never rewritten — COALESCE keeps the first one.
    expect(afterCancelled.trialStartedAt).toBe("2026-09-22T12:00:00.000Z");
    expect(describeBillingAccess(afterCancelled).entitled).toBe(false);
  });

  it("links the subscription without starting a trial for a non-active status", async () => {
    const ids = uniqueIds();
    const business = await createBusiness(
      seed({ phoneNumber: ids.phoneNumber, dodoCustomerId: ids.customerId })
    );
    const client = stubClient([
      { ...activeSubscription("2026-09-22T12:00:00.000Z", ids.customerId, ids.subscriptionId), status: "pending" },
    ]);

    const result = await reconcileDodoCheckout(business, client as never);

    expect(result.subscriptionStatus).toBe("pending");
    expect(result.dodoSubscriptionId).toBe(ids.subscriptionId);
    expect(result.trialStartedAt).toBeNull();
  });

  it("picks the most recent subscription when Dodo returns several", async () => {
    const ids = uniqueIds();
    const business = await createBusiness(
      seed({ phoneNumber: ids.phoneNumber, dodoCustomerId: ids.customerId })
    );
    const client = stubClient([
      activeSubscription("2026-09-22T12:00:00.000Z", ids.customerId, "sub_old"),
      activeSubscription("2026-09-23T12:00:00.000Z", ids.customerId, "sub_new"),
    ]);

    const result = await reconcileDodoCheckout(business, client as never);

    expect(result.dodoSubscriptionId).toBe("sub_new");
    expect(result.trialStartedAt).toBe("2026-09-23T12:00:00.000Z");
  });
});