import { createPublicKey, verify, type KeyObject } from "crypto";
import { normalizeEnvValue } from "./util.ts";

/**
 * Telnyx Call Control integration — the inbound call-forwarding path.
 *
 * Flow: a business's carrier forwards missed calls to the Telnyx number.
 * Telnyx POSTs a `call.initiated` webhook to
 * /api/v1/telephony/telnyx/answer; after the Ed25519 signature is verified,
 * the call is transferred to the Dograh agent number (TELNYX_FORWARD_TO) via
 * the Call Control API, with the original caller's number as the caller ID.
 */

export interface TelnyxConfig {
  apiKey: string;
  publicKey: string;
  number: string;
  forwardTo: string;
}

export function getTelnyxConfig(): TelnyxConfig {
  return {
    apiKey: normalizeEnvValue(process.env.TELNYX_API_KEY),
    publicKey: normalizeEnvValue(process.env.TELNYX_PUBLIC_KEY),
    number: normalizeEnvValue(process.env.TELNYX_NUMBER),
    forwardTo: normalizeEnvValue(process.env.TELNYX_FORWARD_TO),
  };
}

export function isTelnyxConfigured(): boolean {
  const { apiKey, publicKey, number, forwardTo } = getTelnyxConfig();
  return Boolean(
    apiKey &&
      publicKey &&
      number &&
      forwardTo &&
      !apiKey.includes("PASTE") &&
      !publicKey.includes("PASTE") &&
      !number.includes("PASTE") &&
      !forwardTo.includes("PASTE")
  );
}

/* --------------------------- webhook signature --------------------------- */

export interface TelnyxSignatureInput {
  /** Raw request body, exactly as Telnyx sent it (never re-serialized). */
  body: string;
  /** `Telnyx-Signature-Ed25519` header value (hex). */
  signature: string | null;
  /** `Telnyx-Timestamp` header value (Unix seconds). */
  timestamp: string | null;
}

/** Reject webhooks older/newer than this many seconds (replay protection). */
const REPLAY_WINDOW_SECONDS = 5 * 60;

// SPKI DER prefix for an Ed25519 public key (OID 1.3.101.112 + BIT STRING).
// Node's createPublicKey needs a full SPKI structure; Telnyx hands out the
// raw 32-byte key, so the prefix is prepended before parsing.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function ed25519PublicKey(rawHex: string): KeyObject {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(rawHex, "hex")]),
    format: "der",
    type: "spki",
  });
}

/**
 * Verify Telnyx's Ed25519 webhook signature — the standardwebhooks pattern the
 * official SDK implements: the signed message is `timestamp|body`, the
 * signature is hex-encoded, and the timestamp must be within a 5-minute
 * window. When TELNYX_PUBLIC_KEY is unset (local dev) the check is skipped —
 * the same open-by-default convention as the other webhook secrets. The
 * answer route additionally fails closed in production (see its 503 guard).
 */
export function verifyTelnyxSignature(input: TelnyxSignatureInput): boolean {
  const { publicKey } = getTelnyxConfig();
  if (!publicKey) return true;
  if (!input.signature || !input.timestamp) return false;

  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > REPLAY_WINDOW_SECONDS) {
    return false;
  }

  try {
    return verify(
      null,
      Buffer.from(`${input.timestamp}|${input.body}`, "utf8"),
      ed25519PublicKey(publicKey),
      Buffer.from(input.signature, "hex")
    );
  } catch {
    return false;
  }
}

/* ------------------------------ event parsing ----------------------------- */

export interface TelnyxCallEvent {
  eventType: string;
  eventId: string;
  callControlId: string;
  callLegId: string;
  callSessionId: string;
  /** Original caller number (E.164) — used as the transfer's caller ID. */
  from: string;
  /** The Telnyx number the call arrived on (E.164). */
  to: string;
  direction: string;
  state: string;
}

/**
 * Parse a Voice API webhook envelope. Returns null for anything that is not a
 * well-formed `{ data: { event_type, id, payload } }` event.
 */
export function parseTelnyxEvent(body: string): TelnyxCallEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const data = (parsed as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data !== "object") return null;
  const payload = (data.payload ?? {}) as Record<string, unknown>;
  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  return {
    eventType: str(data.event_type),
    eventId: str(data.id),
    callControlId: str(payload.call_control_id),
    callLegId: str(payload.call_leg_id),
    callSessionId: str(payload.call_session_id),
    from: str(payload.from),
    to: str(payload.to),
    direction: str(payload.direction),
    state: str(payload.state),
  };
}

/* ------------------------------ call transfer ----------------------------- */

export interface TelnyxTransferResult {
  ok: boolean;
  /** Telnyx's command result (e.g. "ok") — the response carries no command id. */
  result?: string;
  error?: string;
}

/**
 * Transfer a call to a new destination via the Call Control API.
 * `commandId` makes Telnyx ignore duplicate commands (same id within 60
 * seconds), which is what makes retried webhook deliveries idempotent.
 */
export async function transferCall(
  callControlId: string,
  to: string,
  from: string,
  commandId: string
): Promise<TelnyxTransferResult> {
  const { apiKey } = getTelnyxConfig();
  if (!apiKey) {
    return { ok: false, error: "TELNYX_API_KEY is not configured." };
  }

  const endpoint = `https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/transfer`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to,
        from,
        command_id: commandId,
        timeout_secs: 30,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      data?: { result?: string };
      errors?: Array<{ detail?: string; title?: string }>;
    };

    if (!res.ok) {
      const detail = data.errors?.[0]?.detail || data.errors?.[0]?.title;
      return { ok: false, error: detail || `Telnyx HTTP ${res.status}` };
    }

    return { ok: true, result: data.data?.result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Telnyx transfer failed",
    };
  }
}

