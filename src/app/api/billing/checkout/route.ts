/**
 * POST /api/billing/checkout — mint a fresh Dodo hosted-checkout session for
 * the SIGNED-IN business. This is the endpoint behind the "Subscribe" CTA on
 * the /app trial banner and paywall (src/components/billing/BillingNotice.tsx).
 *
 * WHY a route and not a link: Dodo's hosted checkout URLs are single-use and
 * expire, so no static env var or page link can ever be one (the brief's
 * `DODO_CHECKOUT_URL` premise is stale). Every click asks the server for a NEW
 * session bound to THIS business (`metadata.callflow_business_id`), and the
 * signature-verified webhook remains the only thing that grants access — the
 * browser redirect that follows is a hint, never proof (see
 * src/app/api/webhooks/dodo/route.ts).
 *
 * Guard: the owner session cookie alone. The business id comes from the cookie
 * and never from the body, so one owner can never open a checkout against
 * another business. A business that already carries a Dodo subscription is
 * refused (409): reactivating or fixing a payment method is the customer
 * portal's job (POST /api/billing/portal).
 *
 * The protected billing modules are imported READ-ONLY: every step below
 * reuses their exported helpers (buildSoloCheckoutSessionRequest,
 * getDodoClient, the product/URL getters) instead of reimplementing the
 * checkout payload or calling Dodo endpoints of our own.
 */
import { NextResponse } from "next/server";

import {
  DODO_BUSINESS_ID_METADATA_KEY,
  buildSoloCheckoutSessionRequest,
} from "@/lib/billing";
import { businessIdFromCookieHeader } from "@/lib/business-session";
import { getBusinessById, updateBusiness } from "@/lib/db";
import {
  getDodoCancelUrl,
  getDodoClient,
  getDodoReturnUrl,
  getDodoSoloProductId,
} from "@/lib/dodo";
import { withCheckoutReturnParam } from "@/lib/signup-handoff";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Dodo requires a two-letter billing country. Every CallFlow pool number is US,
 * and admin-created customers are written with `billingCountry: "US"` — the same
 * default is used here for a row that somehow has none.
 */
const DEFAULT_BILLING_COUNTRY = "US";

/** Abuse guard: each click can create a Dodo customer/session on their side. */
const IP_LIMIT = 10;
const BUSINESS_LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request): Promise<NextResponse> {
  const businessId = businessIdFromCookieHeader(request.headers.get("cookie"));
  if (!businessId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ipLimit = rateLimit(`billing-checkout:ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
    );
  }
  const businessLimit = rateLimit(
    `billing-checkout:biz:${businessId}`,
    BUSINESS_LIMIT,
    WINDOW_MS
  );
  if (!businessLimit.allowed) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(businessLimit.retryAfterSeconds) } }
    );
  }

  const business = await getBusinessById(businessId);
  if (!business) {
    return NextResponse.json({ error: "Billing profile not found" }, { status: 404 });
  }

  // A live subscription (including a cancelled-but-still-listed one) must never
  // be duplicated: the portal is how it is fixed or cancelled. Same rule as
  // createBillingSignup's "already subscribed" short-circuit.
  if (business.dodoSubscriptionId) {
    return NextResponse.json(
      { error: "Your subscription is already set up — use Manage billing instead." },
      { status: 409 }
    );
  }

  const email = business.billingEmail?.trim() || "";
  if (!email) {
    return NextResponse.json(
      { error: "No billing email is on file for this account. Please contact support." },
      { status: 409 }
    );
  }
  const country = business.billingCountry?.trim().toUpperCase() || DEFAULT_BILLING_COUNTRY;
  const billingCountry = /^[A-Z]{2}$/.test(country) ? country : DEFAULT_BILLING_COUNTRY;

  try {
    const client = getDodoClient();

    // One Dodo customer per business: reuse the stored id when there is one.
    const customerId =
      business.dodoCustomerId ??
      (
        await client.customers.create({
          email,
          name:
            business.billingName?.trim() || business.ownerName?.trim() || "Callflow customer",
          phone_number: business.phoneNumber,
          metadata: { [DODO_BUSINESS_ID_METADATA_KEY]: business.id },
        })
      ).customer_id;

    // Checkout URLs are single-use, so every attempt mints a new session and
    // overwrites the stored id; the abandoned one simply expires on Dodo's side.
    // The return URL carries a signed `trial_id` for this business, so the
    // return page identifies it even when the browser drops our cookies on the
    // cross-site trip back from Dodo (see /api/billing/confirm).
    const session = await client.checkoutSessions.create(
      buildSoloCheckoutSessionRequest({
        businessId: business.id,
        customerId,
        country: billingCountry,
        productId: getDodoSoloProductId(),
        returnUrl: withCheckoutReturnParam(getDodoReturnUrl(), business.id),
        cancelUrl: getDodoCancelUrl(),
      })
    );

    // Only the ids are stored. `subscriptionStatus` is deliberately left alone:
    // it is owned by the verified webhook, and rewriting a lapsed or on-hold
    // status to 'pending_checkout' here would both hide why access stopped and
    // outlive an abandoned checkout.
    await updateBusiness(business.id, {
      dodoCustomerId: customerId,
      dodoCheckoutSessionId: session.session_id,
    });

    if (!session.checkout_url) {
      throw new Error("Dodo did not return a checkout URL.");
    }

    console.info("[dodo-billing] minted checkout session from the dashboard paywall", {
      businessId: business.id,
      customerId,
      sessionId: session.session_id,
    });

    return NextResponse.json({
      checkoutUrl: session.checkout_url,
      checkoutSessionId: session.session_id,
    });
  } catch (error) {
    console.error("[dodo-billing] dashboard checkout failed", error);
    const message = error instanceof Error ? error.message : "Unable to start checkout.";
    const status = /must be configured|must be an absolute URL/.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

