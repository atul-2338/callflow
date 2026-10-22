import { NextResponse } from "next/server";
import { businessIdFromCookieHeader } from "@/lib/business-session";
import {
  describeBillingAccess,
  isTrialExpired,
  reconcileDodoCheckout,
  trialEndsAt,
} from "@/lib/billing";
import { getBusinessById } from "@/lib/db";

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
export async function POST(request: Request) {
  const businessId = businessIdFromCookieHeader(request.headers.get("cookie"));
  if (!businessId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let business = await getBusinessById(businessId);
  if (!business) {
    return NextResponse.json({ error: "Billing profile not found" }, { status: 404 });
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
    const last = lastReconcileAt.get(businessId) ?? 0;
    if (now - last >= RECONCILE_COOLDOWN_MS) {
      lastReconcileAt.set(businessId, now);
      business = await reconcileDodoCheckout(business);
    }
  }

  const access = describeBillingAccess(business);
  return NextResponse.json({
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
}