import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildDograhFixture, type DograhFixtureName } from "./dograh-fixtures";
import { handleDograhWebhook } from "./dograh-webhook";

/**
 * End-to-end ingestion tests: real SQLite (temp DATABASE_PATH), real matcher,
 * real fixtures. Firebase is never contacted (no FCM token row / no service
 * account), and transcript URL fetches are stubbed — no network at all.
 */

let tmpDir = "";
const noFetch = async () => null;

function fire(
  name: DograhFixtureName,
  overrides?: Parameters<typeof buildDograhFixture>[1]
) {
  const fixture = buildDograhFixture(name, overrides);
  return {
    fixture,
    result: handleDograhWebhook({
      body: fixture.payload,
      headers: new Headers(fixture.headers),
      fetchTranscript: noFetch,
    }),
  };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "callflow-dograh-"));
  process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
  delete process.env.DOGRAH_WEBHOOK_SECRET;
  delete process.env.PLIVO_NUMBER;

  const { createBusiness } = await import("./db");
  await createBusiness({
    phoneNumber: "+15550001111",
    carrier: "other",
    forwardingStatus: "active",
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
  });
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
});

describe("handleDograhWebhook — happy path", () => {
  it("stores a booked call, matches the sole pilot business, reports push skip", async () => {
    const { fixture, result } = fire("booked");
    const res = await result;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      duplicate: false,
      matchedBusiness: true,
      outcome: "booked",
    });
    expect(res.body.push).toEqual({ sent: false, error: "No FCM token configured" });

    const { getCallByDograhRunId } = await import("./db");
    const runId = fixture.payload.workflow_run_id as string;
    const call = await getCallByDograhRunId(runId);
    expect(call).not.toBeNull();
    expect(call).toMatchObject({
      callerNumber: "+15550000123",
      businessNumber: "+15559998888",
      callStatus: "answered",
      outcome: "booked",
      durationSeconds: 184,
      customerName: "Priya Raman",
      calendarEventId: "evt_fixture_9f2c",
    });
    expect(call!.dograhDeliveryId).toBeTruthy();
    expect(call!.transcriptUrl).toContain("/transcript");
  });

  it("is idempotent across retries with the same or a new delivery id", async () => {
    const runId = "dup-run-1";
    const first = buildDograhFixture("callback", { workflow_run_id: runId });
    const firstRes = await handleDograhWebhook({
      body: first.payload,
      headers: new Headers(first.headers),
      fetchTranscript: noFetch,
    });
    expect(firstRes.body.duplicate).toBe(false);

    // Dograh regenerates the delivery id on retries but keeps the run id.
    const second = buildDograhFixture("callback", { workflow_run_id: runId });
    const replayed = await handleDograhWebhook({
      body: second.payload,
      headers: new Headers(second.headers),
      fetchTranscript: noFetch,
    });
    expect(replayed.status).toBe(200);
    expect(replayed.body).toMatchObject({ ok: true, duplicate: true });
    expect(replayed.body.callId).toEqual(firstRes.body.callId);

    const { getCalls } = await import("./db");
    const rows = (await getCalls()).filter((c) => c.dograhRunId === runId);
    expect(rows).toHaveLength(1);
  });

  it("persists an inline voicemail transcript", async () => {
    const res = await fire("voicemail").result;
    expect(res.body).toMatchObject({ ok: true, outcome: "voicemail" });
    const { getCalls } = await import("./db");
    const row = (await getCalls()).find((c) => c.outcome === "voicemail");
    expect(row!.callStatus).toBe("voicemail_left");
    expect(row!.transcript).toContain("Sam");
    expect(row!.customerName).toBe("Sam Torres");
  });

  it("flattens a transcript fetched from the Dograh public URL", async () => {
    const fixture = buildDograhFixture("handled");
    const res = await handleDograhWebhook({
      body: fixture.payload,
      headers: new Headers(fixture.headers),
      fetchTranscript: async () =>
        JSON.stringify([
          { role: "user", text: "What are your hours?" },
          { role: "agent", text: "Nine to five weekdays." },
        ]),
    });
    expect(res.body.transcriptStored).toBe(true);
    const { getCallByDograhRunId } = await import("./db");
    const row = await getCallByDograhRunId(fixture.payload.workflow_run_id as string);
    expect(row!.transcript).toBe(
      "Caller: What are your hours?\nAgent: Nine to five weekdays."
    );
  });
});

