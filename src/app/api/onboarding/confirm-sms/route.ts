import { NextResponse } from "next/server";
import {
  checkSmsVerificationCode,
  getBusinessById,
  getBusinessByPhone,
  setBusinessForwardingStatus,
} from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { applyCors, corsPreflightResponse, handlePreflight } from "@/lib/cors";

export async function OPTIONS(request: Request) {
  return corsPreflightResponse(request);
}

/**
 * Phase 5 — confirm the SMS verification code. On success the code is consumed
 * (single-use) and the business is marked forwarding-active with a verified
 * timestamp.
 */
export async function POST(request: Request) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  try {
    const body = await request.json();
    const businessId = (body.businessId || body.business_id || "").trim();
    const phone = (body.phone_number || "").trim();
    const code = (body.code || "").trim();

    if (!/^\d{6}$/.test(code)) {
      return applyCors(
        NextResponse.json(
          { error: "Enter the 6-digit code you received by SMS." },
          { status: 400 }
        ),
        request
      );
    }

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

    // The code is single-use with a 10-minute expiry, but guessing is still a
    // thing — cap verification attempts per business and per client IP.
    const businessLimit = rateLimit(`confirm-sms:${business.id}`, 10, 15 * 60 * 1000);
    const ipLimit = rateLimit(`confirm-sms:ip:${clientIp(request)}`, 20, 15 * 60 * 1000);
    const limit = businessLimit.allowed ? ipLimit : businessLimit;
    if (!limit.allowed) {
      return applyCors(
        NextResponse.json(
          { error: "Too many verification attempts. Request a new code in a few minutes." },
          { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
        ),
        request
      );
    }

    const valid = await checkSmsVerificationCode(business.id, code);
    if (!valid) {
      return applyCors(
        NextResponse.json(
          { error: "That code is invalid or has expired. Request a new one." },
          { status: 400 }
        ),
        request
      );
    }

    const verifiedAt = new Date().toISOString();
    await setBusinessForwardingStatus(business.id, "active", verifiedAt);

    return applyCors(
      NextResponse.json({
        success: true,
        businessId: business.id,
        phone_number: business.phoneNumber,
        forwarding_status: "active",
        verified_at: verifiedAt,
      }),
      request
    );
  } catch (error) {
    return applyCors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to confirm verification" },
        { status: 500 }
      ),
      request
    );
  }
}
