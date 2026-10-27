import { NextResponse } from "next/server";
import { setBusinessForwardingStatus } from "@/lib/db";
import { matchDograhBusiness } from "@/lib/dograh-webhook";
import {
  getTelnyxConfig,
  parseTelnyxEvent,
  transferCall,
  verifyTelnyxSignature,
} from "@/lib/telnyx";

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

  // Telnyx accepted the transfer — the owner's carrier forwarding demonstrably
  // works end to end. Attribute the call via matchDograhBusiness (the dialled
  // DID must equal the business's assignedNumber — the only match rule) and
  // confirm that specific business's forwarding. An unattributed call flips
  // nothing. If the DB write itself throws, the handler answers 500 and
  // Telnyx's redelivery retries it.
  const business = await matchDograhBusiness(event.to);
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
