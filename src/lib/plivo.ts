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
