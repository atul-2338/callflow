import {
  addCall,
  getAllBusinesses,
  getBusinessByPhone,
  getBusinessFcmToken,
  getCallByDograhDeliveryId,
  getCallByDograhRunId,
  normalizePhone,
} from "./db";
import {
  extractDograhEvent,
  flattenTranscript,
  isDograhRequestAuthorized,
  type HeaderReader,
} from "./dograh";
import { sendPushNotification } from "./firebase";
import { getPlivoConfig } from "./plivo";
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
 * Pilot-safe business matching. Real forwarding means `called_number` is the
 * Plivo number, not the business's own line — so:
 * 1. exact match on businesses.phone_number (normalized),
 * 2. call reached our Plivo number and exactly one business exists → it,
 * 3. no routing info at all and exactly one business exists → it,
 * 4. otherwise null (row is still recorded; nothing is silently dropped).
 */
export async function matchDograhBusiness(calledNumber: string) {
  if (calledNumber) {
    const direct = await getBusinessByPhone(calledNumber);
    if (direct) return direct;
  }
  const all = await getAllBusinesses();
  const sole = all.length === 1 ? all[0] : null;
  if (!sole) return null;
  if (!calledNumber) return sole;
  const plivo = normalizePhone(getPlivoConfig().number || "");
  // Plivo number not configured (early pilot): one business, no way to
  // misroute — match it.
  if (!plivo) return sole;
  if (normalizePhone(calledNumber) === plivo) return sole;
  return null;
}

export async function handleDograhWebhook(opts: {
  body: unknown;
  headers: HeaderReader;
  searchParams?: URLSearchParams;
  /** Injectable for tests: Dograh public transcript URLs need a real run. */
  fetchTranscript?: (url: string) => Promise<string | null>;
}): Promise<DograhWebhookResult> {
  const { body, headers } = opts;
  const searchParams = opts.searchParams ?? new URLSearchParams();

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
      outcome: event.outcome,
      customerName: event.customerName,
      calendarEventId: event.calendarEventId,
      transcriptUrl: event.transcriptUrl,
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
  const push = fcmToken
    ? await sendPushNotification(
        fcmToken,
        PUSH_TITLES[event.outcome],
        `${who} — tap to review the call`,
        {
          callId: call.id,
          outcome: event.outcome,
          callerNumber: event.callerNumber,
        }
      )
    : { sent: false, error: "No FCM token configured" };

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

