import { NextResponse } from "next/server";
import {
  businessIdFromCookieHeader,
  businessSessionCookie,
  createBusinessSessionToken,
} from "@/lib/business-session";
import {
  describeBillingAccess,
  isTrialExpired,
  reconcileDodoCheckout,
  resolveBusinessByDodoSubscription,
  trialEndsAt,
} from "@/lib/billing";
import { getBusinessByCheckoutSessionId, getBusinessById } from "@/lib/db";
import { assignNumber } from "@/lib/numbers-pool";
import {
  clearSignupHandoffCookie,
  signupHandoffFromCookieHeader,
  verifyCheckoutReturnToken,
  type SignupHandoff,
} from "@/lib/signup-handoff";
import type { Business } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Don't call Dodo's API more than once per business per cooldown, however fast
 * the return page polls. In-memory (one Next.js process), reset on deploy —
 * being a bit generous after a restart costs nothing.
 */
const RECONCILE_COOLDOWN_MS = 4000;
const lastReconcileAt = new Map<string, number>();

/**
 * The checkout return page's verification endpoint.
 *
 * Returns the same trusted billing state as `/api/me` — what the
 * signature-verified webhook has written — and, while a checkout is still
 * unconfirmed, additionally asks Dodo's API directly for the subscription's
 * current status and applies it through the same webhook write path. That keeps
 * the success screen honest (the redirect's `?status=` can never grant
 * anything) while making the wait converge even when Dodo's webhook delivery
 * lags behind the browser redirect.
 */
/**
 * Optional JSON body posted by the return page:
 *
 *   - `checkoutSessionId`: Dodo's redirect `session_id`. It double-checks
 *     whichever identity proof the request carries, and on its own still backs
 *     the legacy cookie-less lookup below.
 *   - `trialId`: the signed `trial_id` from the return URL — the transport that
 *     survives browsers dropping our cookies on the cross-site trip back.
 *   - `subscriptionId`: Dodo's redirect `subscription_id`. Dodo sends this (not
 *     `session_id`) once the checkout has produced a subscription, so it is the
 *     proof that survives both a cookie-less browser and a rewritten return URL;
 *     it is only believed after Dodo's own API confirms the customer.
 *
 * A missing or malformed body is not an error; such a request is simply
 * unauthenticated unless it carries a session cookie.
 */
async function readConfirmBody(
  request: Request
): Promise<{
  checkoutSessionId: string | null;
  trialId: string | null;
  subscriptionId: string | null;
}> {
  try {
    const body = (await request.json()) as {
      checkoutSessionId?: unknown;
      trialId?: unknown;
      subscriptionId?: unknown;
    } | null;
    return {
      checkoutSessionId:
        typeof body?.checkoutSessionId === "string" && body.checkoutSessionId
          ? body.checkoutSessionId
          : null,
      trialId: typeof body?.trialId === "string" && body.trialId ? body.trialId : null,
      subscriptionId:
        typeof body?.subscriptionId === "string" && body.subscriptionId
          ? body.subscriptionId
          : null,
    };
  } catch {
    return { checkoutSessionId: null, trialId: null, subscriptionId: null };
  }
}

