import { createHash, timingSafeEqual } from "crypto";
import { normalizeEnvValue } from "./util";

/**
 * Shared-secret gate + payload parsing for Dograh's workflow "send webhook"
 * node (POST /api/webhooks/dograh).
 *
 * Contract:
 * - The secret lives in the WEBHOOK_SECRET environment variable and must be
 *   presented in the `x-webhook-secret` request header. The header NAME is
 *   matched case-insensitively (see readHeaderSafe) so portal/proxy header
 *   casing rewrites can never cause a false 401. A wrong or missing secret —
 *   on either side — fails closed with 401.
 * - The body is a user-authored JSON template. Dograh's renderer stringifies
 *   EVERY value, so nested dicts (gathered.context, initial_context) can
 *   arrive as JSON-encoded strings and numbers as strings; the parser below
 *   accepts both shapes. Required: callId. Optional: status, duration,
 *   gathered.context.customer_name, caller_number / called_number (used to
 *   link the call to its business). Everything else is ignored.
 */

export type HeaderReader = { get(name: string): string | null };

/** Server-side shared secret for /api/webhooks/dograh (WEBHOOK_SECRET env). */
export function webhookSecret(): string {
  return normalizeEnvValue(process.env.WEBHOOK_SECRET);
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time comparison — sha256 first so differing lengths can never
 * leak through timingSafeEqual (which throws on length mismatch). */
export function secretsMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(sha256(provided), sha256(expected));
}

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
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** "x-webhook-secret" → "X-Webhook-Secret" (canonical HTTP title-casing). */
function toTitleCaseHeader(name: string): string {
  return name.replace(/(^|-)([a-z0-9])/g, (_match, separator: string, char: string) =>
    separator + char.toUpperCase()
  );
}

/**
 * Read a header value no matter how its NAME was cased on the wire.
 *
 * The web-standard `Headers` class is already case-insensitive — it lowercases
 * names internally, and proxies that rewrite casing in transit only ever make
 * names lowercase, so Fetch-based traffic always matches a lowercase lookup.
 * But `HeaderReader` is a structural contract: raw Node header records, test
 * mocks and some framework header bags implement `get()` with exact-match
 * (case-sensitive) semantics, where a title-case "X-Webhook-Secret" would miss
 * a lowercase key and vice versa — exactly the silent-401 class of failure.
 *
 * For each requested name, try every distinct spelling (exact, lowercase,
 * canonical title-case), swallowing per-lookup errors (a throwing get() must
 * never 500 the webhook), trimming whitespace, and collapsing the comma-joined
 * value Fetch produces for duplicated headers down to its first segment.
 */
export function readHeaderSafe(headers: HeaderReader, ...names: string[]): string {
  for (const name of names) {
    const spellings = new Set<string>([
      name,
      name.toLowerCase(),
      toTitleCaseHeader(name.toLowerCase()),
    ]);
    for (const spelling of spellings) {
      let raw: string | null;
      try {
        raw = headers.get(spelling);
      } catch {
        continue; // defensive: a hostile/broken reader falls through to the next spelling
      }
      if (typeof raw !== "string") continue;
      const value = raw.split(",")[0]?.trim() ?? "";
      if (value) return value;
    }
  }
  return "";
}

/** What Callflow extracts from a Dograh webhook body. */
export interface DograhWebhookPayload {
  /** Dograh's call identifier — the upsert key (one row per callId, ever). */
  callId: string;
  /** Raw status string as delivered ("" when the template sent none). */
  status: string;
  durationSeconds: number | null;
  customerName: string | null;
  callerNumber: string;
  calledNumber: string;
}

/**
 * Extract the webhook contract fields from a parsed JSON body. Returns null
 * when the body is not an object or carries no callId — the handler maps both
 * to 400. Extra fields are ignored.
 */
export function parseDograhWebhookBody(body: unknown): DograhWebhookPayload | null {
  if (!isPlainObject(body)) return null;
  const callId = firstString(
    body.callId,
    body.call_id,
    body.workflow_run_id,
    body.run_id
  );
  if (!callId) return null;

  // gathered.context.customer_name is the documented path; the template
  // renderer may stringify `gathered` itself, and older templates used
  // gathered_context or a flat customer_name — all are accepted.
  const gathered = asContext(body.gathered ?? body.gatheredContext);
  const gatheredContext = asContext(body.gathered_context ?? body.gatheredContext);
  const context = asContext(gathered.context);
  const customerName =
    firstString(
      context.customer_name,
      gathered.customer_name,
      gatheredContext.customer_name,
      body.customer_name,
      body.caller_name
    ) || null;

  const initial = asContext(body.initial_context ?? body.initialContext);
  return {
    callId,
    status: firstString(body.status, body.call_status),
    durationSeconds: firstFiniteNumber(body.duration, body.duration_seconds),
    customerName,
    callerNumber: firstString(body.caller_number, initial.caller_number),
    calledNumber: firstString(body.called_number, initial.called_number),
  };
}