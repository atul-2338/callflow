import { NextResponse } from "next/server";
import {
  getBusinessById,
  getBusinessByPhone,
  setBusinessForwardingStatus,
} from "@/lib/db";
import { applyCors, corsPreflightResponse, handlePreflight } from "@/lib/cors";

export async function OPTIONS(request: Request) {
  return corsPreflightResponse(request);
}

// Marks a business as onboarded after the owner confirms they enabled call
// forwarding through their phone's settings menu ("I've set it up").
export async function POST(request: Request) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  try {
    const body = await request.json();
    const businessId = (body.businessId || body.business_id || "").trim();
    const phone = (body.phone_number || "").trim();

    const business = businessId
      ? await getBusinessById(businessId)
      : phone
        ? await getBusinessByPhone(phone)
        : undefined;

    if (!business) {
      return applyCors(
        NextResponse.json({ error: "Business not found" }, { status: 404 }),
        request
      );
    }

    const savedAt = new Date().toISOString();
    await setBusinessForwardingStatus(business.id, "active", savedAt);

    return applyCors(
      NextResponse.json({
        success: true,
        businessId: business.id,
        phone_number: business.phoneNumber,
        forwarding_status: "active",
        saved_at: savedAt,
      }),
      request
    );
  } catch (error) {
    return applyCors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to complete onboarding" },
        { status: 500 }
      ),
      request
    );
  }
}
