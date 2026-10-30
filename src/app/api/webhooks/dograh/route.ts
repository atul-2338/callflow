import { after } from "next/server";
import { NextResponse } from "next/server";
import { deliverOwnerPush, handleDograhWebhook } from "@/lib/dograh-webhook";

/**
 * Receives Dograh workflow "send webhook" deliveries at end of call.
 *
 * Configure in the Dograh workflow editor:
 *   URL:     https://<your-host>/api/webhooks/dograh
 *   Method:  POST
 *   Header:  x-webhook-secret: <WEBHOOK_SECRET from .env>
 *   Body:    JSON with callId (required) — see README "Webhook contract".
 *
 * Responses: 200 {"ok":true} = stored/updated (stop retries); 401 = wrong or
 * missing secret; 400 = bad JSON or no callId. The owner push notification is
 * scheduled with after() so it runs after the response is sent and can never
 * delay it. Normal logging is one line per request — method, callId, status
 * code — and never includes the secret, headers, or body.
 *
 * TEMP-DEBUG: while the "call arrives but is not stored" report is being
 * diagnosed, POST logs one "[DOGRAH-DEBUG]" line with the payload's top-level
 * field names, the dialled number and the caller number truncated to its first
 * 6 digits, and handleDograhWebhook logs the value the parser extracted. Remove
 * BOTH logs and this note once the called-number field of the live Dograh
 * template is confirmed.
 */

export async function POST(request: Request) {
  let body: unknown = null;
  let jsonInvalid = false;
  try {
    body = await request.json();
  } catch {
    jsonInvalid = true;
  }

  // TODO: TEMP-DEBUG — remove before production
  // Runs BEFORE any header validation or DB lookup, so one live call shows
  // exactly what the template sent. NOTE: `to: ""` (rather than NOT_FOUND) means
  // the key arrived but the Dograh template rendered it EMPTY.
  const debugBody = (body ?? {}) as Record<string, unknown>;
  // First non-empty string among the aliases the parser accepts for the caller.
  const debugFrom = (["from", "caller", "caller_number", "from_number"] as const)
    .map((key) => debugBody[key])
    .find(
      (value): value is string => typeof value === "string" && value.length > 0
    );
  console.log(
    "[DOGRAH-DEBUG]",
    JSON.stringify({
      fields: Object.keys(debugBody),
      to:
        debugBody.to ??
        debugBody.to_number ??
        debugBody.called_number ??
        debugBody.destination ??
        "NOT_FOUND",
      from_masked: debugFrom ? `${debugFrom.slice(0, 6)}****` : "NOT_FOUND",
    })
  );

  let status = 500;
  let callId: string | undefined;
  try {
    const result = await handleDograhWebhook({
      body,
      headers: request.headers,
      jsonInvalid,
    });
    status = result.status;
    callId = result.callId;
    if (result.pushPlan) {
      const plan = result.pushPlan;
      // Push runs after the response is flushed — the caller gets {"ok":true} fast.
      after(() => deliverOwnerPush(plan));
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[dograh-webhook] handler failed:", error);
    return NextResponse.json(
      { error: "internal error processing webhook" },
      { status: 500 }
    );
  } finally {
    console.log(`[dograh-webhook] POST callId=${callId ?? "-"} -> ${status}`);
  }
}