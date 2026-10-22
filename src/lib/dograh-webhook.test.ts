import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildDograhFixture, type DograhFixtureName } from "./dograh-fixtures";
import type { CallAlertEmailInput, EmailSendResult } from "./email";
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
      dograhDisposition: "appointment_booked",
      outcome: "booked",
      durationSeconds: 184,
      customerName: "Priya Raman",
      calendarEventId: "evt_fixture_9f2c",
    });
    expect(call!.dograhDeliveryId).toBeTruthy();
    expect(call!.transcriptUrl).toContain("/transcript");
  });

  it("ingests the minimal contract payload (call_id) and falls back the callback number", async () => {
    const payload = {
      call_id: "731013",
      workflow_id: "11658",
      caller_number: "+15551234567",
      caller_name: "Alex",
      callback_number: "",
      reason: "Burst main pipe causing water leakage in kitchen",
      urgency: "emergency",
      duration: "78",
      recording_url: "https://rec.example/731013",
      transcript_url: "https://tr.example/731013",
    };
    const fireContract = () =>
      handleDograhWebhook({
        body: payload,
        headers: new Headers({ "content-type": "application/json" }),
        fetchTranscript: noFetch,
      });

    const first = await fireContract();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, duplicate: false });

    const { getCallByDograhRunId } = await import("./db");
    const row = await getCallByDograhRunId("731013");
    expect(row).toMatchObject({
      dograhRunId: "731013",
      callerNumber: "+15551234567",
      customerName: "Alex",
      // callback_number was empty → stored as the caller number instead.
      callbackNumber: "+15551234567",
      serviceRequested: "Burst main pipe causing water leakage in kitchen",
      urgency: "emergency",
      durationSeconds: 78,
    });

    // Same call_id redelivered (Dograh retry): stored once, still 200.
    const replay = await fireContract();
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ ok: true, duplicate: true });
    expect(replay.body.callId).toEqual(first.body.callId);
  });

  it("sends the pilot notification text: urgency, name, reason, callback number", async () => {
    const { saveSettings } = await import("./db");
    await saveSettings({
      missedCallReplyTemplate: "tpl",
      fcmToken: "device-token-text",
    });

    const captured = { title: "", body: "" };
    const payload = {
      call_id: "731014",
      workflow_id: "11658",
      caller_number: "+15551234567",
      caller_name: "Alex",
      callback_number: "+15557654321",
      reason: "Burst main pipe causing water leakage in kitchen",
      urgency: "emergency",
      duration: "78",
      call_disposition: "callback_requested",
      mapped_call_disposition: "callback_requested",
    };
    const res = await handleDograhWebhook({
      body: payload,
      headers: new Headers({ "content-type": "application/json" }),
      fetchTranscript: noFetch,
      sendPush: async (_token, title, body) => {
        captured.title = title;
        captured.body = body;
        return { sent: true, messageId: "m-text-1" };
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.push).toMatchObject({ sent: true });
    expect(captured.title).toBe("📞 Callback requested");
    expect(captured.body).toBe(
      "emergency call from Alex: Burst main pipe causing water leakage in kitchen. Call back: +15557654321"
    );
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

  it("links a call to the sole business even when called_number matches nothing", async () => {
    // Pilot fallback: with a single business, a called_number that matches no
    // row still links rather than orphaning the call (and the row keeps the
    // dialled number for later re-linking/debugging).
    const fixture = buildDograhFixture("unmatched", { workflow_run_id: "731500" });
    const res = await handleDograhWebhook({
      body: fixture.payload,
      headers: new Headers(fixture.headers),
      fetchTranscript: noFetch,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, matchedBusiness: true });

    const { getAllBusinesses, getCallByDograhRunId } = await import("./db");
    const sole = (await getAllBusinesses())[0];
    const row = await getCallByDograhRunId("731500");
    expect(row!.businessId).toBe(sole.id);
    expect(row!.businessNumber).toBe("+19998887777");
  });

  it("records calls for an unknown number without matching a business", async () => {
    // Two businesses exist → the sole-business fallback is disabled, so a
    // called_number that hits no businesses.phoneNumber lands unmatched while
    // an exact hit still matches directly.
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
    // Raw disposition survives even when the mapped outcome is "other" —
    // this is what makes a real-world mapping miss diagnosable from the DB.
    expect(row!.dograhDisposition).toBe("unknown");
    expect(row!.outcome).toBe("other");
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

describe("handleDograhWebhook — email alert", () => {
  const OWNER_EMAIL = "owner-alert@example.com";

  function stubSmtp() {
    vi.stubEnv("SMTP_HOST", "smtp.test.local");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_USER", "alerts@test.local");
    vi.stubEnv("SMTP_PASS", "test-pass");
    vi.stubEnv("SMTP_FROM", "Callflow <alerts@test.local>");
  }

  async function saveOwnerEmail(email: string | null) {
    const { getBusinessByPhone, updateBusiness } = await import("./db");
    const business = await getBusinessByPhone("+15550001111");
    if (!business) throw new Error("pilot business missing");
    await updateBusiness(business.id, { notificationEmail: email });
  }

  function fireWithEmail(
    name: DograhFixtureName,
    runId: string,
    sendEmail: NonNullable<Parameters<typeof handleDograhWebhook>[0]["sendEmail"]>
  ) {
    // Dial the pilot's own number: by the time these tests run, a second
    // business exists, so the single-business fallback in matchDograhBusiness
    // no longer applies and the call must match directly to reach the email.
    const fixture = buildDograhFixture(name, {
      workflow_run_id: runId,
      called_number: "+15550001111",
    });
    return handleDograhWebhook({
      body: fixture.payload,
      headers: new Headers(fixture.headers),
      fetchTranscript: noFetch,
      sendEmail,
    });
  }

  afterEach(async () => {
    await saveOwnerEmail(null);
    vi.unstubAllEnvs();
  });

  it("emails the saved business address on a NEW call and never on the duplicate retry", async () => {
    stubSmtp();
    await saveOwnerEmail(OWNER_EMAIL);
    const sendEmail =
      vi.fn<(input: CallAlertEmailInput, to: string) => Promise<EmailSendResult>>(
        async () => ({ sent: true, messageId: "mid-email-1" })
      );

    const first = await fireWithEmail("callback", "email-new-1", sendEmail);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, duplicate: false });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [input, to] = sendEmail.mock.calls[0];
    expect(to).toBe(OWNER_EMAIL);
    expect(input).toMatchObject({
      name: "Priya Raman",
      urgency: "Urgent — water spreading, customer mopping",
      callbackNumber: "+15550000123",
      dashboardUrl: "http://localhost:3000/calls",
    });
    expect(first.body.email).toEqual({ sent: true, messageId: "mid-email-1" });

    // Same run again → the duplicate path returned before this code runs.
    const sendEmailAgain =
      vi.fn<(input: CallAlertEmailInput, to: string) => Promise<EmailSendResult>>(
        async () => ({ sent: true, messageId: "mid-email-2" })
      );
    const retry = await fireWithEmail("callback", "email-new-1", sendEmailAgain);
    expect(retry.body).toMatchObject({ duplicate: true });
    expect(sendEmailAgain).not.toHaveBeenCalled();
  });

  it("passes an emergency urgency through for the EMERGENCY subject", async () => {
    stubSmtp();
    await saveOwnerEmail(OWNER_EMAIL);
    const sendEmail =
      vi.fn<(input: CallAlertEmailInput, to: string) => Promise<EmailSendResult>>(
        async () => ({ sent: true, messageId: "mid-email-3" })
      );
    const fixture = buildDograhFixture("callback", {
      workflow_run_id: "email-emergency-1",
      called_number: "+15550001111",
    });
    const payload = {
      ...fixture.payload,
      caller_name: "Dana Reed",
      urgency: "emergency",
    };
    const result = await handleDograhWebhook({
      body: payload,
      headers: new Headers(fixture.headers),
      fetchTranscript: noFetch,
      sendEmail,
    });
    expect(result.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      name: "Dana Reed",
      urgency: "emergency",
      reason: "Water heater leaking in the garage",
    });
  });

  it("keeps the webhook at 200 when the email send fails", async () => {
    stubSmtp();
    await saveOwnerEmail(OWNER_EMAIL);
    const sendEmail =
      vi.fn<(input: CallAlertEmailInput, to: string) => Promise<EmailSendResult>>(
        async () => {
          throw new Error("SMTP connection refused");
        }
      );
    const result = await fireWithEmail("booked", "email-fail-1", sendEmail);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, duplicate: false });
    expect(result.body.email).toEqual({
      sent: false,
      error: "SMTP connection refused",
    });
  });

  it("skips with a warning when the business has no email saved", async () => {
    stubSmtp();
    const sendEmail =
      vi.fn<(input: CallAlertEmailInput, to: string) => Promise<EmailSendResult>>(
        async () => ({ sent: true, messageId: "mid-email-4" })
      );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await fireWithEmail("booked", "email-noaddr-1", sendEmail);
    expect(result.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.body.email).toEqual({
      sent: false,
      error: "No notification email saved",
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Email alert skipped"));
    warn.mockRestore();
  });

  it("skips when the SMTP environment variables are missing", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_PORT", "");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASS", "");
    vi.stubEnv("SMTP_FROM", "");
    await saveOwnerEmail(OWNER_EMAIL);
    const sendEmail =
      vi.fn<(input: CallAlertEmailInput, to: string) => Promise<EmailSendResult>>(
        async () => ({ sent: true, messageId: "mid-email-5" })
      );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await fireWithEmail("booked", "email-nosmtp-1", sendEmail);
    expect(result.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
    expect((result.body.email as { error?: string }).error).toContain(
      "SMTP not configured"
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SMTP"));
    warn.mockRestore();
  });
});

