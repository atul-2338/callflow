import { NextResponse } from "next/server";
import {
  businessSessionCookie,
  createBusinessSessionToken,
} from "@/lib/business-session";
import { createBillingSignup, describeBillingAccess, trialEndsAt } from "@/lib/billing";

export const runtime = "nodejs";

/**
 * Kick off trial signup and hand the browser a fresh Dodo hosted-checkout URL.
 *
 * The session cookie is set here, before the customer leaves for Dodo, so the
 * return page can identify the business and poll `/api/me`.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const readString = (key: string) =>
    typeof body[key] === "string" ? (body[key] as string) : "";

  try {
    const { business, checkoutUrl, checkoutSessionId, alreadySubscribed } =
      await createBillingSignup({
        phoneNumber: readString("phoneNumber"),
        name: readString("name"),
        email: readString("email"),
        country: readString("country"),
      });

    const response = NextResponse.json(
      {
        businessId: business.id,
        subscriptionStatus: business.subscriptionStatus,
        access: describeBillingAccess(business),
        trialStartedAt: business.trialStartedAt,
        trialEndsAt: business.trialStartedAt ? trialEndsAt(business.trialStartedAt) : null,
        checkoutUrl,
        checkoutSessionId,
        alreadySubscribed,
      },
      { status: 201 }
    );
    response.headers.append(
      "Set-Cookie",
      businessSessionCookie(
        createBusinessSessionToken(business.id),
        process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:"
      )
    );
    return response;
  } catch (error) {
    console.error("[dodo-billing] signup failed", error);
    const message = error instanceof Error ? error.message : "Unable to start billing.";
    const status = /must be configured|Provide a business|must be an|did not return|phone number must be/.test(message)
      ? 400
      : 502;
    return NextResponse.json({ error: message }, { status });
  }
}