import { NextResponse } from "next/server";
import { businessIdFromCookieHeader } from "@/lib/business-session";
import { describeBillingAccess, isTrialExpired, trialEndsAt } from "@/lib/billing";
import { getBusinessById } from "@/lib/db";

export const runtime = "nodejs";

/**
 * The signed-in business's own billing state. This is the endpoint the checkout
 * return page polls: it reports what the verified webhook has written, so the
 * browser redirect from Dodo can never grant anything by itself.
 */
export async function GET(request: Request) {
  const businessId = businessIdFromCookieHeader(request.headers.get("cookie"));
  if (!businessId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const business = await getBusinessById(businessId);
  if (!business) {
    return NextResponse.json({ error: "Billing profile not found" }, { status: 404 });
  }

  const access = describeBillingAccess(business);
  return NextResponse.json({
    businessId: business.id,
    // Owner-facing display name (businesses.billingName) for the dashboard
    // header. Null when the business has no name on record.
    name: business.billingName?.trim() || null,
    subscriptionStatus: business.subscriptionStatus,
    trialStartedAt: business.trialStartedAt,
    trialEndsAt: business.trialStartedAt ? trialEndsAt(business.trialStartedAt) : null,
    trialExpired: business.trialStartedAt ? isTrialExpired(business.trialStartedAt) : false,
    access,
    hasSubscription: !!business.dodoSubscriptionId,
    checkoutSessionId: business.dodoCheckoutSessionId,
  });
}