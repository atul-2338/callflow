import DodoPayments from "dodopayments";
import {
  applyDodoWebhookEvent,
  createBusiness,
  getBusinessById,
  getBusinessByName,
  getBusinessByPhone,
  updateBusiness,
} from "./db";
import { toE164InternationalPhone } from "./util";
import {
  getDodoCancelUrl,
  getDodoClient,
  getDodoPortalReturnUrl,
  getDodoReturnUrl,
  getDodoSoloProductId,
  DODO_TRIAL_DAYS,
} from "./dodo";
import { isDodoSubscriptionStatus } from "./dodo-events";
import type { Business } from "./types";

const TRIAL_MS = DODO_TRIAL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Attached to the checkout session so Dodo echoes it back on the resulting
 * subscription webhook. It is a *hint* only: the webhook handler still verifies
 * the customer id it owns before trusting it.
 */
export const DODO_BUSINESS_ID_METADATA_KEY = "callflow_business_id";

type CheckoutSessionCreateParams =
  Parameters<DodoPayments["checkoutSessions"]["create"]>[0];

export function trialEndsAt(trialStartedAt: string): string {
  return new Date(new Date(trialStartedAt).getTime() + TRIAL_MS).toISOString();
}

export function isTrialExpired(trialStartedAt: string, now = new Date()): boolean {
  return now.getTime() > new Date(trialStartedAt).getTime() + TRIAL_MS;
}

/**
 * Whether a business may use the product right now.
 *
 * Dodo is the source of truth: `subscriptionStatus` only ever moves from a
 * signature-verified webhook (`src/app/api/webhooks/dodo/route.ts`), never from
 * the checkout redirect. A trialing subscription reports `active` upstream, so
 * the local trial window only decides whether we label the state "trialing".
 */
export type BillingAccessState =
  | "awaiting_checkout"
  | "trialing"
  | "active"
  | "past_due"
  | "on_hold"
  | "lapsed";

export interface BillingAccess {
  state: BillingAccessState;
  entitled: boolean;
}

export function describeBillingAccess(
  business: Pick<Business, "trialStartedAt" | "subscriptionStatus">,
  now = new Date()
): BillingAccess {
  const trialing =
    !!business.trialStartedAt && !isTrialExpired(business.trialStartedAt, now);

  switch (business.subscriptionStatus) {
    case "active":
      return { state: trialing ? "trialing" : "active", entitled: true };
    // Dunning grace: Dodo keeps retrying, so service continues.
    case "past_due":
      return { state: "past_due", entitled: true };
    // Renewal payment failed and retries are exhausted; recoverable, but the
    // local trial window still honours what the customer was promised.
    case "on_hold":
      return { state: "on_hold", entitled: trialing };
    case "pending_checkout":
    case "not_started":
      return { state: trialing ? "trialing" : "awaiting_checkout", entitled: trialing };
    default:
      // cancelled / expired / failed / paused, or a status we do not model.
      return { state: "lapsed", entitled: false };
  }
}

/**
 * Exact, frontend-facing error for a duplicate business name. The signup
 * route returns it as the 400 error body (with code "business_name_taken")
 * and the wizard pre-check endpoint echoes it; both UIs surface this
 * string under the "Your name" input. Single source of truth — never
 * duplicate the literal elsewhere.
 */
export const BUSINESS_NAME_TAKEN_ERROR =
  "This business name is already taken. Please choose another.";

/** Thrown by createBillingSignup when a different business owns the name. */
export class BusinessNameTakenError extends Error {
  constructor(message: string = BUSINESS_NAME_TAKEN_ERROR) {
    super(message);
    this.name = "BusinessNameTakenError";
  }
}

export type BillingSignupInput = {
  phoneNumber: string;
  name: string;
  email: string;
  country: string;
};

function isCountryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

/**
 * The exact payload sent to `POST /checkouts`.
 *
 * Kept pure (no SDK call, no database) so the shape is unit-testable, and built
 * only from server-held values: the product id comes from configuration, never
 * from the browser, and the quantity is fixed at 1.
 */
export function buildSoloCheckoutSessionRequest(input: {
  businessId: string;
  customerId: string;
  country: string;
  productId: string;
  returnUrl: string;
  cancelUrl: string;
  trialDays?: number;
}): CheckoutSessionCreateParams {
  const country = input.country.trim().toUpperCase();
  if (!isCountryCode(country)) {
    throw new Error("Billing country must be a two-letter ISO country code.");
  }

  return {
    product_cart: [{ product_id: input.productId, quantity: 1 }],
    customer: { customer_id: input.customerId },
    // Pre-fills the country on the hosted page; the payer can still correct it,
    // and Dodo collects the rest of the billing address and any tax there.
    billing_address: { country: country as DodoPayments.CountryCode },
    subscription_data: { trial_period_days: input.trialDays ?? DODO_TRIAL_DAYS },
    return_url: input.returnUrl,
    cancel_url: input.cancelUrl,
    metadata: { [DODO_BUSINESS_ID_METADATA_KEY]: input.businessId },
  };
}

