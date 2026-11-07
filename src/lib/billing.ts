import DodoPayments from "dodopayments";
import {
  applyDodoWebhookEvent,
  createBusiness,
  getBusinessByDodoCustomerId,
  getBusinessByDodoSubscriptionId,
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
import { withCheckoutReturnParam } from "./signup-handoff";
import type { Business } from "./types";

const TRIAL_MS = DODO_TRIAL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Attached to the checkout session so Dodo echoes it back on the resulting
 * subscription webhook. It is a *hint* only: the webhook handler still verifies
 * the customer id it owns before trusting it.
 */
export const DODO_BUSINESS_ID_METADATA_KEY = "callflow_business_id";

/**
 * One neutral sentence for a checkout that could not be opened. The payer gets
 * a clear, retry-able message; the operator gets the Dodo HTTP status and error
 * code in the server log. Never Dodo's raw error text (it can echo request
 * details) and never a key.
 */
export const CHECKOUT_SETUP_FAILED = "Payment setup failed, please try again.";

/**
 * The only redirect target the signup page may ever use: Dodo's own hosted
 * checkout, as an absolute https URL.
 *
 * Everything else is rejected — a missing/empty value, a relative path, plain
 * http, anything unparsable, and any URL on our OWN host. That last case is the
 * one that matters most: if `DODO_PAYMENTS_RETURN_URL` is ever handed back as
 * the "checkout" link, the payer would be dropped straight onto
 * `/checkout/return` — the "Confirming your payment" page — without a payment
 * form ever being shown. Rejecting it here keeps the payer on the signup page
 * with a visible error instead.
 *
 * Pure (no SDK, no database) so the rule is unit-testable.
 */
export function trustedCheckoutUrl(value: unknown, ownSite: string): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  try {
    if (url.host === new URL(ownSite).host) return null;
  } catch {
    // An unparsable `ownSite` cannot be compared, so the https check above is
    // the only guard — still better than refusing every real Dodo link.
  }

  return url.toString();
}

/**
 * The only parts of a Dodo SDK failure worth logging: the HTTP status and the
 * error code. Deliberately strips the error object, its request, its headers
 * and any response body, so a log line can never carry a key or a token.
 */
export function dodoErrorDetails(error: unknown): { status: number | null; code: string | null } {
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const nested =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>)
      : {};

  const rawStatus = record.status ?? record.statusCode;
  const status =
    typeof rawStatus === "number" && Number.isFinite(rawStatus) ? rawStatus : null;

  const rawCode = record.code ?? nested.code;
  const code = typeof rawCode === "string" && rawCode ? rawCode : null;

  return { status, code };
}

/**
 * Create (or reuse) this business's Dodo customer and open a hosted checkout
 * session, returning ids plus a VERIFIED checkout URL.
 *
 * Every failure mode throws the same neutral message: Dodo rejecting the call,
 * a missing `checkout_url`, or a URL that is not an absolute https link on
 * Dodo's own host (see `trustedCheckoutUrl`). Each one logs the Dodo HTTP status
 * and error code first. The caller must never redirect on a failure — the payer
 * sees Dodo's payment form or an error, never `/checkout/return`.
 */
async function openHostedCheckout(input: {
  business: Business;
  country: string;
  email: string;
  name: string;
  phoneNumber: string;
  returnUrl: string;
}): Promise<{ customerId: string; sessionId: string; checkoutUrl: string }> {
  let customerId: string;
  let session: { session_id?: string | null; checkout_url?: string | null };
  try {
    const client = getDodoClient();

    customerId =
      input.business.dodoCustomerId ??
      (
        await client.customers.create({
          email: input.email,
          name: input.name,
          phone_number: input.phoneNumber,
          metadata: { [DODO_BUSINESS_ID_METADATA_KEY]: input.business.id },
        })
      ).customer_id;

    session = await client.checkoutSessions.create(
      buildSoloCheckoutSessionRequest({
        businessId: input.business.id,
        customerId,
        country: input.country,
        productId: getDodoSoloProductId(),
        returnUrl: input.returnUrl,
        cancelUrl: getDodoCancelUrl(),
      })
    );
  } catch (error) {
    const { status, code } = dodoErrorDetails(error);
    console.error("[dodo-billing] checkout setup failed", {
      businessId: input.business.id,
      status,
      code,
    });
    throw new Error(CHECKOUT_SETUP_FAILED);
  }

  const sessionId = typeof session.session_id === "string" ? session.session_id : "";
  const checkoutUrl = trustedCheckoutUrl(session.checkout_url, input.returnUrl);
  if (!sessionId || !checkoutUrl) {
    console.error("[dodo-billing] checkout session has no usable checkout_url", {
      businessId: input.business.id,
      sessionId: sessionId || null,
      checkoutUrlPresent:
        typeof session.checkout_url === "string" && !!session.checkout_url.trim(),
    });
    throw new Error(CHECKOUT_SETUP_FAILED);
  }

  return { customerId, sessionId, checkoutUrl };
}

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
  ownerName: string;
  email: string;
  country: string;
  industry: string | null;
  carrier: string;
};

const ALLOWED_SIGNUP_INDUSTRIES = ["Plumbing", "HVAC"] as const;

