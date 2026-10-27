import { NextResponse } from "next/server";

import { businessIdFromCookieHeader } from "@/lib/business-session";
import { getBusinessById, updateBusiness } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST /api/onboarding/step — advance the linear onboarding flow one step.
 * Only the exact next transition is allowed (no skipping, no going back):
 *   '2' → '3' (requires an assigned number), '3' → '4', '4' → 'done' (the
 * "Skip — I'll test later" link). Step '2' is reached only through
 * /api/onboarding/start (which assigns the number) and 'done' is also set by
 * the Dograh webhook on the business's first attributed call.
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

  const next = typeof body.step === "string" ? body.step : "";
  const business = await getBusinessById(businessId);
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const current = business.onboardingStep;
  const allowed: Record<string, string> = { "2": "3", "3": "4", "4": "done" };
  if (allowed[current] !== next) {
    return NextResponse.json(
      { error: `Cannot move from step ${current} to ${next || "(none)"}.` },
      { status: 400 }
    );
  }
  if (next === "3" && !business.assignedNumber) {
    return NextResponse.json(
      { error: "No CallFlow number assigned yet." },
      { status: 400 }
    );
  }

  const updated = await updateBusiness(businessId, { onboardingStep: next });
  return NextResponse.json({ onboardingStep: updated?.onboardingStep ?? next });
}