import { randomInt } from "crypto";
import { getPlivoConfig, isPlivoConfigured } from "./plivo";

/**
 * SMS sending via the Plivo Message API (Phase 5 — SMS forwarding
 * verification). Plivo is already the telephony provider, so no new vendor is
 * introduced. Sending from a US number requires the carrier-side registration
 * (toll-free verification / 10DLC) documented in README; until then the
 * endpoint reports a clear configuration error instead of failing silently.
 */

export interface SmsResult {
  ok: boolean;
  messageUuid?: string;
  error?: string;
}

export function isSmsConfigured(): boolean {
  return isPlivoConfigured();
}

/**
 * Send a one-way SMS via Plivo's Message API.
 * https://www.plivo.com/docs/messaging/api/message#send-a-message
 */
export async function sendSms(to: string, text: string): Promise<SmsResult> {
  const { authId, authToken, number } = getPlivoConfig();
  if (!authId || !authToken || !number) {
    return {
      ok: false,
      error:
        "SMS is not configured. Set PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, and PLIVO_NUMBER in .env.local.",
    };
  }

  const endpoint = `https://api.plivo.com/v1/Account/${authId}/Message/`;
  const auth = Buffer.from(`${authId}:${authToken}`).toString("base64");

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        src: number,
        dst: to,
        text,
        type: "sms",
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      message_uuid?: string;
      error?: string;
      api_id?: string;
    };

    if (!res.ok) {
      return { ok: false, error: data.error || `Plivo SMS HTTP ${res.status}` };
    }

    return { ok: true, messageUuid: data.message_uuid };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Plivo SMS failed",
    };
  }
}

/**
 * Generate a 6-digit numeric verification code (leading zeros allowed).
 * Uses the OS CSPRNG (`crypto.randomInt`), NOT Math.random() — this code is
 * the only thing standing between an attacker and activating forwarding on a
 * business they don't own, so it must be unpredictable.
 */
export function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