function isAllowedSignupIndustry(
  value: string
): value is (typeof ALLOWED_SIGNUP_INDUSTRIES)[number] {
  return ALLOWED_SIGNUP_INDUSTRIES.includes(
    value as (typeof ALLOWED_SIGNUP_INDUSTRIES)[number]
  );
}

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
  const ownerName = input.ownerName.trim();
  const email = input.email.trim().toLowerCase();
  const country = input.country.trim().toUpperCase();
  const industry = input.industry?.trim() || null;
  const carrierLabels: Record<string, Business["carrier"]> = {
    "Verizon": "verizon",
    "T-Mobile": "tmobile",
    "AT&T": "att",
    "UScellular": "other",
    "Other / MVNO": "other",
  };
  const carrier = carrierLabels[input.carrier] ?? null;

  if (
    !name ||
    ownerName.length < 2 ||
    !carrier ||
    (industry !== null && !isAllowedSignupIndustry(industry)) ||
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
      carrier,
      ownerName,
      industry,
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
        ownerName,
        industry,
        carrier,
        subscriptionStatus: "pending_checkout",
      })) ?? business;
  }

  // Checkout URLs are single-use, so every attempt mints a fresh session and
  // overwrites the stored id; the abandoned one simply expires on Dodo's side.
  // The return URL carries a signed `trial_id` for THIS business: the handoff
  // cookie can be dropped by the browser on the cross-site trip back from Dodo,
  // the URL cannot. See withCheckoutReturnParam / /api/billing/confirm.
  //
  // A session only counts when Dodo hands back a usable absolute https
  // `checkout_url`; `openHostedCheckout` throws otherwise (after logging Dodo's
  // status + error code), so a broken setup can never redirect the payer
  // anywhere — least of all to our own /checkout/return page.
  const returnUrl = withCheckoutReturnParam(getDodoReturnUrl(), business.id);
  const { customerId, sessionId, checkoutUrl } = await openHostedCheckout({
    business,
    country,
    email,
    name,
    phoneNumber,
    returnUrl,
  });

  business =
    (await updateBusiness(business.id, {
      dodoCustomerId: customerId,
      dodoCheckoutSessionId: sessionId,
      subscriptionStatus: "pending_checkout",
    })) ?? business;

  console.info("[dodo-billing] created hosted checkout session", {
    businessId: business.id,
    customerId,
    sessionId,
  });

  return {
    business,
    checkoutUrl,
    checkoutSessionId: sessionId,
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
 * Minimal structural view of the SDK's `subscriptions.retrieve` — the call that
 * turns Dodo's redirect `subscription_id` into a business we can trust. Kept
 * narrow (and separate from `DodoSubscriptionLookup`) so tests can stub it.
 */
export interface DodoSubscriptionFetch {
  subscriptions: {
    retrieve(subscriptionId: string): Promise<
      | {
          metadata?: unknown;
          customer?: { customer_id?: string | null } | null;
          subscription_id?: string | null;
        }
      | null
      | undefined
    >;
  };
}

/**
 * Resolve the business Dodo attributes a subscription to.
 *
 * This is the identity proof for a browser that comes back from checkout with
 * neither our session cookie nor our signed `trial_id` — Dodo's redirect only
 * carries `subscription_id`. That id is a pointer, never the proof itself: the
 * answer comes from Dodo's own authenticated record (the same merchant
 * credentials that sign the webhooks). The subscription's checkout metadata
 * names one of our businesses, and the subscription's customer must be *that
 * business's* Dodo customer, otherwise nothing is returned. When Dodo returns no
 * usable metadata the customer id alone decides: it is looked up against the
 * `dodoCustomerId` we stored before sending the browser to Dodo.
 *
 * Never throws: a missing API key, network error, unknown subscription, or any
 * disagreement returns `null` and the caller answers 401.
 *
 * `client` is injectable so unit tests can stub the SDK without env setup.
 */
export async function resolveBusinessByDodoSubscription(
  subscriptionId: string,
  client?: DodoSubscriptionFetch
): Promise<Business | null> {
  // Fast path: a signature-verified webhook already linked this subscription.
  const linked = await getBusinessByDodoSubscriptionId(subscriptionId);
  if (linked) return linked;

  let api: DodoSubscriptionFetch | undefined = client;
  if (!api) {
    try {
      api = getDodoClient();
    } catch (error) {
      console.warn("[dodo-billing] subscription lookup skipped — Dodo client unavailable", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return null;
    }
  }

  let record;
  try {
    record = await api.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    console.warn("[dodo-billing] subscription lookup failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }

  if (!record) return null;
  // Defensive: the record must describe the id we asked about.
  if (record.subscription_id && record.subscription_id !== subscriptionId) return null;

  const metadata = record.metadata as Record<string, unknown> | null | undefined;
  const hintedId = metadata?.[DODO_BUSINESS_ID_METADATA_KEY];
  const customerId = record.customer?.customer_id;
  if (typeof customerId !== "string" || !customerId) return null;

  // (1) The checkout metadata names the business the subscription was created
  // for. It is only a pointer — Dodo's customer record is the authority, exactly
  // as the webhook write path treats it — so a hint whose customer disagrees
  // with the record resolves to nothing.
  if (typeof hintedId === "string" && hintedId) {
    const business = await getBusinessById(hintedId);
    if (!business || business.dodoCustomerId !== customerId) return null;

    console.info("[dodo-billing] subscription resolved to business", {
      businessId: business.id,
      subscriptionId,
    });
    return business;
  }

  // (2) No usable metadata (Dodo does not always echo checkout metadata onto the
  // subscription). The customer id is still Dodo's own attribution of the
  // subscription, and `dodoCustomerId` is written to the business row *before*
  // the browser is sent to Dodo — so it names the account that started this
  // checkout while trusting nothing the redirect itself carried. A stored
  // customer that disagrees is simply not found: a contradictory customer id
  // resolves to nothing.
  const byCustomer = await getBusinessByDodoCustomerId(customerId);
  if (!byCustomer || byCustomer.dodoCustomerId !== customerId) return null;

  console.info("[dodo-billing] subscription resolved to business via customer id", {
    businessId: byCustomer.id,
    subscriptionId,
  });
  return byCustomer;
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