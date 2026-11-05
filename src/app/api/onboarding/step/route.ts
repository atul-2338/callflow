import { NextResponse } from "next/server";

import { businessIdFromCookieHeader } from "@/lib/business-session";
import { getBusinessById, updateBusiness } from "@/lib/db";
import { assignNumber } from "@/lib/numbers-pool";

export const runtime = "nodejs";

/**
 * POST /api/onboarding/step — advance the linear onboarding flow one step.
 * Only the exact next transition is allowed (no skipping, no going back):
 *   '2' → '3' (requires an assigned number), '3' → '4', '4' → 'done' (the
 * "Skip — I'll test later" link). Step '2' is reached only through
 * /api/onboarding/start (which assigns the number) and 'done' is also set by
 * the Dograh webhook on the business's first attributed call.
 *
 * Leaving step 2 is the last automatic chance to get a number: if the business
 * still has none (pool was empty at signup and has since been restocked), this
 * route assigns one before it allows the forwarding step. An empty pool is
 * answered as `pending: true` with the step unchanged — the page keeps showing
 * "Your number is being prepared", never an error.
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
    // Last automatic chance to get a number: the pool may have been restocked
    // since signup (or the webhook never ran). assignNumber is atomic and
    // idempotent, so clicking twice cannot double-assign.
    const assignment = await assignNumber(businessId, business.phoneNumber);
    if (!assignment.assignedNumber) {
      // Pool still empty — NOT an error page: stay on step 2, which shows
      // "Your number is being prepared, we'll email you".
      return NextResponse.json({
        onboardingStep: business.onboardingStep,
        assignedNumber: null,
        pending: true,
      });
    }
  }

  const updated = await updateBusiness(businessId, { onboardingStep: next });
  const assignedNumber =
    (await getBusinessById(businessId))?.assignedNumber ?? business.assignedNumber;
  return NextResponse.json({
    onboardingStep: updated?.onboardingStep ?? next,
    assignedNumber,
    pending: false,
  });
}