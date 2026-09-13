import { NextResponse } from "next/server";
import {
  createBusiness,
  getBusinessByPhone,
  updateBusiness,
} from "@/lib/db";
import { getPlivoConfig, isPlivoConfigured } from "@/lib/plivo";
import { isValidPhone } from "@/lib/util";
import { applyCors, corsPreflightResponse, handlePreflight } from "@/lib/cors";

export async function OPTIONS(request: Request) {
  return corsPreflightResponse(request);
}

// Simplified onboarding: the owner enables call forwarding through their
// phone's own settings menu. No MMI codes, no automatic verification call.
// They confirm manually via /api/onboarding/complete.
export async function POST(request: Request) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  try {
    const body = await request.json();
    const phoneNumber = (body.phone_number || "").trim();
    const phoneType = body.phone_type === "android" ? "android" : "iphone";

    if (!isValidPhone(phoneNumber)) {
      return applyCors(
        NextResponse.json(
          { error: "Phone number must be at least 10 digits" },
          { status: 400 }
        ),
        request
      );
    }

    if (!isPlivoConfigured()) {
      return applyCors(
        NextResponse.json(
          { error: "Plivo is not configured. Set PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, and PLIVO_NUMBER in .env.local." },
          { status: 400 }
        ),
        request
      );
    }

    const { number: plivoNumber } = getPlivoConfig();

    let business = await getBusinessByPhone(phoneNumber);
    if (business) {
      business =
        (await updateBusiness(business.id, { forwardingStatus: "pending" })) ??
        business;
    } else {
      business = await createBusiness({
        phoneNumber,
        carrier: "other",
        forwardingStatus: "pending",
        lastVerifiedAt: null,
        pendingVerificationFor: null,
        pendingVerificationExpiresAt: null,
      });
    }

    return applyCors(
      NextResponse.json({
        success: true,
        businessId: business.id,
        phone_number: phoneNumber,
        phone_type: phoneType,
        carrier: "other",
        plivo_number: plivoNumber,
        forwarding_status: "pending",
      }),
      request
    );
  } catch (error) {
    return applyCors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to start onboarding" },
        { status: 500 }
      ),
      request
    );
  }
}
