import {
  addCall,
  clearBusinessFcmToken,
  getAllBusinesses,
  getBusinessByPhone,
  getBusinessFcmToken,
  getCallByDograhDeliveryId,
  getCallByDograhRunId,
} from "./db";
import {
  dograhWebhookSecret,
  extractDograhEvent,
  flattenTranscript,
  isDograhRequestAuthorized,
  type HeaderReader,
} from "./dograh";
import { sendPushNotification, type NotifyMissedCallResult } from "./firebase";
import { getPublicBaseUrl } from "./plivo";
import {
  readSmtpConfig,
  sendCallAlertEmail,
  smtpConfigError,
  type CallAlertEmailInput,
  type EmailSendResult,
} from "./email";
import type { CallOutcome } from "./types";

/**
 * Core of the Dograh end-of-call webhook: auth → parse → dedupe → match
 * business → persist → push. Exported as a plain function (not tied to the
 * Next Request) so the fixture test route and vitest exercise the SAME code
 * path that production traffic uses.
 */

export interface DograhWebhookResult {
  status: number;
  body: Record<string, unknown>;
}

const PUSH_TITLES: Record<CallOutcome, string> = {
  booked: "📅 Appointment booked",
  callback: "📞 Callback requested",
  voicemail: "📝 Voicemail captured",
  handled: "✅ Call handled",
  other: "☎️ Call finished",
};

const TRANSCRIPT_FETCH_TIMEOUT_MS = 8_000;
const MAX_TRANSCRIPT_FETCH_CHARS = 20_000;

async function fetchTranscriptFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TRANSCRIPT_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, MAX_TRANSCRIPT_FETCH_CHARS);
  } catch {
    return null;
  }
}

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

