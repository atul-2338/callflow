import DodoPayments from "dodopayments";
import { createBusiness, getBusinessByPhone, updateBusiness } from "./db";
import { toE164InternationalPhone } from "./util";
import {
  getDodoCancelUrl,
  getDodoClient,
  getDodoPortalReturnUrl,
  getDodoReturnUrl,
  getDodoSoloProductId,
  DODO_TRIAL_DAYS,
} from "./dodo";
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
    };
  }

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