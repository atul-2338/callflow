import { NextResponse } from "next/server";
import {
  businessIdFromCookieHeader,
  businessSessionCookie,
  createBusinessSessionToken,
} from "@/lib/business-session";
import {
  describeBillingAccess,
  isTrialExpired,
  reconcileDodoCheckout,
  trialEndsAt,
} from "@/lib/billing";
import { getBusinessById } from "@/lib/db";
import {
  clearSignupHandoffCookie,
  signupHandoffFromCookieHeader,
  type SignupHandoff,
} from "@/lib/signup-handoff";

export const runtime = "nodejs";

/**
 * Don't call Dodo's API more than once per business per cooldown, however fast
 * the return page polls. In-memory (one Next.js process), reset on deploy —
 * being a bit generous after a restart costs nothing.
 */
const RECONCILE_COOLDOWN_MS = 4000;
const lastReconcileAt = new Map<string, number>();

/**
 * The checkout return page's verification endpoint.
 *
 * Returns the same trusted billing state as `/api/me` — what the
 * signature-verified webhook has written — and, while a checkout is still
 * unconfirmed, additionally asks Dodo's API directly for the subscription's
 * current status and applies it through the same webhook write path. That keeps
 * the success screen honest (the redirect's `?status=` can never grant
 * anything) while making the wait converge even when Dodo's webhook delivery
 * lags behind the browser redirect.
 */
/**
 * Optional `{ checkoutSessionId }` posted by the return page: Dodo's redirect
 * `session_id`. Absent or malformed bodies simply skip this extra binding
 * check — the handoff cookie itself is always required and verified.
 */
async function readBodyCheckoutSessionId(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { checkoutSessionId?: unknown };
    return typeof body?.checkoutSessionId === "string" && body.checkoutSessionId
      ? body.checkoutSessionId
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const businessId = businessIdFromCookieHeader(cookieHeader);

  // Two authenticated paths:
  //  1. the full business session cookie (the owner already has a session), or
  //  2. the checkout-bound signup handoff cookie minted by /api/billing/signup
  //     for an existing business (a row pre-created by /setup, or a returning
  //     owner re-running the wizard). It is bound to the exact checkout
  //     session this server created, so knowing the phone number alone still
  //     opens nothing — and it becomes a session below only after the webhook
  //     has linked a subscription.
  let handoff: SignupHandoff | null = null;
  if (!businessId) {
    handoff = signupHandoffFromCookieHeader(cookieHeader);
    if (!handoff) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Exactly one of the two proofs is present here.
  const tokenBusinessId = businessId ?? handoff?.businessId;
  if (!tokenBusinessId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let business = await getBusinessById(tokenBusinessId);
  if (!business) {
    return NextResponse.json({ error: "Billing profile not found" }, { status: 404 });
  }

  if (handoff) {
    // The handoff must still name the checkout session currently stored on
    // the business row (a newer signup overwrites that id and invalidates
    // older handoffs), and if the browser brought Dodo's redirect
    // `session_id` along it must agree with the cookie. Anything else is 401.
    if (handoff.checkoutSessionId !== business.dodoCheckoutSessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const redirectSessionId = await readBodyCheckoutSessionId(request);
    if (redirectSessionId && redirectSessionId !== handoff.checkoutSessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Reconcile only while the checkout is genuinely unconfirmed. Once a webhook
  // has delivered a live Dodo status (active, past_due, on_hold, cancelled, …)
  // the webhook is proven alive and Dodo is never queried here again. `pending`
  // is included because our own earlier reconcile (or Dodo itself) may have
  // linked a subscription that is still processing — later polls must keep
  // asking until it turns active or dies.
  const UNCONFIRMED_STATUSES = new Set(["not_started", "pending_checkout", "pending"]);
  const awaitingConfirmation =
    !!business.dodoCustomerId && UNCONFIRMED_STATUSES.has(business.subscriptionStatus);

  if (awaitingConfirmation) {
    const now = Date.now();
    const last = lastReconcileAt.get(tokenBusinessId) ?? 0;
    if (now - last >= RECONCILE_COOLDOWN_MS) {
      lastReconcileAt.set(tokenBusinessId, now);
      business = await reconcileDodoCheckout(business);
    }
  }

  const access = describeBillingAccess(business);
  const response = NextResponse.json({
    businessId: business.id,
    subscriptionStatus: business.subscriptionStatus,
    subscriptionId: business.dodoSubscriptionId,
    trialStartedAt: business.trialStartedAt,
    trialEndsAt: business.trialStartedAt ? trialEndsAt(business.trialStartedAt) : null,
    trialExpired: business.trialStartedAt ? isTrialExpired(business.trialStartedAt) : false,
    access,
    hasSubscription: !!business.dodoSubscriptionId,
    checkoutSessionId: business.dodoCheckoutSessionId,
  });

  if (handoff && business.dodoSubscriptionId) {
    // The signature-verified webhook write path has linked a subscription to
    // the business this handoff was issued for: checkout completion is now
    // proven, so hand the browser the real session and retire the handoff.
    const secure =
      process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
    response.headers.append(
      "Set-Cookie",
      businessSessionCookie(createBusinessSessionToken(business.id), secure)
    );
    response.headers.append("Set-Cookie", clearSignupHandoffCookie(secure));
  }
  return response;
}