import { NextResponse } from "next/server";
import {
  createBusiness,
  getBusinessByPhone,
  updateBusiness,
} from "@/lib/db";
import { getPlivoConfig } from "@/lib/plivo";
import { isValidPhone } from "@/lib/util";
import { CARRIERS, type Carrier } from "@/lib/types";
import { applyCors, corsPreflightResponse, handlePreflight } from "@/lib/cors";

export async function OPTIONS(request: Request) {
  return corsPreflightResponse(request);
}

// Self-serve onboarding: the owner enables call forwarding through their
// phone's own settings menu. No MMI codes. Verification is explicit and
// separate: a silent test call (/api/onboarding/verify) or an SMS code
// (/api/onboarding/verify-sms + /api/onboarding/confirm-sms).
export async function POST(request: Request) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  try {
    const body = await request.json();
    const phoneNumber = (body.phone_number || "").trim();
    const phoneType = body.phone_type === "android" ? "android" : "iphone";
    const carrier = (body.carrier || "other").trim() as Carrier;

    if (!isValidPhone(phoneNumber)) {
      return applyCors(
        NextResponse.json(
          { error: "Phone number must be at least 10 digits" },
          { status: 400 }
        ),
        request
      );
    }

    if (!(CARRIERS as readonly string[]).includes(carrier)) {
      return applyCors(
        NextResponse.json(
          { error: `Unknown carrier: ${carrier}` },
          { status: 400 }
        ),
        request
      );
    }

    let business = await getBusinessByPhone(phoneNumber);
    if (business) {
      business =
        (await updateBusiness(business.id, {
          carrier,
          forwardingStatus: "pending",
        })) ?? business;
    } else {
      business = await createBusiness({
        phoneNumber,
        carrier,
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
        carrier,
        plivo_number: getPlivoConfig().number,
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
