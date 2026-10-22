import { NextResponse } from "next/server";
import {
  getBusinessById,
  getBusinessByPhone,
  setBusinessForwardingStatus,
} from "@/lib/db";
import { applyCors, corsPreflightResponse, handlePreflight } from "@/lib/cors";
import { clientIp, rateLimit } from "@/lib/rate-limit";

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

    // Manual "I've set it up" confirmation is intentionally owner-attested
    // (the signed test call is the verified path), but still rate-limit it so
    // it can't be hammered from one IP.
    const limit = rateLimit(
      `onboard-complete:${business.id}:${clientIp(request)}`,
      10,
      60 * 60 * 1000
    );
    if (!limit.allowed) {
      return applyCors(
        NextResponse.json(
          { error: "Too many attempts. Try again later." },
          { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
        ),
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
