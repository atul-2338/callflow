import { createHmac, timingSafeEqual } from "crypto";
import { normalizeEnvValue } from "./util";

export interface PlivoConfig {
  authId: string;
  authToken: string;
  number: string;
}

export function getPlivoConfig(): PlivoConfig {
  return {
    authId: normalizeEnvValue(process.env.PLIVO_AUTH_ID),
    authToken: normalizeEnvValue(process.env.PLIVO_AUTH_TOKEN),
    number: normalizeEnvValue(process.env.PLIVO_NUMBER),
  };
}

export function isPlivoConfigured(): boolean {
  const { authId, authToken, number } = getPlivoConfig();
  return Boolean(
    authId && authToken && number &&
    !authId.includes("PASTE") && !authToken.includes("PASTE") && !number.includes("PASTE")
  );
}

/**
 * Public base URL of this app, used to build URLs that Plivo must reach (the
 * verification-call answer URL). Trailing slashes are stripped. Empty when
 * PUBLIC_BASE_URL is unset — callers should fail with a clear message.
 */
export function getPublicBaseUrl(): string {
  return normalizeEnvValue(process.env.PUBLIC_BASE_URL).replace(/\/+$/, "");
}

export interface PlivoSignatureInput {
  /** Full request URL including the query string, exactly as Plivo called it. */
  url: string;
  /** `X-Plivo-Signature-V2` header value. */
  signature: string | null;
  /** `X-Plivo-Signature-V2-Nonce` header value. */
  nonce: string | null;
  /** POST body params (form-encoded call details). */
  params: Record<string, string>;
}

/**
 * Verify Plivo's `X-Plivo-Signature-V2` header (the algorithm plivo-node's
 * `validateSignatureV2` implements):
 *
 *   baseString = fullUrl + nonce + sortedBodyParams
 *
 * where `sortedBodyParams` is every POST body param sorted by key and
 * concatenated as `key=value` (no separators), then
 *
 *   signature = base64(hmac_sha256(authToken, baseString))
 *
 * When PLIVO_AUTH_TOKEN is unset (local dev) the check is skipped — the same
 * open-by-default convention as the other webhook secrets. Production must set
 * it, otherwise the answer endpoint would accept forged verification calls.
 */
export function verifyPlivoSignature(input: PlivoSignatureInput): boolean {
  const { authToken } = getPlivoConfig();
  if (!authToken) return true;
  if (!input.signature || !input.nonce) return false;

  const sortedParams = Object.keys(input.params)
    .sort()
    .map((key) => `${key}${input.params[key]}`)
    .join("");
  const baseString = input.url + input.nonce + sortedParams;
  const expected = createHmac("sha256", authToken).update(baseString).digest("base64");
  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(input.signature);
  return (
    expectedBuf.length === receivedBuf.length &&
    timingSafeEqual(expectedBuf, receivedBuf)
  );
}

export interface PlivoCallResult {
  ok: boolean;
  requestUuid?: string;
  error?: string;
}

/**
 * Places an outbound call via the Plivo REST API.
 * The call is intentionally left to ring until it times out naturally.
 */
export async function placeVerificationCall(
  to: string,
  answerUrl: string
): Promise<PlivoCallResult> {
  const { authId, authToken, number } = getPlivoConfig();

  const endpoint = `https://api.plivo.com/v1/Account/${authId}/Call/`;
  const auth = Buffer.from(`${authId}:${authToken}`).toString("base64");

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        from: number,
        to,
        answer_url: answerUrl,
        answer_method: "POST",
        ring_timeout: 20,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      request_uuid?: string;
      error?: string;
      api_id?: string;
    };

    if (!res.ok) {
      return { ok: false, error: data.error || `Plivo HTTP ${res.status}` };
    }

    return { ok: true, requestUuid: data.request_uuid };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Plivo call failed",
    };
  }
}
