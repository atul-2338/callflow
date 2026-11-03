import { NextResponse } from "next/server";

import { describeBillingAccess } from "@/lib/billing";
import { setBusinessForwardingStatus, updateBusiness } from "@/lib/db";
import { matchDograhBusiness } from "@/lib/dograh-webhook";
import { readSmtpConfig, sendOperatorAlertEmail } from "@/lib/email";
import {
  getTelnyxConfig,
  parseTelnyxEvent,
  speakToCaller,
  transferCall,
  verifyTelnyxSignature,
} from "@/lib/telnyx";
import type { Business } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Telnyx Call Control webhook URL for inbound calls.
 *
 * Configure in Mission Control → Connections (the Call Control App behind the
 * forwarding number):
 *   Webhook URL:  https://<your-host>/api/v1/telephony/telnyx/answer
 *
 * When a call arrives on the Telnyx number, Telnyx POSTs a `call.initiated`
 * event (JSON) here. A valid `Telnyx-Signature-Ed25519` proves the request
 * really came from Telnyx, so the call is transferred to the Dograh agent
 * number (TELNYX_FORWARD_TO) with the original caller's number as the caller
 * ID. The agent then answers the forwarded call and runs the Dograh workflow.
 *
 * The transfer is also the forwarding-confirmation trigger: a call that
 * arrives on the Telnyx number and is accepted for transfer to the agent is
 * live proof that the owner's carrier forwarding works end to end, so the
 * attributed business (matchDograhBusiness: the dialled DID must equal its
 * assignedNumber — the only match rule) has its forwardingStatus flipped to
 * "active". A failed transfer answers 500 instead — the status stays
 * "pending" and Telnyx redelivers the event so the transfer can be retried.
 *
 * Response codes:
 * - 200 — the event was handled: ignored event types (hangup, playback, ...),
 *   an unconfigured TELNYX_FORWARD_TO, or a transfer Telnyx accepted.
 * - 500 — the transfer command failed. Telnyx redelivers 5xx events, and the
 *   command_id derived from the event id keeps that redelivery safe: Telnyx
 *   ignores a duplicate command within 60 seconds, so a transfer that actually
 *   went through is never executed twice.
 */

/**
 * Whether inbound calls for this business should be BLOCKED (caller hears the
 * unavailable message instead of the agent).
 *
 * Deliberately narrow: only a business that has FINISHED onboarding can be
 * blocked. During steps 1–4 the call is how the owner verifies forwarding and
 * how the trial clock starts, so gating there would break signup.
 */
function callsBlocked(business: Business): boolean {
  if (business.onboardingStep !== "done") return false;
  return !describeBillingAccess(business).entitled;
}

/**
 * One line the caller hears when the business is no longer entitled. Short on
 * purpose: it is spoken by Telnyx's TTS.
 */
const UNAVAILABLE_MESSAGE =
  "This business is not available to take your call right now. Please try again later.";

/**
 * Best-effort "your trial has ended" owner email, sent ONCE per business (the
 * trialEndedEmailAt stamp is written only after a successful send). Runs from
 * after(), so it can never delay or fail the webhook response.
 */
async function sendTrialEndedEmail(business: Business): Promise<void> {
  const to = business.notificationEmail?.trim() || business.billingEmail?.trim() || "";
  if (!to) {
    console.warn(
      "[telnyx-answer] trial ended but this business has no email on file — owner not notified",
      { businessId: business.id }
    );
    return;
  }
  const config = readSmtpConfig();
  if (!config) {
    console.error(
      "[telnyx-answer] SMTP is not configured, so the trial-ended email was skipped."
    );
    return;
  }
  const name = business.billingName?.trim() || "your business";
  const result = await sendOperatorAlertEmail(
    config,
    to,
    "CallFlow: your free trial has ended",
    `Hi ${name},\n\n` +
      "your 3-day CallFlow trial has ended and calls to your CallFlow number are " +
      "no longer answered by the agent.\n" +
      "Callers now hear a short message asking them to try again later, so they " +
      "never reach a dead line.\n\n" +
      "To start answering calls again, subscribe for $49/month from your " +
      "dashboard: https://callflow.biz/app\n\n" +
      "— CallFlow"
  );
  if (result.sent) {
    await updateBusiness(business.id, {
      trialEndedEmailAt: new Date().toISOString(),
    });
    return;
  }
  console.error("[telnyx-answer] trial-ended email not sent", {
    businessId: business.id,
    error: result.error,
  });
}

let warnedOnce = false;
function warnIfPublicKeyUnconfigured() {
  if (
    !warnedOnce &&
    process.env.NODE_ENV === "production" &&
    !getTelnyxConfig().publicKey
  ) {
    warnedOnce = true;
    console.warn(
      "[telnyx-answer] TELNYX_PUBLIC_KEY is UNSET in production — this " +
        "endpoint is rejecting every webhook with 503 (fail closed). Set it " +
        "in the runtime env and restart to accept Telnyx traffic."
    );
  }
}