describe("handleDograhWebhook — rejection paths", () => {
  it("400s on non-object payloads and payloads with no caller or run id", async () => {
    const badBody = await handleDograhWebhook({
      body: "not-an-object",
      headers: new Headers(),
    });
    expect(badBody.status).toBe(400);

    const empty = await handleDograhWebhook({
      body: { junk: true },
      headers: new Headers(),
    });
    expect(empty.status).toBe(400);
  });

  it("401s without the secret once DOGRAH_WEBHOOK_SECRET is set", async () => {
    process.env.DOGRAH_WEBHOOK_SECRET = "fixture-secret";
    try {
      const fixture = buildDograhFixture("booked");
      const unauthorized = await handleDograhWebhook({
        body: fixture.payload,
        headers: new Headers(fixture.headers),
      });
      expect(unauthorized.status).toBe(401);

      const authorized = await handleDograhWebhook({
        body: fixture.payload,
        headers: new Headers({
          ...fixture.headers,
          "x-callflow-secret": "fixture-secret",
        }),
        fetchTranscript: noFetch,
      });
      expect(authorized.status).toBe(200);
      expect(authorized.body.duplicate).toBe(false);
    } finally {
      delete process.env.DOGRAH_WEBHOOK_SECRET;
    }
  });

  it("503s every request in production when DOGRAH_WEBHOOK_SECRET is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const fixture = buildDograhFixture("booked");
      const closed = await handleDograhWebhook({
        body: fixture.payload,
        headers: new Headers({
          ...fixture.headers,
          "x-callflow-secret": "anything",
        }),
        fetchTranscript: noFetch,
      });
      expect(closed.status).toBe(503);
      expect(closed.body.error).toMatch(/secret not configured/);

      // Nothing was persisted — the fail-closed path runs before any write.
      const { getCallByDograhRunId } = await import("./db");
      const row = await getCallByDograhRunId(
        fixture.payload.workflow_run_id as string
      );
      expect(row).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("records calls for an unknown number without matching a business", async () => {
    // Two businesses now exist → the sole-business fallback is disabled and
    // the Plivo number is unset, so unknown numbers land unmatched while an
    // exact businesses.phone_number hit still matches directly.
    const { createBusiness } = await import("./db");
    await createBusiness({
      phoneNumber: "+15550002222",
      carrier: "other",
      forwardingStatus: "active",
      lastVerifiedAt: null,
      pendingVerificationFor: null,
      pendingVerificationExpiresAt: null,
    });

    const directFixture = buildDograhFixture("booked", {
      called_number: "+15550002222",
    });
    const direct = await handleDograhWebhook({
      body: directFixture.payload,
      headers: new Headers(directFixture.headers),
      fetchTranscript: noFetch,
    });
    expect(direct.body).toMatchObject({ ok: true, matchedBusiness: true });

    const unmatchedFixture = buildDograhFixture("unmatched");
    const unmatched = await handleDograhWebhook({
      body: unmatchedFixture.payload,
      headers: new Headers(unmatchedFixture.headers),
      fetchTranscript: noFetch,
    });
    expect(unmatched.status).toBe(200);
    expect(unmatched.body).toMatchObject({ ok: true, matchedBusiness: false });

    const { getCallByDograhRunId } = await import("./db");
    const row = await getCallByDograhRunId(
      unmatchedFixture.payload.workflow_run_id as string
    );
    expect(row!.businessId).toBeNull();
    expect(row!.businessNumber).toBe("+19998887777");
  });
});

describe("handleDograhWebhook — push token lifecycle", () => {
  function fireWithPush(runId: string, sendPush: NonNullable<Parameters<typeof handleDograhWebhook>[0]["sendPush"]>) {
    const fixture = buildDograhFixture("callback", { workflow_run_id: runId });
    return handleDograhWebhook({
      body: fixture.payload,
      headers: new Headers(fixture.headers),
      fetchTranscript: noFetch,
      sendPush,
    });
  }

  it("keeps the token on transient failures and successful sends", async () => {
    const { saveSettings, getBusinessFcmToken } = await import("./db");
    await saveSettings({
      missedCallReplyTemplate: "tpl",
      fcmToken: "device-token-1",
    });

    const flaky = await fireWithPush("push-transient-1", async () => ({
      sent: false,
      error: "FCM service unavailable",
    }));
    expect(flaky.status).toBe(200);
    expect(flaky.body).toMatchObject({ pushTokenCleared: false });
    expect(await getBusinessFcmToken()).toBe("device-token-1");

    const ok = await fireWithPush("push-success-1", async () => ({
      sent: true,
      messageId: "projects/callflow/messages/mid-1",
    }));
    expect(ok.body).toMatchObject({ pushTokenCleared: false });
    expect(ok.body.push).toEqual({
      sent: true,
      messageId: "projects/callflow/messages/mid-1",
    });
    expect(await getBusinessFcmToken()).toBe("device-token-1");
  });

  it("clears the stored token when FCM reports it unregistered, then skips push", async () => {
    const { saveSettings, getBusinessFcmToken } = await import("./db");
    await saveSettings({
      missedCallReplyTemplate: "tpl",
      fcmToken: "device-token-dead",
    });

    let attemptedToken: string | null = null;
    const dead = await fireWithPush("push-dead-1", async (token) => {
      attemptedToken = token;
      // What firebase-admin's FcmError maps to for messaging/unregistered.
      return {
        sent: false,
        error: "Registration token is not registered",
        invalidToken: true,
      };
    });
    expect(dead.status).toBe(200);
    expect(attemptedToken).toBe("device-token-dead");
    expect(dead.body).toMatchObject({ pushTokenCleared: true });
    expect(await getBusinessFcmToken()).toBe("");

    // Next delivery takes the no-token path — sendPush is never called again.
    const next = buildDograhFixture("callback", { workflow_run_id: "push-dead-2" });
    const after = await handleDograhWebhook({
      body: next.payload,
      headers: new Headers(next.headers),
      fetchTranscript: noFetch,
      sendPush: async () => {
        throw new Error("sendPush must not be called after the token was cleared");
      },
    });
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({
      pushTokenCleared: false,
      push: { sent: false, error: "No FCM token configured" },
    });
  });
});

