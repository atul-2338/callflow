import { NextResponse } from "next/server";
import {
  businessSessionCookie,
  createBusinessSessionToken,
} from "@/lib/business-session";
import {
  BUSINESS_NAME_TAKEN_ERROR,
  BusinessNameTakenError,
  createBillingSignup,
  describeBillingAccess,
  trialEndsAt,
} from "@/lib/billing";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createSignupHandoffToken, signupHandoffCookie } from "@/lib/signup-handoff";

export const runtime = "nodejs";

/**
 * Kick off trial signup and hand the browser a fresh Dodo hosted-checkout URL.
 *
 * A full session cookie is set here — for NEWLY CREATED businesses only — so
 * the return page can identify the business and poll `/api/me`. For an
 * existing business the phone number alone does not prove ownership, so no
 * session is minted (`sessionIssued: false`); instead the browser gets a
 * short-lived checkout-bound handoff cookie that only lets
 * `/api/billing/confirm` report the trusted billing state for the checkout
 * session this request just created, and converts into a real session there
 * only after the signature-verified webhook links the subscription. An
 * already-subscribed business gets neither — nothing about its session may
 * depend on knowing the phone number.
 */
export async function POST(request: Request) {
  // Abuse guard: paid checkouts and Dodo customer records cost money, and the
  // signup endpoint also decides whether to mint a session cookie. Cap it per
  // client IP and per phone number.
  const ipLimit = rateLimit(`signup:ip:${clientIp(request)}`, 10, 60 * 60 * 1000);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const readString = (key: string) =>
    typeof body[key] === "string" ? (body[key] as string) : "";
  const phoneNumber = readString("phoneNumber");
  const phoneLimit = rateLimit(
    `signup:phone:${phoneNumber.replace(/\D/g, "") || "invalid"}`,
    5,
    60 * 60 * 1000
  );
  if (!phoneLimit.allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts for this number. Try again later." },
      { status: 429, headers: { "Retry-After": String(phoneLimit.retryAfterSeconds) } }
    );
  }

  try {
    const { business, checkoutUrl, checkoutSessionId, alreadySubscribed, created } =
      await createBillingSignup({
        phoneNumber,
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
        sessionIssued: created,
      },
      { status: 201 }
    );
    const secure =
      process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
    if (created) {
      response.headers.append(
        "Set-Cookie",
        businessSessionCookie(createBusinessSessionToken(business.id), secure)
      );
    } else if (!alreadySubscribed && checkoutSessionId) {
      // Existing business (pre-created earlier in /setup, or a returning
      // owner): the phone number alone still proves nothing, so no session is
      // minted. Instead hand out a short-lived cookie bound to the exact
      // checkout session just created; /api/billing/confirm accepts it to
      // report the trusted billing state and — only once the signature-
      // verified webhook links a subscription — converts it into a real
      // session. See src/lib/signup-handoff.ts.
      response.headers.append(
        "Set-Cookie",
        signupHandoffCookie(createSignupHandoffToken(business.id, checkoutSessionId), secure)
      );
    }
    return response;
  } catch (error) {
    if (error instanceof BusinessNameTakenError) {
      // A different business already owns this name. A structured 400 — not
      // the generic validation/502 mapping below — so both UIs can route the
      // message under the "Your name" input instead of the card-level error.
      console.warn("[dodo-billing] signup rejected: business name already taken");
      return NextResponse.json(
        { error: BUSINESS_NAME_TAKEN_ERROR, code: "business_name_taken" },
        { status: 400 }
      );
    }
    console.error("[dodo-billing] signup failed", error);
    const message = error instanceof Error ? error.message : "Unable to start billing.";
    const status = /must be configured|Provide a business|must be an|did not return|phone number must be/.test(message)
      ? 400
      : 502;
    return NextResponse.json({ error: message }, { status });
  }
}