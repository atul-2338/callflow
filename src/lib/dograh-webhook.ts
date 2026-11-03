import {
  clearBusinessFcmToken,
  getAllBusinesses,
  getBusinessFcmToken,
  normalizePhone,
  updateBusiness,
  upsertDograhCall,
} from "./db";
import {
  describeTopLevelKeys,
  parseDograhWebhookBody,
  readHeaderSafe,
  secretsMatch,
  webhookSecret,
  type HeaderReader,
} from "./dograh";
import {
  readSmtpConfig,
  sendCallAlertEmail,
  smtpConfigError,
  type CallAlertEmailInput,
} from "./email";
import { sendPushNotification, type NotifyMissedCallResult } from "./firebase";
import { normalizeEnvValue } from "./util";
import { CALL_STATUSES, type CallStatus } from "./types";

/**
 * Core of the Dograh end-of-call webhook (POST /api/webhooks/dograh):
 * auth → parse → match (assignedNumber only) → persist (upsert) → push plan.
 * Exported as a plain function (not tied to the Next Request) so vitest
 * exercises the SAME code path that production traffic uses. The route
 * schedules {@link deliverOwnerPush} with after() so the push never delays
 * the 200 response.
 */

export interface DograhWebhookResult {
  status: number;
  body: Record<string, unknown>;
  /** callId when an AUTHENTICATED body carried one — for request logging only. */
  callId?: string;
  /** Set on 200s for NEW calls; the route runs it via after(). */
  pushPlan: OwnerPushPlan | null;
  /** Set on 200s for NEW, ATTRIBUTED calls with an owner email; after() too. */
  alertPlan: OwnerAlertPlan | null;
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

/** Everything deliverOwnerEmail needs to send the owner's call alert. */
export interface OwnerAlertPlan {
  to: string;
  input: CallAlertEmailInput;
}

/** Absolute CTA URL for the email (PUBLIC_BASE_URL, else the live host). */
function dashboardUrl(): string {
  const base = (
    normalizeEnvValue(process.env.PUBLIC_BASE_URL) || "https://callflow.biz"
  ).replace(/\/+$/, "");
  return `${base}/app`;
}

/**
 * Send the owner's call alert — runs AFTER the 200 response (the route
 * schedules it with after()). NOTHING here may fail the request: a missing SMTP
 * configuration or a transport error is logged and dropped.
 */
export async function deliverOwnerEmail(
  plan: OwnerAlertPlan,
  send: typeof sendCallAlertEmail = sendCallAlertEmail
): Promise<void> {
  const config = readSmtpConfig();
  if (!config) {
    console.warn(
      `[dograh-webhook] Call alert email skipped: ${smtpConfigError()}`
    );
    return;
  }
  const result = await send(config, plan.to, plan.input);
  if (!result.sent) {
    console.warn(
      `[dograh-webhook] Call alert email not delivered (${
        result.error ?? "unknown error"
      }).`
    );
  }
}

const PUSH_TITLES: Record<CallStatus, string> = {
  answered: "✅ Call handled",
  missed: "☎️ Missed call",
  busy: "☎️ Line busy",
  failed: "☎️ Call failed",
  voicemail_left: "📝 Voicemail captured",
};

/**
 * Business matching for the pilot. `calledNumber` is the number the caller
 * dialled (the DID) — Dograh's `called_number`, or one of the aliases the
 * parser accepts (see dograh.ts) — and there is exactly ONE routing rule:
 * an exact match on businesses.assignedNumber (normalized) — the per-business
 * DID the number pool bound to that business. There is no shared-number
 * fallback and no legacy phoneNumber match: a call whose called_number matches
 * no business's assignedNumber is logged loudly and then STORED with
 * businessId = NULL (see handleDograhWebhook), so it shows up under
 * /admin/calls → "Unlinked only" instead of being lost.
 */
export async function matchDograhBusiness(calledNumber: string) {
  if (calledNumber) {
    const normalized = normalizePhone(calledNumber);
    if (normalized) {
      const assigned = (await getAllBusinesses()).find(
        (b) =>
          b.assignedNumber && normalizePhone(b.assignedNumber) === normalized
      );
      if (assigned) return assigned;
    }
  }
  console.warn(
    `[dograh-webhook] No business owns the dialled number "${
      calledNumber || "(missing)"
    }" (matched against assignedNumber — the only rule). Assign that number to ` +
      "a business from the pool (/admin/numbers) to attribute its calls."
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
      alertPlan: null,
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
      alertPlan: null,
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
      alertPlan: null,
      created: false,
    };
  }

