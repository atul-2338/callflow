/**
 * Normalization of Dodo Payments webhook payloads into Callflow-safe updates.
 *
 * Dodo delivers 40+ event types whose `data` object is the raw payment,
 * subscription, refund, … record. Two rules from Dodo's own integration guidance
 * drive this module:
 *
 * 1. A subscription entitlement may only move on a `subscription.*` event.
 *    `payment.*` events carry a *payment* status (`succeeded`, `failed`), which is
 *    not a subscription status — writing it to `subscriptionStatus` corrupts the
 *    billing state machine.
 * 2. `event.business_id` is Dodo's merchant identifier (`bus_...`), never our own
 *    `businesses.id`. Matching on it is a bug; we match on the customer id, the
 *    subscription id, or the `callflow_business_id` hint we attach at checkout.
 *
 * Payloads are untrusted input, so every field is guarded at runtime rather than
 * cast. This module is pure and side-effect free so it can be unit tested without
 * a Dodo account or a database.
 */

/** Statuses Dodo reports for a subscription (SDK `SubscriptionStatus` union). */
export const DODO_SUBSCRIPTION_STATUSES = [
  "pending",
  "active",
  "on_hold",
  "paused",
  "cancelled",
  "failed",
  "expired",
  "past_due",
] as const;

export type DodoSubscriptionStatus = (typeof DODO_SUBSCRIPTION_STATUSES)[number];

/** Callflow-local states that live in the same column but never come from Dodo. */
export const CALLFLOW_BILLING_STATES = ["not_started", "pending_checkout"] as const;

export function isDodoSubscriptionStatus(value: unknown): value is DodoSubscriptionStatus {
  return (
    typeof value === "string" &&
    (DODO_SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}

export type NormalizedDodoEvent = {
  /** Raw `event.type`, or "unknown" when the payload is malformed. */
  eventType: string;
  /** True for the event families Callflow acts on. */
  relevant: boolean;
  subscriptionId: string | null;
  customerId: string | null;
  paymentId: string | null;
  /**
   * Subscription status to persist, or `null` when the event must not change it
   * (payment events, lifecycle no-ops, or an unrecognized status string).
   */
  subscriptionStatus: DodoSubscriptionStatus | null;
  /** Our `businesses.id`, echoed back from the checkout session metadata. */
  businessHint: string | null;
};

const IRRELEVANT: Omit<NormalizedDodoEvent, "eventType"> = {
  relevant: false,
  subscriptionId: null,
  customerId: null,
  paymentId: null,
  subscriptionStatus: null,
  businessHint: null,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nestedString(record: unknown, key: string): string | null {
  const obj = asRecord(record);
  return obj ? asString(obj[key]) : null;
}

/**
 * Reduce a verified Dodo webhook payload to the fields Callflow persists.
 *
 * `event` is the object returned by `standardwebhooks`' `verify()` (or
 * `client.webhooks.unwrap()`), i.e. already signature-checked.
 */
export function normalizeDodoEvent(event: unknown): NormalizedDodoEvent {
  const envelope = asRecord(event);
  const eventType = envelope ? asString(envelope.type) : null;
  if (!envelope || !eventType) {
    return { eventType: "unknown", ...IRRELEVANT };
  }

  const data = asRecord(envelope.data);
  const customerId = nestedString(data?.customer, "customer_id");
  const subscriptionId = data ? asString(data.subscription_id) : null;
  const paymentId = data ? asString(data.payment_id) : null;
  const businessHint = nestedString(data?.metadata, "callflow_business_id");

  if (eventType.startsWith("subscription.")) {
    // `subscription.renewed`, `.updated`, `.plan_changed`, … all carry the full
    // subscription record, so the status on the payload is authoritative. When it
    // is missing or unknown we keep the current status instead of guessing.
    const status = data ? asString(data.status) : null;
    return {
      eventType,
      relevant: true,
      subscriptionId,
      customerId,
      paymentId,
      subscriptionStatus: isDodoSubscriptionStatus(status) ? status : null,
      businessHint,
    };
  }

  if (eventType.startsWith("payment.")) {
    // Payments are recorded for audit only. The first successful payment of a
    // trial-backed subscription is followed by `subscription.active`, which is
    // what grants access.
    return {
      eventType,
      relevant: true,
      subscriptionId,
      customerId,
      paymentId,
      subscriptionStatus: null,
      businessHint,
    };
  }

  return { eventType, ...IRRELEVANT, customerId, businessHint };
}