export async function POST(request: Request) {
  warnIfPublicKeyUnconfigured();
  // Fail closed in production: with no public key the signature check below
  // would accept every request, letting anyone forge a `call.initiated` event
  // and make us transfer paid calls to the agent number. 503 = server
  // misconfiguration, retryable — Telnyx keeps retrying so it recovers once
  // the key is set.
  if (process.env.NODE_ENV === "production" && !getTelnyxConfig().publicKey) {
    return new NextResponse("Service Unavailable", { status: 503 });
  }

  const bodyText = await request.text();

  const verified = verifyTelnyxSignature({
    body: bodyText,
    signature: request.headers.get("telnyx-signature-ed25519"),
    timestamp: request.headers.get("telnyx-timestamp"),
  });

  if (!verified) {
    console.warn("[telnyx-answer] rejected request with an invalid signature");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const event = parseTelnyxEvent(bodyText);
  if (!event) {
    console.warn("[telnyx-answer] could not parse webhook payload");
    return new NextResponse("Bad Request", { status: 400 });
  }

  // Only inbound call arrivals trigger a forward. The connection must NOT
  // auto-answer: the transfer is issued while the call is still ringing.
  if (event.eventType !== "call.initiated") {
    return new NextResponse("OK", { status: 200 });
  }

  // Attribute the call BEFORE answering it: the dialled number must match a
  // business's assignedNumber (the only rule). An unknown number is not gated —
  // it is simply transferred, exactly as before.
  const business = await matchDograhBusiness(event.to);

  // Entitlement gate (see callsBlocked): a business whose trial has expired and
  // which has no live subscription must NOT reach the AI agent. The caller hears
  // a short "unavailable" message instead of a dead line. Fails open: if Telnyx
  // rejects the speak command we still transfer, so a real caller is never
  // stranded by a provider hiccup.
  if (business && callsBlocked(business)) {
    const spoke = await speakToCaller(
      event.callControlId,
      UNAVAILABLE_MESSAGE,
      `unavailable-${event.eventId}`
    );
    if (spoke.ok) {
      console.warn("[telnyx-answer] trial/subscription lapsed — agent not reached", {
        businessId: business.id,
        dialledNumber: event.to,
      });
      if (!business.trialEndedEmailAt) {
        // One email per business: the stamp is written only after a successful
        // send. Fire-and-forget so the response never waits on SMTP.
        void sendTrialEndedEmail(business).catch((error) => {
          console.error("[telnyx-answer] trial-ended email threw", error);
        });
      }
      return new NextResponse("OK", { status: 200 });
    }
    console.error(
      "[telnyx-answer] could not play the unavailable message — transferring anyway",
      { businessId: business.id, error: spoke.error }
    );
  }

  const { forwardTo } = getTelnyxConfig();
  if (!forwardTo) {
    console.warn(
      "[telnyx-answer] TELNYX_FORWARD_TO is not configured; call not transferred",
      { callControlId: event.callControlId }
    );
    return new NextResponse("OK", { status: 200 });
  }

  // command_id derived from the event id: Telnyx ignores a duplicate command
  // with the same id within 60 seconds, so a redelivered webhook cannot
  // transfer the same call twice.
  const result = await transferCall(
    event.callControlId,
    forwardTo,
    event.from,
    `transfer-${event.eventId}`
  );

  if (!result.ok) {
    // The transfer failed — answer 500 so Telnyx redelivers the event and this
    // handler retries with the same command_id (a no-op if the transfer did go
    // through). forwarding_status deliberately stays "pending": only a
    // transfer Telnyx accepted may confirm forwarding as active.
    console.error("[telnyx-answer] transfer command failed", {
      callControlId: event.callControlId,
      caller: event.from,
      error: result.error,
    });
    return new NextResponse("Internal Server Error", { status: 500 });
  }

  console.info("[telnyx-answer] transferred inbound call to the agent", {
    callControlId: event.callControlId,
    caller: event.from,
    result: result.result,
  });

  // The transfer was accepted, so the owner's carrier forwarding demonstrably
  // works end to end: confirm that specific business's forwarding. An
  // unattributed call flips nothing (it was matched above, before the gate).
  // If the DB write itself throws, the handler answers 500 and Telnyx's
  // redelivery retries it.
  if (business) {
    await setBusinessForwardingStatus(
      business.id,
      "active",
      new Date().toISOString()
    );
    console.info("[telnyx-answer] forwarding confirmed by successful transfer", {
      businessId: business.id,
      dialledNumber: event.to,
    });
  } else {
    console.warn(
      "[telnyx-answer] transfer succeeded but the call is unattributed — no forwarding_status update",
      { dialledNumber: event.to, caller: event.from }
    );
  }

  return new NextResponse("OK", { status: 200 });
}