  // 4. A payload with no dialled number cannot be routed. Log WHICH top-level
  //    keys arrived (NAMES only, never values: a value can be a phone number or
  //    a transcript) so a mis-templated Dograh webhook is diagnosable from a
  //    single log line. The call is still stored below (unlinked).
  if (!payload.calledNumber) {
    console.warn(
      "[dograh-webhook] No called number in the payload (tried called_number, to, " +
        "to_number, called at the top level, in initial_context, and in a nested " +
        `call object). Top-level keys: ${describeTopLevelKeys(opts.body)}`
    );
  }

  // 5. Match the business by the dialled number (the ONE rule), then persist —
  //    the same callId always UPDATEs the existing row (never a duplicate) and
  //    the exact payload is kept beside the row for debugging. An UNMATCHED
  //    call is NOT dropped: it is stored with businessId = NULL so the admin
  //    panel can show it (/admin/calls → "Unlinked only"). Only authenticated
  //    payloads carrying a callId ever reach this point.
  const business = await matchDograhBusiness(payload.calledNumber);
  if (!business) {
    // Nobody owns the dialled number: keep the call anyway (brief Step 1 —
    // "unmatched calls must be saved with business_id = NULL, never dropped")
    // and log the payload's KEY NAMES only (never values) so a mis-templated
    // Dograh webhook stays diagnosable from one line.
    console.warn(
      `[dograh-webhook] Storing call ${payload.callId} UNLINKED (businessId NULL). ` +
        `Payload keys: ${describeTopLevelKeys(opts.body)}`
    );
  }

  // Onboarding auto-completion: a live call attributed to a business waiting
  // on step 4 (verify) is proof the owner's forwarding works — advance the
  // linear /onboarding flow to done. Never regress a finished business.
  if (business?.onboardingStep === "4") {
    await updateBusiness(business.id, { onboardingStep: "done" });
  }

  // Owner pushes target one device token; an unmatched call has no business to
  // notify, so skip the lookup entirely.
  const fcmOwner = business ? await getBusinessFcmToken() : "";
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

  // 6. Owner push — for NEW, ATTRIBUTED calls only (replays/updates of the
  //    same callId must not re-notify; an unlinked call has no owner). The plan
  //    is executed AFTER the response by the route via after(), so it can never
  //    delay or fail the 200.
  let pushPlan: OwnerPushPlan | null = null;
  if (created && business) {
    if (fcmOwner) {
      const who = payload.customerName || payload.callerNumber || "A caller";
      const duration =
        payload.durationSeconds === null ? "" : ` (${payload.durationSeconds}s)`;
      const callBack = payload.callerNumber
        ? `. Call back: ${payload.callerNumber}`
        : "";
      pushPlan = {
        fcmToken: fcmOwner,
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

  // 7. Owner EMAIL alert (brief Step 4) — one short summary per NEW, ATTRIBUTED
  //    call, sent to the business's alert address (notificationEmail, then
  //    billing email). Replays never re-send and an unlinked call has no owner.
  //    The route sends it with after(), so SMTP can never delay or fail the 200.
  let alertPlan: OwnerAlertPlan | null = null;
  if (created && business) {
    const to =
      business.notificationEmail?.trim() || business.billingEmail?.trim() || "";
    if (to) {
      const status = toCallStatus(payload.status);
      alertPlan = {
        to,
        input: {
          name: payload.customerName || payload.callerNumber || "Unknown caller",
          urgency: null,
          reason: null,
          callbackNumber: payload.callerNumber || null,
          startedAt: new Date().toISOString(),
          recordingUrl: null,
          outcome:
            payload.durationSeconds === null
              ? status
              : `${status} (${payload.durationSeconds}s)`,
          dashboardUrl: dashboardUrl(),
        },
      };
    } else {
      console.warn(
        "[dograh-webhook] Call alert email skipped: this business has no notification or billing email on file."
      );
    }
  }

  return {
    status: 200,
    body: { ok: true },
    callId: payload.callId,
    pushPlan,
    alertPlan,
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