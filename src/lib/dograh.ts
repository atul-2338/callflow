import { createHash, timingSafeEqual } from "crypto";
import type { CallOutcome, CallStatus } from "./types";
import { normalizeEnvValue } from "./util";

/**
 * Parsing for the payload of Dograh's workflow "send webhook" node.
 *
 * Contract (verified against Dograh source, services/workflow + tasks):
 * - The body is a user-authored JSON template. The renderer stringifies EVERY
 *   value, so nested dicts (initial_context, gathered_context, cost_info)
 *   arrive as JSON-encoded STRINGS, and numbers arrive as strings.
 * - The platform injects `call_disposition` into gathered_context itself.
 * - Telephony runs store caller_number / called_number / direction in
 *   initial_context; dispositions live in gathered_context
 *   (`call_disposition` raw, `mapped_call_disposition` normalized).
 * - recording_url / transcript_url are public `/public/download/workflow/...`
 *   links that 302-redirect to short-lived signed storage URLs.
 * - Retries (up to 5) come with headers: X-Dograh-Delivery-Id,
 *   X-Dograh-Workflow-Run-Id, X-Dograh-Delivery-Attempt.
 *
 * Everything below therefore accepts keys at the top level OR inside nested
 * (possibly stringified) context dicts.
 */

export type HeaderReader = { get(name: string): string | null };

export interface DograhCallEvent {
  deliveryId: string | null;
  runId: string | null;
  workflowName: string | null;
  direction: string;
  callerNumber: string;
  calledNumber: string;
  disposition: string;
  outcome: CallOutcome;
  callStatus: CallStatus;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  transcriptUrl: string | null;
  transcriptText: string | null;
  customerName: string | null;
  calendarEventId: string | null;
}

const MAX_TRANSCRIPT_CHARS = 20_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A template value that may be a native object or a JSON-rendered string. */
function asContext(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isPlainObject(parsed)) return parsed;
      } catch {
        /* fall through */
      }
    }
  }
  return {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return String(value);
  }
  return "";
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/** Dograh writes datetimes as Python `isoformat()` output, sometimes without
 * a timezone suffix. JS `Date.parse` would read naive stamps as *local* time,
 * so detect them first and force UTC. */
function parseTimestamp(...values: unknown[]): number | null {
  const raw = firstString(...values);
  if (!raw) return null;
  const normalized = raw.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(normalized)) {
    const utc = Date.parse(`${normalized}Z`);
    if (!Number.isNaN(utc)) return utc;
  }
  const stamp = Date.parse(raw);
  return Number.isNaN(stamp) ? null : stamp;
}


const OUTCOME_BY_DISPOSITION: Record<string, CallOutcome> = {
  appointment_booked: "booked",
  booked: "booked",
  api_booked: "booked",
  booking_confirmed: "booked",
  callback_requested: "callback",
  callback: "callback",
  request_callback: "callback",
  voicemail_detected: "voicemail",
  voicemail_left: "voicemail",
  voicemail: "voicemail",
  answered: "handled",
  handled: "handled",
  resolved: "handled",
  information_provided: "handled",
  question_answered: "handled",
  transferred: "handled",
  transfer: "handled",
};

const MISSED_DISPOSITIONS = new Set(["disconnected", "no_answer", "rejected", "missed"]);

export function normalizeDisposition(disposition: string): string {
  return disposition.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function mapDispositionToOutcome(disposition: string): CallOutcome {
  return OUTCOME_BY_DISPOSITION[normalizeDisposition(disposition)] ?? "other";
}

function deriveCallStatus(
  outcome: CallOutcome,
  disposition: string,
  durationSeconds: number | null
): CallStatus {
  if (outcome === "voicemail") return "voicemail_left";
  const key = normalizeDisposition(disposition);
  if (outcome === "other" && MISSED_DISPOSITIONS.has(key)) {
    return !durationSeconds ? "missed" : "answered";
  }
  return "answered";
}

/**
 * Flatten a Dograh transcript (JSON array of turns or plain text) into
 * "Caller: …" / "Agent: …" lines. Unparseable input is kept as-is.
 */
export function flattenTranscript(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  if (text[0] !== "[" && text[0] !== "{") {
    return text.slice(0, MAX_TRANSCRIPT_CHARS);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text.slice(0, MAX_TRANSCRIPT_CHARS);
  }
  const lines = collectTurns(parsed);
  return (lines.length ? lines.join("\n") : text).slice(0, MAX_TRANSCRIPT_CHARS);
}

function turnLabel(speaker: string): string {
  const key = speaker.trim().toLowerCase();
  if (["user", "caller", "customer", "human"].includes(key)) return "Caller";
  if (["agent", "bot", "assistant", "ai"].includes(key)) return "Agent";
  return speaker || "Caller";
}

function collectTurns(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectTurns);
  }
  if (isPlainObject(value)) {
    const text = firstString(value.text, value.content, value.message, value.transcript);
    if (text) {
      const speaker = firstString(value.speaker, value.role, value.channel, value.from);
      return [`${turnLabel(speaker || "Caller")}: ${text}`];
    }
    for (const key of ["transcript", "turns", "messages"]) {
      const nested = value[key];
      if (Array.isArray(nested)) return collectTurns(nested);
    }
  }
  return [];
}

