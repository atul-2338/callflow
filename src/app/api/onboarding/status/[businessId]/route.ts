import { NextResponse } from "next/server";
import {
  getBusinessById,
  setBusinessForwardingStatus,
} from "@/lib/db";
import { applyCors, corsPreflightResponse, handlePreflight } from "@/lib/cors";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function OPTIONS(request: Request) {
  return corsPreflightResponse(request);
}

export async function GET(request: Request, context: RouteContext) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  try {
    const { businessId } = await context.params;
    const business = await getBusinessById(businessId);

    if (!business) {
      return applyCors(
        NextResponse.json({ error: "Business not found" }, { status: 404 }),
        request
      );
    }

    // Lazily expire a pending verification whose window has elapsed.
    if (
      business.forwardingStatus === "pending" &&
      business.pendingVerificationExpiresAt &&
      new Date() > new Date(business.pendingVerificationExpiresAt)
    ) {
      const updated = await setBusinessForwardingStatus(business.id, "failed");
      if (updated) business.forwardingStatus = updated.forwardingStatus;
    }

    return applyCors(
      NextResponse.json({
        businessId: business.id,
        phone_number: business.phoneNumber,
        carrier: business.carrier,
        forwarding_status: business.forwardingStatus,
        last_verified_at: business.lastVerifiedAt,
      }),
      request
    );
  } catch (error) {
    return applyCors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to fetch status" },
        { status: 500 }
      ),
      request
    );
  }
}