export async function handleDograhWebhook(opts: {
  body: unknown;
  headers: HeaderReader;
  searchParams?: URLSearchParams;
  /** Injectable for tests: Dograh public transcript URLs need a real run. */
  fetchTranscript?: (url: string) => Promise<string | null>;
  /** Injectable for tests: real FCM sends need a Firebase project. */
  sendPush?: (
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ) => Promise<NotifyMissedCallResult>;
  /** Injectable for tests: real SMTP sends need credentials and network. */
  sendEmail?: (
    input: CallAlertEmailInput,
    to: string
  ) => Promise<EmailSendResult>;
}): Promise<DograhWebhookResult> {
  const { body, headers } = opts;
  const searchParams = opts.searchParams ?? new URLSearchParams();

  // Fail closed in production: with no secret configured the auth check below
  // would treat every request as authorized, letting anyone POST fake call
  // data. 503 = server misconfiguration, retryable — Dograh keeps retrying so
  // the outage is loud instead of silently ingesting unauthenticated writes.
  // Outside production the unset-secret = open endpoint stays available for
  // local dev and pilot smoke tests.
  if (!dograhWebhookSecret() && process.env.NODE_ENV === "production") {
    return {
      status: 503,
      body: { error: "webhook secret not configured on this server" },
    };
  }

  if (!isDograhRequestAuthorized(headers, searchParams)) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { status: 400, body: { error: "payload must be a JSON object" } };
  }

  const event = extractDograhEvent(body as Record<string, unknown>, headers);
  if (!event) {
    return {
      status: 400,
      body: { error: "payload has neither caller_number nor a run id" },
    };
  }

  // Idempotency guard: Dograh retries a failing delivery up to 5 times, and
  // the partial unique indexes on dograhRunId/dograhDeliveryId back this up
  // at the storage layer.
  const existing =
    (event.deliveryId ? await getCallByDograhDeliveryId(event.deliveryId) : null) ??
    (event.runId ? await getCallByDograhRunId(event.runId) : null);
  if (existing) {
    return { status: 200, body: { ok: true, duplicate: true, callId: existing.id } };
  }

  const business = await matchDograhBusiness(event.calledNumber);

  let transcript = event.transcriptText;
  if (!transcript && event.transcriptUrl) {
    const fetcher = opts.fetchTranscript ?? fetchTranscriptFromUrl;
    transcript = flattenTranscript(await fetcher(event.transcriptUrl));
  }

  let call;
  try {
    call = await addCall({
      businessId: business?.id ?? null,
      callerNumber: event.callerNumber || "unknown",
      businessNumber: event.calledNumber || business?.phoneNumber || "",
      callStatus: event.callStatus,
      callStartedAt: event.startedAt,
      callEndedAt: event.endedAt,
      durationSeconds: event.durationSeconds,
      textBackSent: false,
      textBackSentAt: null,
      signalwireCallSid: null,
      recordingUrl: event.recordingUrl,
      transcript,
      dograhRunId: event.runId,
      dograhDeliveryId: event.deliveryId,
      dograhDisposition: event.disposition || null,
      outcome: event.outcome,
      customerName: event.customerName,
      // Webhook contract: an empty callback_number falls back to the caller
      // number so the owner always has a reachable number to dial.
      callbackNumber: event.callbackNumber || event.callerNumber || null,
      calendarEventId: event.calendarEventId,
      transcriptUrl: event.transcriptUrl,
      serviceRequested: event.serviceRequested,
      urgency: event.urgency,
      preferredCallbackTime: event.preferredCallbackTime,
    });
  } catch (err) {
    // Lost a race against a concurrent duplicate delivery: surface it as the
    // success it is instead of making Dograh burn its retry budget.
    if (isUniqueConstraintError(err)) {
      const raced =
        (event.runId ? await getCallByDograhRunId(event.runId) : null) ??
        (event.deliveryId ? await getCallByDograhDeliveryId(event.deliveryId) : null);
      if (raced) {
        return { status: 200, body: { ok: true, duplicate: true, callId: raced.id } };
      }
    }
    throw err;
  }

  const fcmToken = await getBusinessFcmToken();
  const who = event.customerName || event.callerNumber || "Unknown caller";
  // Pilot notification text: "<urgency> call from <name>: <reason>. Call back:
  // <number>" — with honest fallbacks when the agent did not capture a field.
  const urgencyLabel = event.urgency?.trim() || "New";
  const reason = event.serviceRequested?.trim();
  const callbackNumber = event.callbackNumber || event.callerNumber || "";
  const notificationBody = reason
    ? `${urgencyLabel} call from ${who}: ${reason}. Call back: ${callbackNumber}`
    : `${urgencyLabel} call from ${who}. Call back: ${callbackNumber}`;
  const sendPush = opts.sendPush ?? sendPushNotification;
  const push: NotifyMissedCallResult = fcmToken
    ? await sendPush(fcmToken, PUSH_TITLES[event.outcome], notificationBody, {
        callId: call.id,
        outcome: event.outcome,
        callerNumber: event.callerNumber,
      })
    : { sent: false, error: "No FCM token configured" };

  // The notification could not be delivered and this repo has no email
  // fallback yet — say so loudly instead of failing silently. Registering an
  // FCM device token (POST /api/settings) turns this off.
  if (!push.sent) {
    console.warn(
      `[Owner notification] TODO: push not delivered (${push.error ?? "unknown error"}). Text: "${notificationBody}". No email fallback is configured — register an FCM device token via POST /api/settings to enable owner notifications.`
    );
  }

  // FCM says the token itself is dead (app uninstalled / token rotated):
  // forget it so later deliveries skip the push step instead of hammering a
  // registration that will never answer. The device re-registers via
  // POST /api/settings. Transient failures (network, quota) leave it in place.
  let pushTokenCleared = false;
  if (fcmToken && push.invalidToken) {
    await clearBusinessFcmToken();
    pushTokenCleared = true;
  }

  // Email alert — NEW calls only (every duplicate path above returned before
  // the row was saved, so this code never runs for them). The recipient is
  // the business's saved notification email (Settings → Business information
  // → Email). NOTHING here may fail the webhook: a missing address, missing
  // SMTP settings, SMTP errors and even a thrown library error all collapse
  // into the 200 response below.
  let email: EmailSendResult;
  const alertTo = business?.notificationEmail?.trim() || "";
  if (!alertTo) {
    email = { sent: false, error: "No notification email saved" };
    console.warn(
      `[dograh-webhook] Email alert skipped: ${
        business
          ? "no notification email is saved for this business"
          : "the call is unlinked, so there is no business to email"
      }. Save the owner's email in Settings → Business information → Email.`
    );
  } else {
    const smtp = readSmtpConfig();
    if (!smtp) {
      const reason = smtpConfigError() ?? "SMTP settings are incomplete";
      email = { sent: false, error: `SMTP not configured: ${reason}` };
      console.warn(
        `[dograh-webhook] Email alert skipped: SMTP not configured (${reason}).`
      );
    } else {
      const alertInput: CallAlertEmailInput = {
        name: event.customerName ?? "",
        urgency: event.urgency,
        reason: event.serviceRequested,
        callbackNumber: callbackNumber || null,
        startedAt: call.callStartedAt,
        recordingUrl: call.recordingUrl ?? event.recordingUrl,
        dashboardUrl: `${getPublicBaseUrl() || "http://localhost:3000"}/calls`,
      };
      try {
        email = opts.sendEmail
          ? await opts.sendEmail(alertInput, alertTo)
          : await sendCallAlertEmail(smtp, alertTo, alertInput);
      } catch (err) {
        // Belt and braces: even a thrown error from the email library must
        // not turn the webhook response into an error.
        email = {
          sent: false,
          error: err instanceof Error ? err.message : "Email send failed",
        };
      }
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      duplicate: false,
      callId: call.id,
      businessId: call.businessId,
      matchedBusiness: Boolean(business),
      outcome: call.outcome,
      transcriptStored: Boolean(transcript),
      push,
      pushTokenCleared,
      email,
    },
  };
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { code?: unknown }).code === "string" &&
    (err as { code: string }).code.startsWith("SQLITE_CONSTRAINT_UNIQUE")
  );
}

