import { NextResponse } from "next/server";
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
 * Telnyx does not use the response body for Call Control events, so every
 * acknowledged event returns 200 — including events we ignore (hangup,
 * playback, ...) and transfer failures (a 5xx would only make Telnyx
 * redeliver the same event, and the command_id already makes the retry a
 * no-op).
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
    console.error("[telnyx-answer] transfer command failed", {
      callControlId: event.callControlId,
      caller: event.from,
      error: result.error,
    });
  } else {
    console.info("[telnyx-answer] transferred inbound call to the agent", {
      callControlId: event.callControlId,
      caller: event.from,
      result: result.result,
    });
  }

  return new NextResponse("OK", { status: 200 });
}
