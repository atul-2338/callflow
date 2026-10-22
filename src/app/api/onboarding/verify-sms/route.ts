import { NextResponse } from "next/server";
import { getBusinessById, getBusinessByPhone, setSmsVerificationCode } from "@/lib/db";
import { generateVerificationCode, isSmsConfigured, sendSms } from "@/lib/sms";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { applyCors, corsPreflightResponse, handlePreflight } from "@/lib/cors";

export async function OPTIONS(request: Request) {
  return corsPreflightResponse(request);
}

/**
 * Phase 5 — SMS forwarding verification. Sends a 6-digit code to the business
 * owner's number via Plivo. The code is stored on the business row with a
 * 10-minute expiry and consumed by /api/onboarding/confirm-sms.
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

    // Paid SMS — cap per business and per client IP.
    const businessLimit = rateLimit(`verify-sms:${business.id}`, 3, 15 * 60 * 1000);
    const ipLimit = rateLimit(`verify-sms:ip:${clientIp(request)}`, 10, 15 * 60 * 1000);
    const limit = businessLimit.allowed ? ipLimit : businessLimit;
    if (!limit.allowed) {
      return applyCors(
        NextResponse.json(
          { error: "Too many verification codes sent. Try again in a few minutes." },
          { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
        ),
        request
      );
    }

    if (!isSmsConfigured()) {
      return applyCors(
        NextResponse.json(
          {
            error:
              "SMS is not configured. Set PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, and PLIVO_NUMBER in .env.local.",
          },
          { status: 400 }
        ),
        request
      );
    }

    const code = generateVerificationCode();
    await setSmsVerificationCode(business.id, code);

    const result = await sendSms(
      business.phoneNumber,
      `Your CallFlow verification code is ${code}. It expires in 10 minutes.`
    );

    if (!result.ok) {
      return applyCors(
        NextResponse.json(
          { error: result.error || "Failed to send the verification SMS." },
          { status: 502 }
        ),
        request
      );
    }

    return applyCors(
      NextResponse.json({
        success: true,
        businessId: business.id,
        messageUuid: result.messageUuid,
        message: "Verification code sent by SMS.",
      }),
      request
    );
  } catch (error) {
    return applyCors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to send verification SMS" },
        { status: 500 }
      ),
      request
    );
  }
}
