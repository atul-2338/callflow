import { NextResponse } from "next/server";
import { dograhWebhookSecret } from "@/lib/dograh";
import { handleDograhWebhook } from "@/lib/dograh-webhook";

/**
 * Receives Dograh workflow "send webhook" deliveries at end of call.
 *
 * Configure in the Dograh workflow editor:
 *   URL:     https://<your-host>/api/webhooks/dograh?key=<DOGRAH_WEBHOOK_SECRET>
 *   Method:  POST
 *   Headers: X-Callflow-Secret: <DOGRAH_WEBHOOK_SECRET> (custom header)
 *   Body:    the Callflow payload template (see README "Dograh webhook").
 *
 * Responses: 200 = stored/duplicate (stop retries), 4xx = permanent failure
 * (Dograh dead-letters after its retry budget — check the template/config),
 * 5xx = unexpected, safe to retry.
 */

let warnedOnce = false;
function warnIfSecretUnconfigured() {
  if (
    !warnedOnce &&
    process.env.NODE_ENV === "production" &&
    !dograhWebhookSecret()
  ) {
    warnedOnce = true;
    console.warn(
      "[dograh-webhook] DOGRAH_WEBHOOK_SECRET is UNSET in production — this " +
        "endpoint accepts unauthenticated POSTs. Set it in /srv/callflow/.env " +
        "and restart before pointing real Dograh traffic at it."
    );
  }
}

export async function POST(request: Request) {
  warnIfSecretUnconfigured();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "request body must be valid JSON" },
      { status: 400 }
    );
  }

  try {
    const result = await handleDograhWebhook({
      body,
      headers: request.headers,
      searchParams: new URL(request.url).searchParams,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[dograh-webhook] unhandled failure:", err);
    return NextResponse.json(
      { error: "internal error processing webhook" },
      { status: 500 }
    );
  }
}

/** Liveness probe so the URL can be verified in the Dograh editor. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "dograh-webhook",
    secretConfigured: Boolean(dograhWebhookSecret()),
  });
}

