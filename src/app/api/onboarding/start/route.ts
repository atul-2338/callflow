import { NextResponse } from "next/server";

import { businessIdFromCookieHeader } from "@/lib/business-session";
import { getBusinessById, updateBusiness } from "@/lib/db";
import { assignNumber } from "@/lib/numbers-pool";
import { normalizeOwnerPhone } from "@/lib/phone";
import { CARRIERS, type Carrier } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Step 1 of the linear /onboarding flow: save the business info and assign
 * the business's ONE CallFlow number from the pool.
 *
 * Requires a signed-in business session (the owner's cookie). The owner's
 * phone is normalized leniently ("(928) 331-9394" works) and stored as the
 * canonical E.164 in businesses.phoneNumber — it is only used for the
 * forwarding-instruction area-code preference and admin display, never for
 * call routing. assignNumber is idempotent: a business that already has a
 * number keeps it, and an empty pool answers `pending: true` (the UI shows
 * "your number is being prepared") without crashing.
 */
export async function POST(request: Request) {
  const businessId = businessIdFromCookieHeader(request.headers.get("cookie"));
  if (!businessId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const ownerPhoneRaw =
    typeof body.ownerPhone === "string" ? body.ownerPhone : "";
  const carrier = typeof body.carrier === "string" ? body.carrier : "";

  if (!name) {
    return NextResponse.json(
      { error: "Business name is required." },
      { status: 400 }
    );
  }
  const ownerPhone = normalizeOwnerPhone(ownerPhoneRaw);
  if (!ownerPhone) {
    return NextResponse.json(
      { error: "Enter a valid phone number (e.g. +1 555 123 4567)." },
      { status: 400 }
    );
  }
  if (!CARRIERS.includes(carrier as Carrier)) {
    return NextResponse.json({ error: "Select your carrier." }, { status: 400 });
  }

  const business = await getBusinessById(businessId);
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  // Row first, then the pool: a failed pool read leaves the info saved and
  // the business still pending a number, so a retry can never double-assign.
  const updated = await updateBusiness(businessId, {
    billingName: name,
    phoneNumber: ownerPhone,
    carrier: carrier as Carrier,
    ...(business.onboardingStep === "1" ? { onboardingStep: "2" } : {}),
  });

  const assignment = await assignNumber(businessId, ownerPhone);

  return NextResponse.json({
    assignedNumber: assignment.assignedNumber,
    pending: assignment.pending,
    onboardingStep: updated?.onboardingStep ?? business.onboardingStep,
  });
}