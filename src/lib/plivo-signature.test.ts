import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyPlivoSignature } from "./plivo";

/**
 * The test recomputes the signature with the documented algorithm
 * (base64(hmac_sha256(authToken, fullUrl + nonce + sortedBodyParams))) and
 * asserts the verifier agrees — and rejects tampered inputs.
 */

const AUTH_TOKEN = "test-auth-token";
const URL = "https://callflow.biz/api/plivo/answer?businessId=biz_123";
const NONCE = "abc123nonce";

function sign(params: Record<string, string>, url = URL, nonce = NONCE): string {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return createHmac("sha256", AUTH_TOKEN).update(url + nonce + sorted).digest("base64");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyPlivoSignature", () => {
  it("accepts a signature computed over url + nonce + sorted body params", () => {
    vi.stubEnv("PLIVO_AUTH_TOKEN", AUTH_TOKEN);
    const params = { From: "+15550001111", To: "+18885459969", CallUUID: "call-1" };
    const signature = sign(params);
    expect(
      verifyPlivoSignature({ url: URL, signature, nonce: NONCE, params })
    ).toBe(true);
  });

  it("rejects a tampered body param", () => {
    vi.stubEnv("PLIVO_AUTH_TOKEN", AUTH_TOKEN);
    const params = { From: "+15550001111", To: "+18885459969", CallUUID: "call-1" };
    const signature = sign(params);
    expect(
      verifyPlivoSignature({
        url: URL,
        signature,
        nonce: NONCE,
        params: { ...params, CallUUID: "call-2" },
      })
    ).toBe(false);
  });

  it("rejects a tampered URL (different businessId)", () => {
    vi.stubEnv("PLIVO_AUTH_TOKEN", AUTH_TOKEN);
    const params = { From: "+15550001111" };
    const signature = sign(params);
    expect(
      verifyPlivoSignature({
        url: "https://callflow.biz/api/plivo/answer?businessId=biz_evil",
        signature,
        nonce: NONCE,
        params,
      })
    ).toBe(false);
  });

  it("rejects a missing signature or nonce when configured", () => {
    vi.stubEnv("PLIVO_AUTH_TOKEN", AUTH_TOKEN);
    const params = { From: "+15550001111" };
    expect(
      verifyPlivoSignature({ url: URL, signature: null, nonce: NONCE, params })
    ).toBe(false);
    expect(
      verifyPlivoSignature({ url: URL, signature: "abc", nonce: null, params })
    ).toBe(false);
  });

  it("is open when PLIVO_AUTH_TOKEN is unset (local dev)", () => {
    vi.stubEnv("PLIVO_AUTH_TOKEN", "");
    expect(
      verifyPlivoSignature({ url: URL, signature: null, nonce: null, params: {} })
    ).toBe(true);
  });
});
