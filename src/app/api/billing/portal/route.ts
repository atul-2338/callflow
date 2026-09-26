import { NextResponse } from "next/server";
import { businessIdFromCookieHeader } from "@/lib/business-session";
import { createBillingPortalLink } from "@/lib/billing";
import { getBusinessById } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Open a Dodo customer-portal session for the signed-in business: a hosted page
 * where they update the card, download invoices, or cancel. Callflow never sees
 * or stores card data, and cancellation stays Dodo's record — the resulting
 * `subscription.cancelled` webhook is what flips us to a lapsed state.
 */
export async function POST(request: Request) {
  const businessId = businessIdFromCookieHeader(request.headers.get("cookie"));
  if (!businessId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const business = await getBusinessById(businessId);
  if (!business) {
    return NextResponse.json({ error: "Billing profile not found" }, { status: 404 });
  }
  if (!business.dodoCustomerId) {
    return NextResponse.json(
      { error: "Start your trial first — there is no billing profile yet." },
      { status: 409 }
    );
  }

  try {
    const link = await createBillingPortalLink(business);
    return NextResponse.json({ link });
  } catch (error) {
    console.error("[dodo-billing] portal link failed", error);
    const message = error instanceof Error ? error.message : "Unable to open billing.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}