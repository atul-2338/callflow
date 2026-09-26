import { NextResponse } from "next/server";
import { getBusinessById, setBusinessForwardingStatus } from "@/lib/db";
import { verifyPlivoSignature } from "@/lib/plivo";
import { lamlResponse, escapeXml } from "@/lib/laml";

export const runtime = "nodejs";

/**
 * Plivo answer URL for the silent test-call verification (Phase 5).
 *
 * When the owner answers the verification call, Plivo POSTs the call details
 * here (form-encoded) with `?businessId=...` on the URL. A valid
 * X-Plivo-Signature-V2 proves the request really came from Plivo, so the
 * business is marked verified and the call plays a short confirmation before
 * hanging up. The owner never has to press anything.
 *
 * The signature covers the full URL + nonce + sorted body params, so the
 * businessId query param is part of what is verified.
 */
export async function POST(request: Request) {
  const bodyText = await request.text();
  const params = Object.fromEntries(new URLSearchParams(bodyText));

  const verified = verifyPlivoSignature({
    url: request.url,
    signature: request.headers.get("x-plivo-signature-v2"),
    nonce: request.headers.get("x-plivo-signature-v2-nonce"),
    params,
  });

  if (!verified) {
    console.warn("[plivo-answer] rejected request with an invalid signature");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const businessId = new URL(request.url).searchParams.get("businessId");
  const business = businessId ? await getBusinessById(businessId) : undefined;

  if (!business) {
    console.warn("[plivo-answer] no business for verification call", { businessId });
    return lamlResponse(
      "<Say>Sorry, this verification link is no longer valid.</Say><Hangup/>"
    );
  }

  const verifiedAt = new Date().toISOString();
  await setBusinessForwardingStatus(business.id, "active", verifiedAt);
  console.info("[plivo-answer] business verified by test call", {
    businessId: business.id,
    caller: params.From || null,
  });

  const message = `This is CallFlow. Your call forwarding is verified. You're all set. Goodbye.`;
  return lamlResponse(`<Say>${escapeXml(message)}</Say><Hangup/>`);
}

/** Plivo may also GET the answer URL depending on the answer_method used. */
export async function GET(request: Request) {
  const businessId = new URL(request.url).searchParams.get("businessId");
  const business = businessId ? await getBusinessById(businessId) : undefined;
  if (business) {
    await setBusinessForwardingStatus(business.id, "active", new Date().toISOString());
  }
  return lamlResponse("<Hangup/>");
}
