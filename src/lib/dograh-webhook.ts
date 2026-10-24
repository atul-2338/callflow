import {
  clearBusinessFcmToken,
  getAllBusinesses,
  getBusinessByPhone,
  getBusinessFcmToken,
  upsertDograhCall,
} from "./db";
import {
  parseDograhWebhookBody,
  readHeaderSafe,
  secretsMatch,
  webhookSecret,
  type HeaderReader,
} from "./dograh";
import { sendPushNotification, type NotifyMissedCallResult } from "./firebase";
import { CALL_STATUSES, type CallStatus } from "./types";

/**
 * Core of the Dograh end-of-call webhook (POST /api/webhooks/dograh):
 * auth → parse → persist (upsert) → match business → push plan. Exported as a
 * plain function (not tied to the Next Request) so vitest exercises the SAME
 * code path that production traffic uses. The route schedules {@link
 * deliverOwnerPush} with after() so the push never delays the 200 response.
 */

export interface DograhWebhookResult {
  status: number;
  body: Record<string, unknown>;
  /** callId when an AUTHENTICATED body carried one — for request logging only. */
  callId?: string;
  /** Set on 200s for NEW calls; the route runs it via after(). */
  pushPlan: OwnerPushPlan | null;
  /** True when this request inserted a row (false = updated an existing one). */
  created: boolean;
}

/** Everything deliverOwnerPush needs to send the owner's push notification. */
export interface OwnerPushPlan {
  fcmToken: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

const PUSH_TITLES: Record<CallStatus, string> = {
  answered: "✅ Call handled",
  missed: "☎️ Missed call",
  busy: "☎️ Line busy",
  failed: "☎️ Call failed",
  voicemail_left: "📝 Voicemail captured",
};

/**
 * Business matching for the pilot. Dograh's `called_number` is the number the
 * caller dialled (the DID), so link the call to the business that owns it:
 * 1. exact match on businesses.phoneNumber (normalized E.164),
 * 2. no match and exactly one business exists → that business,
 * 3. otherwise null (row is still recorded, unlinked) with a loud warning —
 *    nothing is silently dropped.
 */
export async function matchDograhBusiness(calledNumber: string) {
  if (calledNumber) {
    const direct = await getBusinessByPhone(calledNumber);
    if (direct) return direct;
  }
  const all = await getAllBusinesses();
  if (all.length === 1) return all[0];
  console.warn(
    `[dograh-webhook] Call stored UNLINKED: called_number "${calledNumber || "(missing)"}" ` +
      `matches no business's assigned number and ${all.length} businesses exist ` +
      "(the single-business fallback needs exactly one). Save the dialled number as " +
      "the business's phoneNumber to link calls automatically."
  );
  return null;
}

/**
 * End-of-call webhook status → the calls.callStatus enum. An end-of-call
 * delivery from the AI agent means the call was answered; anything we don't
 * recognise (or nothing at all) maps to "answered" rather than guessing.
 */
function toCallStatus(status: string): CallStatus {
  const normalized = status.trim().toLowerCase();
  return (CALL_STATUSES as readonly string[]).includes(normalized)
    ? (normalized as CallStatus)
    : "answered";
}

export async function handleDograhWebhook(opts: {
  body: unknown;
  headers: HeaderReader;
  /** True when the route could not parse the body as JSON at all. */
  jsonInvalid?: boolean;
  /** Injectable for tests: real FCM sends need a Firebase project. */
  sendPush?: (
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ) => Promise<NotifyMissedCallResult>;
}): Promise<DograhWebhookResult> {
  // 1. Auth FIRST — never parse or trust an unauthenticated body. A wrong or
  //    missing secret on either side fails closed with 401.
  const secret = webhookSecret();
  const provided = readHeaderSafe(opts.headers, "x-webhook-secret");
  if (!secret || !provided || !secretsMatch(provided, secret)) {
    return {
      status: 401,
      body: { error: "unauthorized" },
      pushPlan: null,
      created: false,
    };
  }

  // 2. Body must be valid JSON (the route parses it and reports failures here
  //    so auth is always evaluated before the 400).
  if (opts.jsonInvalid) {
    return {
      status: 400,
      body: { error: "request body must be valid JSON" },
      pushPlan: null,
      created: false,
    };
  }

  // 3. callId is the one required field; extra fields are ignored.
  const payload = parseDograhWebhookBody(opts.body);
  if (!payload) {
    return {
      status: 400,
      body: { error: "callId is required" },
      pushPlan: null,
      created: false,
    };
  }

  // 4. Persist — the same callId always UPDATEs the existing row (never a
  //    duplicate) and the exact payload is kept beside the row for debugging.
  const business = await matchDograhBusiness(payload.calledNumber);
  const fcmToken = await getBusinessFcmToken();
  const { id, created } = await upsertDograhCall({
    callId: payload.callId,
    businessId: business?.id ?? null,
    callerNumber: payload.callerNumber || "unknown",
    businessNumber: payload.calledNumber,
    callStatus: toCallStatus(payload.status),
    durationSeconds: payload.durationSeconds,
    customerName: payload.customerName,
    callbackNumber: payload.callerNumber || null,
    rawPayload: JSON.stringify(opts.body ?? null),
  });

  // 5. Owner push — for NEW calls only (replays/updates of the same callId
  //    must not re-notify). The plan is executed AFTER the response by the
  //    route via after(), so it can never delay or fail the 200.
  let pushPlan: OwnerPushPlan | null = null;
  if (created) {
    if (fcmToken) {
      const who = payload.customerName || payload.callerNumber || "A caller";
      const duration =
        payload.durationSeconds === null ? "" : ` (${payload.durationSeconds}s)`;
      const callBack = payload.callerNumber
        ? `. Call back: ${payload.callerNumber}`
        : "";
      pushPlan = {
        fcmToken,
        title: PUSH_TITLES[toCallStatus(payload.status)],
        body: `Call from ${who}${duration}${callBack}`,
        data: { callId: id, callerNumber: payload.callerNumber || "unknown" },
      };
    } else {
      console.warn(
        "[dograh-webhook] Push skipped: no FCM token registered. Register one via POST /api/settings to enable owner notifications."
      );
    }
  }

  return {
    status: 200,
    body: { ok: true },
    callId: payload.callId,
    pushPlan,
    created,
  };
}

/**
 * Send the owner's push for a saved call — runs AFTER the 200 response (the
 * route schedules it with after()). NOTHING here may fail the request:
 * failures are logged, and a token FCM reports as dead is forgotten so later
 * deliveries skip the push step. Transient failures leave the token in place.
 */
export async function deliverOwnerPush(
  plan: OwnerPushPlan,
  sendPush: (
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ) => Promise<NotifyMissedCallResult> = sendPushNotification
): Promise<void> {
  const push = await sendPush(plan.fcmToken, plan.title, plan.body, plan.data);
  if (!push.sent) {
    console.warn(
      `[dograh-webhook] Owner push not delivered (${push.error ?? "unknown error"}). Text: "${plan.body}".`
    );
  }
  if (plan.fcmToken && push.invalidToken) {
    await clearBusinessFcmToken();
    console.warn(
      "[dograh-webhook] Cleared dead FCM token — the device must re-register via POST /api/settings."
    );
  }
}