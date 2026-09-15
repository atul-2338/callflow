import { NextResponse } from "next/server";
import { isAuthorized, unauthorizedResponse } from "@/lib/auth";
import { dograhWebhookSecret } from "@/lib/dograh";
import {
  buildDograhFixture,
  DOGRAH_FIXTURE_NAMES,
  type DograhFixtureName,
} from "@/lib/dograh-fixtures";
import { handleDograhWebhook } from "@/lib/dograh-webhook";

/**
 * Fires the FULL Dograh webhook pipeline (auth → parse → dedupe → match →
 * DB write → push) with a representative fixture payload, without needing a
 * real call. Protected by APP_AUTH_TOKEN (unlike the real webhook endpoint,
 * which uses DOGRAH_WEBHOOK_SECRET).
 *
 *   POST /api/webhooks/dograh/test            → default "booked" fixture
 *   POST /api/webhooks/dograh/test            → {"fixture":"voicemail"}
 *   POST /api/webhooks/dograh/test            → {"fixture":"booked","workflow_run_id":"fixed-1"}
 *
 * Pass the same `workflow_run_id` twice (or replay the printed payload with
 * curl against /api/webhooks/dograh) to prove idempotency.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  let config: {
    fixture?: string;
    caller_number?: string;
    called_number?: string;
    workflow_run_id?: string;
  };
  try {
    config = await request.json();
  } catch {
    config = {};
  }

  const fixture = (config.fixture ?? "booked") as DograhFixtureName;
  if (!DOGRAH_FIXTURE_NAMES.includes(fixture)) {
    return NextResponse.json(
      { error: `unknown fixture — use one of: ${DOGRAH_FIXTURE_NAMES.join(", ")}` },
      { status: 400 }
    );
  }

  const { payload, headers } = buildDograhFixture(fixture, {
    caller_number: config.caller_number,
    called_number: config.called_number,
    workflow_run_id: config.workflow_run_id,
  });

  const sentHeaders = new Headers(headers);
  const secret = dograhWebhookSecret();
  if (secret) sentHeaders.set("x-callflow-secret", secret);

  const result = await handleDograhWebhook({
    body: payload,
    headers: sentHeaders,
    searchParams: new URLSearchParams(),
  });

  return NextResponse.json(
    {
      fixture,
      payload,
      webhookStatus: result.status,
      webhookBody: result.body,
    },
    { status: result.status }
  );
}


export async function GET() {
  return NextResponse.json({ fixtures: DOGRAH_FIXTURE_NAMES });
}
