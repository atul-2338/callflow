import { NextResponse } from "next/server";
import {
  getBusinessById,
  getBusinessByPhone,
  setPendingVerification,
} from "@/lib/db";
import { getPlivoConfig, getPublicBaseUrl, isPlivoConfigured } from "@/lib/plivo";
import { placeVerificationCall } from "@/lib/plivo";
import { applyCors, corsPreflightResponse, handlePreflight } from "@/lib/cors";

export async function OPTIONS(request: Request) {
  return corsPreflightResponse(request);
}

/**
 * Phase 5 — silent test-call verification. CallFlow places a call to the
 * business owner's number; when they answer, Plivo hits the answer URL
 * (/api/plivo/answer?businessId=...) which marks the business verified. The
 * owner does nothing but pick up — no code to type, no MMI string.
 */
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

    if (!isPlivoConfigured()) {
      return applyCors(
        NextResponse.json(
          {
            error:
              "Plivo is not configured. Set PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, and PLIVO_NUMBER in .env.local.",
          },
          { status: 400 }
        ),
        request
      );
    }

    const baseUrl = getPublicBaseUrl();
    if (!baseUrl) {
      return applyCors(
        NextResponse.json(
          {
            error:
              "PUBLIC_BASE_URL is not set. Plivo must be able to reach the answer URL, so it cannot be localhost.",
          },
          { status: 400 }
        ),
        request
      );
    }

    const answerUrl = `${baseUrl}/api/plivo/answer?businessId=${encodeURIComponent(business.id)}`;
    const result = await placeVerificationCall(business.phoneNumber, answerUrl);

    if (!result.ok) {
      return applyCors(
        NextResponse.json(
          { error: result.error || "Failed to place the verification call." },
          { status: 502 }
        ),
        request
      );
    }

    // Give the owner a window to answer; the answer URL flips the status.
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await setPendingVerification(business.id, business.phoneNumber, expiresAt);

    return applyCors(
      NextResponse.json({
        success: true,
        businessId: business.id,
        requestUuid: result.requestUuid,
        plivoNumber: getPlivoConfig().number,
        expiresAt,
        message:
          "We're calling you now — answer and hang up. That's the whole test.",
      }),
      request
    );
  } catch (error) {
    return applyCors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to start verification" },
        { status: 500 }
      ),
      request
    );
  }
}
