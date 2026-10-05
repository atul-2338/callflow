import { generateKeyPairSync, sign } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTelnyxEvent, transferCall, verifyTelnyxSignature } from "./telnyx";

/**
 * The test recomputes the signature with the documented algorithm (Ed25519
 * over `timestamp|body`, hex-encoded) and asserts the verifier agrees — and
 * rejects tampered/stale inputs.
 */

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
const PUBLIC_KEY_HEX = publicKeyDer.subarray(publicKeyDer.length - 32).toString("hex");

const BODY = JSON.stringify({
  data: {
    record_type: "event",
    event_type: "call.initiated",
    id: "0ccc7b54-4df3-4bca-a65a-3da1ecc777f0",
    occurred_at: "2018-02-02T22:25:27.521992Z",
    payload: {
      call_control_id: "v2:T02llQxIyaRkhfRKxgAP8nY511EhFLizdvdUKJiSw8d6A9BborherQ",
      connection_id: "7267xxxxxxxxxxxxxx",
      call_leg_id: "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
      call_session_id: "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
      from: "+15550001111",
      to: "+18885459969",
      direction: "inbound",
      state: "initiated",
    },
  },
});

function signPayload(timestamp: string, body: string): string {
  return sign(null, Buffer.from(`${timestamp}|${body}`, "utf8"), privateKey).toString("hex");
}

const NOW = Math.floor(Date.now() / 1000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("verifyTelnyxSignature", () => {
  it("accepts a signature computed over timestamp|body", () => {
    vi.stubEnv("TELNYX_PUBLIC_KEY", PUBLIC_KEY_HEX);
    const timestamp = String(NOW);
    const signature = signPayload(timestamp, BODY);
    expect(verifyTelnyxSignature({ body: BODY, signature, timestamp })).toBe(true);
  });

  it("rejects a tampered body", () => {
    vi.stubEnv("TELNYX_PUBLIC_KEY", PUBLIC_KEY_HEX);
    const timestamp = String(NOW);
    const signature = signPayload(timestamp, BODY);
    expect(
      verifyTelnyxSignature({
        body: BODY.replace("+15550001111", "+15550002222"),
        signature,
        timestamp,
      })
    ).toBe(false);
  });

  it("rejects a tampered timestamp", () => {
    vi.stubEnv("TELNYX_PUBLIC_KEY", PUBLIC_KEY_HEX);
    const signature = signPayload(String(NOW), BODY);
    expect(
      verifyTelnyxSignature({ body: BODY, signature, timestamp: String(NOW + 1) })
    ).toBe(false);
  });

  it("rejects a stale timestamp outside the 5-minute replay window", () => {
    vi.stubEnv("TELNYX_PUBLIC_KEY", PUBLIC_KEY_HEX);
    const stale = String(NOW - 6 * 60);
    const signature = signPayload(stale, BODY);
    expect(verifyTelnyxSignature({ body: BODY, signature, timestamp: stale })).toBe(false);
  });

  it("rejects a missing signature or timestamp when configured", () => {
    vi.stubEnv("TELNYX_PUBLIC_KEY", PUBLIC_KEY_HEX);
    expect(
      verifyTelnyxSignature({ body: BODY, signature: null, timestamp: String(NOW) })
    ).toBe(false);
    expect(
      verifyTelnyxSignature({ body: BODY, signature: "abc", timestamp: null })
    ).toBe(false);
  });

  it("is open when TELNYX_PUBLIC_KEY is unset (local dev)", () => {
    vi.stubEnv("TELNYX_PUBLIC_KEY", "");
    expect(verifyTelnyxSignature({ body: BODY, signature: null, timestamp: null })).toBe(true);
  });
});
describe("parseTelnyxEvent", () => {
  it("parses a call.initiated envelope", () => {
    const event = parseTelnyxEvent(BODY);
    expect(event).toMatchObject({
      eventType: "call.initiated",
      eventId: "0ccc7b54-4df3-4bca-a65a-3da1ecc777f0",
      callControlId: "v2:T02llQxIyaRkhfRKxgAP8nY511EhFLizdvdUKJiSw8d6A9BborherQ",
      callLegId: "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
      callSessionId: "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
      from: "+15550001111",
      to: "+18885459969",
      direction: "inbound",
      state: "initiated",
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parseTelnyxEvent("not json")).toBeNull();
  });

  it("returns null for a payload without a data envelope", () => {
    expect(parseTelnyxEvent(JSON.stringify({ hello: "world" }))).toBeNull();
  });
});

describe("transferCall", () => {
  it("POSTs to the transfer endpoint with Bearer auth and the right body", async () => {
    vi.stubEnv("TELNYX_API_KEY", "test-api-key");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { result: "ok" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transferCall("call-1", "+15550009999", "+15550001111", "transfer-evt-1");

    expect(result).toEqual({ ok: true, result: "ok" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telnyx.com/v2/calls/call-1/actions/transfer",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
        },
        body: JSON.stringify({
          to: "+15550009999",
          from: "+15550001111",
          command_id: "transfer-evt-1",
          timeout_secs: 30,
        }),
      })
    );
  });

  it("returns the API error detail on a non-2xx response", async () => {
    vi.stubEnv("TELNYX_API_KEY", "test-api-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          errors: [{ detail: "The 'to' parameter must be in E164 format." }],
        }),
      }))
    );

    const result = await transferCall("call-1", "not-a-number", "+15550001111", "cmd-1");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("The 'to' parameter must be in E164 format.");
  });

  it("fails fast when TELNYX_API_KEY is unset", async () => {
    vi.stubEnv("TELNYX_API_KEY", "");
    const result = await transferCall("call-1", "+15550009999", "+15550001111", "cmd-1");
    expect(result).toEqual({ ok: false, error: "TELNYX_API_KEY is not configured." });
  });
});