export async function POST(request: Request) {
  const body = await readConfirmBody(request);
  const cookieHeader = request.headers.get("cookie");
  const cookieBusinessId = businessIdFromCookieHeader(cookieHeader);

  // Four proofs, in order of strength:
  //  1. the full business session cookie (the owner already has a session),
  //  2. the checkout-bound signup handoff cookie minted by /api/billing/signup
  //     for an existing business (a row pre-created by /setup, or a returning
  //     owner re-running the wizard). It is bound to the exact checkout
  //     session this server created, so knowing the phone number alone still
  //     opens nothing,
  //  3. the signed `trial_id` on the return URL — the same identity as (2) but
  //     carried where a browser cannot drop it on the cross-site trip back
  //     from Dodo ("the trial session cookie isn't in this browser"),
  //  4. Dodo's own redirect `subscription_id`, resolved through Dodo's
  //     authenticated API (subscription metadata → business, cross-checked
  //     against the subscription's customer). This is the transport Dodo
  //     actually uses: its success redirect carries `subscription_id`,
  //     `payment_id` and `status`, never our `trial_id` or `session_id`.
  // Any of (2)-(4) becomes a session below only after the webhook has linked a
  // subscription.
  //
  // A session cookie can also name a row that no longer exists (a business
  // deleted or reset on this database). That is not fatal — it must not turn
  // the owner's return page into a 404 — so it falls through to (2)-(4).
  let handoff: SignupHandoff | null = null;
  let returnTokenBusinessId: string | null = null;
  let subscriptionBusiness: Business | null = null;

  let business = cookieBusinessId ? await getBusinessById(cookieBusinessId) : null;
  if (cookieBusinessId && !business) {
    console.warn("[billing-confirm] session cookie names a missing business — falling back", {
      businessId: cookieBusinessId,
    });
  }

  if (!business) {
    handoff = signupHandoffFromCookieHeader(cookieHeader);
    if (!handoff && body.trialId) {
      returnTokenBusinessId = verifyCheckoutReturnToken(body.trialId);
    }
    // Legacy fallback: look up business by checkout session id from body
    if (!handoff && !returnTokenBusinessId && body.checkoutSessionId) {
      const found = await getBusinessByCheckoutSessionId(body.checkoutSessionId);
      if (found) {
        // Treat as handoff with the session id we just verified from DB
        handoff = { businessId: found.id, checkoutSessionId: body.checkoutSessionId };
      }
    }
    if (!handoff && !returnTokenBusinessId && body.subscriptionId) {
      subscriptionBusiness = await resolveBusinessByDodoSubscription(body.subscriptionId);
    }

    const proofBusinessId =
      handoff?.businessId ?? returnTokenBusinessId ?? subscriptionBusiness?.id ?? null;
    if (!proofBusinessId) {
      // Booleans only: enough to tell "the browser dropped our cookies" from
      // "Dodo rewrote the return URL" from "the subscription is not ours".
      // Never the tokens, cookie values, keys or secrets themselves.
      console.warn("[billing-confirm] no verifiable checkout identity — returning 401", {
        hasSessionCookie: !!cookieBusinessId,
        hasHandoff: !!handoff,
        trialIdPresent: !!body.trialId,
        trialIdValid: !!returnTokenBusinessId,
        subscriptionIdPresent: !!body.subscriptionId,
        businessId: cookieBusinessId,
        checkoutSessionId: body.checkoutSessionId,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    business = subscriptionBusiness ?? (await getBusinessById(proofBusinessId));
    if (!business) {
      console.warn("[billing-confirm] identity proved but business row is missing — returning 404", {
        hasSessionCookie: !!cookieBusinessId,
        hasHandoff: !!handoff,
        trialIdPresent: !!body.trialId,
        trialIdValid: !!returnTokenBusinessId,
        subscriptionIdPresent: !!body.subscriptionId,
        businessId: proofBusinessId,
        checkoutSessionId: body.checkoutSessionId,
      });
      return NextResponse.json({ error: "Billing profile not found" }, { status: 404 });
    }
  }

  const tokenBusinessId = business.id;

  if (handoff) {
    // The handoff must still name the checkout session currently stored on
    // the business row (a newer signup overwrites that id and invalidates
    // older handoffs), and if the browser brought Dodo's redirect
    // `session_id` along it must agree with the cookie. Anything else is 401.
    if (handoff.checkoutSessionId !== business.dodoCheckoutSessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (body.checkoutSessionId && body.checkoutSessionId !== handoff.checkoutSessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (returnTokenBusinessId) {
    // The URL token names the business but not the checkout — the return URL is
    // fixed before Dodo issues `session_id` — so it only stands while this
    // business has a checkout outstanding, and the redirect's own `session_id`
    // (when the browser brought one) must match the id we recorded.
    if (!business.dodoCheckoutSessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (body.checkoutSessionId && body.checkoutSessionId !== business.dodoCheckoutSessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Reconcile only while the checkout is genuinely unconfirmed. Once a webhook
  // has delivered a live Dodo status (active, past_due, on_hold, cancelled, …)
  // the webhook is proven alive and Dodo is never queried here again. `pending`
  // is included because our own earlier reconcile (or Dodo itself) may have
  // linked a subscription that is still processing — later polls must keep
  // asking until it turns active or dies.
  const UNCONFIRMED_STATUSES = new Set(["not_started", "pending_checkout", "pending"]);
  const awaitingConfirmation =
    !!business.dodoCustomerId && UNCONFIRMED_STATUSES.has(business.subscriptionStatus);

  if (awaitingConfirmation) {
    const now = Date.now();
    const last = lastReconcileAt.get(tokenBusinessId) ?? 0;
    if (now - last >= RECONCILE_COOLDOWN_MS) {
      lastReconcileAt.set(tokenBusinessId, now);
      business = await reconcileDodoCheckout(business);
    }
  }

  const access = describeBillingAccess(business);

  // The checkout return is the second place a paid signup becomes known: Dodo's
  // webhook can lag or be lost (which is exactly why we reconcile above), and a
  // business with no number used to need a manual assignment. Only a genuinely
  // active subscription counts, and assignNumber is atomic + idempotent, so
  // repeated polling is free and two visitors can never share a number.
  if (
    !business.assignedNumber &&
    business.dodoSubscriptionId &&
    business.subscriptionStatus === "active"
  ) {
    const assignment = await assignNumber(business.id, business.phoneNumber);
    if (assignment.assignedNumber) {
      console.info("[billing-confirm] number auto-assigned", {
        businessId: business.id,
        assignedNumber: assignment.assignedNumber,
      });
    }
  }
  const response = NextResponse.json({
    businessId: business.id,
    subscriptionStatus: business.subscriptionStatus,
    subscriptionId: business.dodoSubscriptionId,
    trialStartedAt: business.trialStartedAt,
    trialEndsAt: business.trialStartedAt ? trialEndsAt(business.trialStartedAt) : null,
    trialExpired: business.trialStartedAt ? isTrialExpired(business.trialStartedAt) : false,
    access,
    hasSubscription: !!business.dodoSubscriptionId,
    checkoutSessionId: business.dodoCheckoutSessionId,
  });

  if ((handoff || returnTokenBusinessId || subscriptionBusiness) && business.dodoSubscriptionId) {
    // The signature-verified webhook write path has linked a subscription to
    // the business this identity was issued for: checkout completion is now
    // proven, so hand the browser the real session and retire the handoff.
    const secure =
      process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
    response.headers.append(
      "Set-Cookie",
      businessSessionCookie(createBusinessSessionToken(business.id), secure)
    );
    response.headers.append("Set-Cookie", clearSignupHandoffCookie(secure));
  }
  return response;
}