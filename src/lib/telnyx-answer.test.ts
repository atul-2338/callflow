import fs from "fs";
import os from "os";
import path from "path";
import { generateKeyPairSync, sign } from "crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Route-level tests for POST /api/v1/telephony/telnyx/answer.
 *
 * Real SQLite (temp DATABASE_PATH), real Ed25519 signatures (the same
 * documented algorithm src/lib/telnyx.ts implements), and the real
 * transferCall over a stubbed global fetch. Covers the transfer-confirmed
 * forwarding status: a transfer Telnyx accepts (200 OK) flips the attributed
 * business (Dograh convention) to "active"; a failed transfer answers 500 and
 * leaves the status "pending".
 */

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
const PUBLIC_KEY_HEX = publicKeyDer.subarray(publicKeyDer.length - 32).toString("hex");

/** The Telnyx number the simulated calls arrive on (the dialled DID). */
const DIALED_DID = "+18885459969";
const CALLER = "+15550007777";
const PILOT_NUMBER = "+15550001111";
const AGENT_NUMBER = "+15550009999";

let tmpDir = "";
let POST: (request: Request) => Promise<Response>;
let eventId = 0;

function buildEventBody(
  overrides?: { to?: string; eventType?: string }
): Record<string, unknown> {
  eventId += 1;
  return {
    data: {
      record_type: "event",
      event_type: overrides?.eventType ?? "call.initiated",
      id: `evt-${eventId}`,
      occurred_at: new Date().toISOString(),
      payload: {
        call_control_id: `v2:test-${eventId}`,
        call_leg_id: `leg-${eventId}`,
        call_session_id: `session-${eventId}`,
        from: CALLER,
        to: overrides?.to ?? DIALED_DID,
        direction: "inbound",
        state: "initiated",
      },
    },
  };
}

function signedRequest(body: unknown): Request {
  const bodyText = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(
    null,
    Buffer.from(`${timestamp}|${bodyText}`, "utf8"),
    privateKey
  ).toString("hex");
  return new Request("http://localhost/api/v1/telephony/telnyx/answer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Telnyx-Signature-Ed25519": signature,
      "Telnyx-Timestamp": timestamp,
    },
    body: bodyText,
  });
}

/** Stub the Telnyx transfer API: ok=true → 200 {result:"ok"}, else 500. */
function stubTelnyxTransfer(ok: boolean) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => (ok ? { data: { result: "ok" } } : {}),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function pilotBusiness() {
  const { getBusinessByPhone } = await import("./db");
  const business = await getBusinessByPhone(PILOT_NUMBER);
  if (!business) throw new Error("pilot business missing");
  return business;
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "callflow-telnyx-answer-"));
  process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
  process.env.TELNYX_PUBLIC_KEY = PUBLIC_KEY_HEX;
  process.env.TELNYX_API_KEY = "test-api-key";
  process.env.TELNYX_FORWARD_TO = AGENT_NUMBER;
  delete process.env.WEBHOOK_SECRET;

  ({ POST } = await import("@/app/api/v1/telephony/telnyx/answer/route"));

  const { createBusiness } = await import("./db");
  await createBusiness({
    phoneNumber: PILOT_NUMBER,
    carrier: "other",
    forwardingStatus: "pending",
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  const { getDb } = await import("./database");
  try {
    getDb().close();
  } catch {
    /* already closed */
  }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.DATABASE_PATH;
  delete process.env.TELNYX_PUBLIC_KEY;
  delete process.env.TELNYX_API_KEY;
  delete process.env.TELNYX_FORWARD_TO;
});

describe("telnyx answer route — transfer-confirmed forwarding", () => {
  it("flips the sole business to active after a transfer Telnyx accepts", async () => {
    const fetchMock = stubTelnyxTransfer(true);

    const res = await POST(signedRequest(buildEventBody()));
    expect(res.status).toBe(200);

    // The transfer command went to the agent with the caller as the caller ID
    // and the event-derived command id.
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.telnyx.com/v2/calls/${encodeURIComponent("v2:test-1")}/actions/transfer`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          to: AGENT_NUMBER,
          from: CALLER,
          command_id: "transfer-evt-1",
          timeout_secs: 30,
        }),
      })
    );

    // One business exists → the single-business fallback attributes the call
    // (the dialled DID matches nobody) and the successful transfer confirms it.
    const business = await pilotBusiness();
    expect(business.forwardingStatus).toBe("active");
    expect(business.lastVerifiedAt).not.toBeNull();
  });

  it("answers 500 and leaves forwarding_status pending when the transfer fails", async () => {
    // Reset: the previous test confirmed the pilot business.
    const { updateBusiness } = await import("./db");
    const reset = await pilotBusiness();
    await updateBusiness(reset.id, { forwardingStatus: "pending", lastVerifiedAt: null });

    stubTelnyxTransfer(false);

    const res = await POST(signedRequest(buildEventBody()));
    expect(res.status).toBe(500);

    const business = await pilotBusiness();
    expect(business.forwardingStatus).toBe("pending");
    expect(business.lastVerifiedAt).toBeNull();
  });

  it("confirms only the directly matched business when several exist", async () => {
    const { createBusiness, getBusinessByPhone } = await import("./db");
    await createBusiness({
      phoneNumber: DIALED_DID,
      carrier: "other",
      forwardingStatus: "pending",
      lastVerifiedAt: null,
      pendingVerificationFor: null,
      pendingVerificationExpiresAt: null,
    });

    stubTelnyxTransfer(true);

    // Dialled DID = the second business → direct match wins over everything.
    const res = await POST(signedRequest(buildEventBody()));
    expect(res.status).toBe(200);

    const direct = await getBusinessByPhone(DIALED_DID);
    expect(direct?.forwardingStatus).toBe("active");
    expect(direct?.lastVerifiedAt).not.toBeNull();

    const pilot = await pilotBusiness();
    expect(pilot.forwardingStatus).toBe("pending");
  });

  it("updates nothing when the call is unattributed (no match, several businesses)", async () => {
    stubTelnyxTransfer(true);

    // Dialled DID matches no business and two exist → fallback disabled.
    const res = await POST(signedRequest(buildEventBody({ to: "+19995550000" })));
    expect(res.status).toBe(200);

    const { getBusinessByPhone } = await import("./db");
    expect((await getBusinessByPhone(PILOT_NUMBER))?.forwardingStatus).toBe("pending");
    expect((await getBusinessByPhone(DIALED_DID))?.forwardingStatus).toBe("active");
  });

  it("acknowledges non-call.initiated events without transferring", async () => {
    const fetchMock = stubTelnyxTransfer(true);

    const res = await POST(signedRequest(buildEventBody({ eventType: "call.hangup" })));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a tampered payload with 403", async () => {
    const fetchMock = stubTelnyxTransfer(true);
    const bodyText = JSON.stringify(buildEventBody());
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(
      null,
      Buffer.from(`${timestamp}|${bodyText}`, "utf8"),
      privateKey
    ).toString("hex");
    const tampered = bodyText.replace(CALLER, "+15550008888");

    const res = await POST(
      new Request("http://localhost/api/v1/telephony/telnyx/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Telnyx-Signature-Ed25519": signature,
          "Telnyx-Timestamp": timestamp,
        },
        body: tampered,
      })
    );

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});