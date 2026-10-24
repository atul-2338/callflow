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
 * delay it. Logging is one line per request — method, callId, status code —
 * and never includes the secret, headers, or body.
 */

export async function POST(request: Request) {
  let body: unknown = null;
  let jsonInvalid = false;
  try {
    body = await request.json();
  } catch {
    jsonInvalid = true;
  }

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