export interface BillingSignupResult {
  business: Business;
  /** Hosted checkout URL, or `null` when there is nothing left to pay for. */
  checkoutUrl: string | null;
  /** Dodo checkout session the URL belongs to, for reconciliation. */
  checkoutSessionId: string | null;
  /** True when a verified webhook already linked a subscription to this business. */
  alreadySubscribed: boolean;
  /**
   * True only when THIS request created the business row. The route mints the
   * browser session cookie only for freshly created businesses: for an
   * existing one, whoever typed the phone number is not proven to be the
   * owner, and a session cookie would hand them the account.
   */
  created: boolean;
}

/**
 * Start or resume trial signup: find or create the business, make sure a Dodo
 * customer exists, then open a single-use hosted Checkout Session for the Solo
 * plan with a `DODO_TRIAL_DAYS` trial.
 *
 * Dodo's trial clock starts when the customer completes checkout, so
 * `trialStartedAt` is left empty here and stamped by the `subscription.active`
 * webhook — that keeps our local trial window aligned with what Dodo bills on
 * day 4. Nothing is entitled until that webhook lands.
 */
export async function createBillingSignup(
  input: BillingSignupInput
): Promise<BillingSignupResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const country = input.country.trim().toUpperCase();

  if (
    !name ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !isCountryCode(country)
  ) {
    throw new Error("Provide a business phone, name, valid email, and two-letter billing country.");
  }

  // Dodo validates phone numbers against real international formats, so a
  // loose 10-digit check is not enough — normalize to E.164 up front and
  // surface a clear error instead of Dodo's cryptic 502.
  const phoneNumber = toE164InternationalPhone(input.phoneNumber, country);

  let business = await getBusinessByPhone(phoneNumber);

  if (business?.dodoSubscriptionId) {
    // A verified webhook already completed this signup. Never open a second
    // subscription for the same business.
    return {
      business,
      checkoutUrl: null,
      checkoutSessionId: business.dodoCheckoutSessionId,
      alreadySubscribed: true,
      created: false,
    };
  }

  // Business names must be unique across CallFlow: a different business
  // claiming this name is a hard stop BEFORE anything is created or
  // updated, and before any Dodo call. The business's own row (when
  // re-signing up an existing number) is excluded, so an owner
  // resubmitting an unchanged name still passes.
  const nameClash = await getBusinessByName(name, business?.id);
  if (nameClash) {
    throw new BusinessNameTakenError();
  }

  const created = !business;
  if (!business) {
    business = await createBusiness({
      phoneNumber,
      carrier: "other",
      forwardingStatus: "not_started",
      lastVerifiedAt: null,
      pendingVerificationFor: null,
      pendingVerificationExpiresAt: null,
      billingName: name,
      billingEmail: email,
      billingCountry: country,
      trialStartedAt: null,
      subscriptionStatus: "pending_checkout",
    });
  } else {
    business =
      (await updateBusiness(business.id, {
        billingName: name,
        billingEmail: email,
        billingCountry: country,
        subscriptionStatus: "pending_checkout",
      })) ?? business;
  }

  const client = getDodoClient();

  const customerId = business.dodoCustomerId ?? (
    await client.customers.create({
      email,
      name,
      phone_number: phoneNumber,
      metadata: { [DODO_BUSINESS_ID_METADATA_KEY]: business.id },
    })
  ).customer_id;

  // Checkout URLs are single-use, so every attempt mints a fresh session and
  // overwrites the stored id; the abandoned one simply expires on Dodo's side.
  const session = await client.checkoutSessions.create(
    buildSoloCheckoutSessionRequest({
      businessId: business.id,
      customerId,
      country,
      productId: getDodoSoloProductId(),
      returnUrl: getDodoReturnUrl(),
      cancelUrl: getDodoCancelUrl(),
    })
  );

  business =
    (await updateBusiness(business.id, {
      dodoCustomerId: customerId,
      dodoCheckoutSessionId: session.session_id,
      subscriptionStatus: "pending_checkout",
    })) ?? business;

  console.info("[dodo-billing] created hosted checkout session", {
    businessId: business.id,
    customerId,
    sessionId: session.session_id,
  });

  if (!session.checkout_url) {
    throw new Error("Dodo did not return a checkout URL. Your trial has not started yet.");
  }

  return {
    business,
    checkoutUrl: session.checkout_url,
    checkoutSessionId: session.session_id,
    alreadySubscribed: false,
    created,
  };
}

/**
 * One-time link to the Dodo customer portal, where the owner updates their
 * payment method or cancels. This is what backs the "cancel anytime" promise
 * without Callflow ever touching card data.
 */
