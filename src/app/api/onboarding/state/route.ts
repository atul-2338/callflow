import { NextResponse } from "next/server";

import { businessIdFromCookieHeader } from "@/lib/business-session";
import { getBusinessById } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/onboarding/state — the signed-in business's onboarding state, for
 * resuming the flow after a close/reopen and for the step-4 poll (the Dograh
 * webhook advances '4' → 'done' on the first attributed call; the page picks
 * that up here).
 */
export async function GET(request: Request) {
  const businessId = businessIdFromCookieHeader(request.headers.get("cookie"));
  if (!businessId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const business = await getBusinessById(businessId);
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  return NextResponse.json({
    onboardingStep: business.onboardingStep,
    assignedNumber: business.assignedNumber,
    pendingNumber: !business.assignedNumber,
    businessName: business.billingName,
    ownerPhone: business.phoneNumber,
    carrier: business.carrier,
  });
}