/**
 * Extract a Callflow-shaped event from an arbitrary Dograh webhook payload.
 * Returns null only when the payload carries neither a caller number nor a
 * run id (i.e. it is not a call result at all).
 */
export function extractDograhEvent(
  body: Record<string, unknown>,
  headers?: HeaderReader
): DograhCallEvent | null {
  const initial = asContext(body.initial_context ?? body.initialContext);
  const gathered = asContext(body.gathered_context ?? body.gatheredContext);
  const costInfo = asContext(body.cost_info ?? body.costInfo);

  const runId =
    firstString(
      body.workflow_run_id,
      body.run_id,
      body.call_id,
      headers?.get("x-dograh-workflow-run-id")
    ) || null;
  const deliveryId =
    firstString(body.delivery_id, headers?.get("x-dograh-delivery-id")) || null;

  const callerNumber = firstString(
    body.caller_number,
    initial.caller_number,
    body.from_number,
    body.from,
    body.caller
  );
  const calledNumber = firstString(
    body.called_number,
    initial.called_number,
    body.to_number,
    body.to,
    body.dialed_number
  );
  if (!callerNumber && !runId) return null;

  const disposition = firstString(
    body.mapped_call_disposition,
    gathered.mapped_call_disposition,
    body.call_disposition,
    gathered.call_disposition
  );
  const outcome = mapDispositionToOutcome(disposition);

  const durationSeconds = firstFiniteNumber(
    body.duration_seconds,
    body.duration,
    gathered.duration_seconds,
    costInfo.call_duration_seconds
  );
  const startedMs = parseTimestamp(body.call_time, body.started_at, body.created_at);
  const startedAt = new Date(startedMs ?? Date.now()).toISOString();
  const endedMs =
    parseTimestamp(body.call_ended_at, body.ended_at) ??
    (startedMs !== null && durationSeconds !== null
      ? startedMs + durationSeconds * 1000
      : null);

  const customerName =
    firstString(
      body.customer_name,
      gathered.customer_name,
      gathered.caller_name,
      gathered.appointment_name,
      gathered.name
    ) || null;

  return {
    deliveryId,
    runId,
    workflowName:
      firstString(body.workflow_name, body.workflow_id) ||
      headers?.get("x-dograh-workflow-id") ||
      null,
    direction: (firstString(body.direction, initial.direction) || "inbound").toLowerCase(),
    callerNumber,
    calledNumber,
    disposition,
    outcome,
    callStatus: deriveCallStatus(outcome, disposition, durationSeconds),
    startedAt,
    endedAt: endedMs !== null ? new Date(endedMs).toISOString() : null,
    durationSeconds,
    recordingUrl: firstString(body.recording_url) || null,
    transcriptUrl: firstString(body.transcript_url) || null,
    transcriptText: flattenTranscript(
      typeof body.transcript === "string" ? body.transcript : null
    ),
    customerName,
    calendarEventId:
      firstString(
        body.calendar_event_id,
        gathered.calendar_event_id,
        gathered.google_event_id,
        gathered.gcal_event_id
      ) || null,
  };
}

/* ------------------------------ authentication ----------------------------- */

export function dograhWebhookSecret(): string {
  return normalizeEnvValue(process.env.DOGRAH_WEBHOOK_SECRET);
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secretsMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(sha256(provided), sha256(expected));
}

/**
 * Accepted secret placements (all compared against DOGRAH_WEBHOOK_SECRET):
 * 1. `X-Callflow-Secret` custom header (Dograh webhook nodes support custom
 *    headers verbatim),
 * 2. `Authorization: Bearer <secret>` (Dograh credential binding),
 * 3. `?key=<secret>` query param (works with any configuration).
 * When DOGRAH_WEBHOOK_SECRET is unset the endpoint is open — same convention
 * as APP_AUTH_TOKEN, convenient for the first pilot smoke tests.
 */
export function isDograhRequestAuthorized(
  headers: HeaderReader,
  searchParams: URLSearchParams
): boolean {
  const secret = dograhWebhookSecret();
  if (!secret) return true;

  const bearer = headers.get("authorization") ?? "";
  const bearerToken = /^bearer\s+(.+)$/i.exec(bearer.trim())?.[1]?.trim() ?? "";
  const provided = firstString(
    headers.get("x-callflow-secret"),
    bearerToken,
    searchParams.get("key")
  );
  return provided ? secretsMatch(provided, secret) : false;
}