export async function createBillingPortalLink(business: Business): Promise<string> {
  if (!business.dodoCustomerId) {
    throw new Error("No Dodo billing profile exists for this business yet.");
  }
  const session = await getDodoClient().customers.customerPortal.create(
    business.dodoCustomerId,
    { return_url: getDodoPortalReturnUrl() }
  );
  return session.link;
}

/** The slice of Dodo's subscription record reconciliation acts on. */
export type DodoSubscriptionSummary = {
  subscription_id: string;
  status: string;
  created_at: string;
  customer: { customer_id?: string | null } | null;
};

/**
 * Minimal structural view of the SDK's `subscriptions.list` — the only call
 * reconciliation needs. Kept narrow so tests can stub the client without
 * constructing a real `DodoPayments` instance.
 */
export interface DodoSubscriptionLookup {
  subscriptions: {
    list(query: { customer_id: string }): Promise<
      | { items?: Array<DodoSubscriptionSummary> }
      | Array<DodoSubscriptionSummary>
      | null
      | undefined
    >;
  };
}

/**
 * Trusted server-side payment confirmation for the checkout return page.
 *
 * The webhook is the only writer of billing state, but a webhook can lag behind
 * the browser redirect — or be lost entirely while the dashboard endpoint is
 * misconfigured. This closes that gap from the trusted side: it asks Dodo's API
 * (with the same merchant credentials that produced the webhook events) for the
 * customer's subscriptions and applies the authoritative status through the
 * exact write path the webhook route uses (`applyDodoWebhookEvent`), so the
 * audit trail, idempotency rules, trial COALESCE, and the unique subscription
 * claim all behave identically to a genuine `subscription.*` delivery.
 *
 * It never throws: a failed lookup (missing key, network, rate limit) keeps the
 * current state and lets the webhook win the race later.
 *
 * `client` is injectable so unit tests can stub the SDK without env setup.
 */
export async function reconcileDodoCheckout(
  business: Business,
  client?: DodoSubscriptionLookup
): Promise<Business> {
  // Nothing to reconcile when there is no Dodo billing profile to ask about.
  // (Whether to reconcile at all — e.g. not once the webhook has delivered a
  // live status — is the caller's policy; see /api/billing/confirm.)
  if (!business.dodoCustomerId) return business;

  let api: DodoSubscriptionLookup | undefined = client;
  if (!api) {
    try {
      api = getDodoClient();
    } catch (error) {
      console.warn("[dodo-billing] reconcile skipped — Dodo client unavailable", {
        businessId: business.id,
        message: error instanceof Error ? error.message : "unknown",
      });
      return business;
    }
  }

  let subscriptions: DodoSubscriptionSummary[];
  try {
    const page = await api.subscriptions.list({ customer_id: business.dodoCustomerId });
    subscriptions = Array.isArray(page) ? page : (page?.items ?? []);
  } catch (error) {
    console.warn("[dodo-billing] reconcile lookup failed", {
      businessId: business.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return business;
  }

  // Only subscriptions Dodo itself attributes to this customer may move this
  // business's state. Most recent wins if a retried checkout created several.
  const latest = subscriptions
    .filter(
      (sub) =>
        typeof sub?.subscription_id === "string" &&
        sub.subscription_id.length > 0 &&
        sub?.customer?.customer_id === business.dodoCustomerId
    )
    .sort(
      (a, b) => (Date.parse(b?.created_at ?? "") || 0) - (Date.parse(a?.created_at ?? "") || 0)
    )[0];

  // An unrecognized status string stays out of our state machine, exactly as
  // `normalizeDodoEvent` treats unrecognized webhook payloads.
  if (!latest || !isDodoSubscriptionStatus(latest.status)) return business;

  // Dodo's own record is the trial clock: the subscription's creation is when
  // the trial began, so mirror that instead of the reconcile arrival time. The
  // COALESCE in the write path keeps any earlier, authoritative stamp.
  const startTrialAt =
    latest.status === "active" && latest.created_at ? latest.created_at : null;

  await applyDodoWebhookEvent({
    // Synthetic, self-describing id: every observation gets its own row in
    // `dodo_webhook_events`, and a later reconcile with a changed status still
    // applies instead of being swallowed by webhook-id idempotency.
    webhookId: `reconcile:${latest.subscription_id}:${latest.status}:${new Date().toISOString()}`,
    eventType: `subscription.${latest.status}`,
    businessHint: business.id,
    customerId: business.dodoCustomerId,
    subscriptionId: latest.subscription_id,
    subscriptionStatus: latest.status,
    startTrialAt,
  });

  console.info("[dodo-billing] reconciled from Dodo API", {
    businessId: business.id,
    subscriptionId: latest.subscription_id,
    status: latest.status,
  });

  return (await getBusinessById(business.id)) ?? business;
}