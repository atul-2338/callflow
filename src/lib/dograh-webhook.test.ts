import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deliverOwnerPush,
  handleDograhWebhook,
  type OwnerPushPlan,
} from "./dograh-webhook";
import type { NotifyMissedCallResult } from "./firebase";

/**
 * End-to-end ingestion tests for POST /api/webhooks/dograh: real SQLite (temp
 * DATABASE_PATH), real matcher, real upsert. Firebase/FCM is never contacted —
 * the push plan is inspected and deliverOwnerPush gets an injected sender.
 */

const SERVER_SECRET = "test-webhook-secret";

let tmpDir = "";

function authHeaders(value: string = SERVER_SECRET): Headers {
  return new Headers({
    "content-type": "application/json",
    "x-webhook-secret": value,
  });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    callId: "call-1",
    status: "completed",
    duration: "184",
    caller_number: "+15550000123",
    called_number: "+15550001111",
    gathered: JSON.stringify({ context: { customer_name: "Priya Raman" } }),
    ...overrides,
  };
}

function fire(overrides: Record<string, unknown> = {}) {
  return handleDograhWebhook({ body: body(overrides), headers: authHeaders() });
}

function setFcmToken(token: string) {
  return import("./database").then(({ getDb }) =>
    getDb()
      .prepare(
        `INSERT INTO settings (id, missedCallReplyTemplate, fcmToken) VALUES (1, '', ?)
         ON CONFLICT(id) DO UPDATE SET fcmToken = excluded.fcmToken`
      )
      .run(token)
  );
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "callflow-dograh-"));
  process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
  process.env.WEBHOOK_SECRET = SERVER_SECRET;
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
  delete process.env.WEBHOOK_SECRET;
});

describe("auth — x-webhook-secret vs WEBHOOK_SECRET", () => {
  it("401s on a wrong secret and writes nothing", async () => {
    const res = await handleDograhWebhook({
      body: body({ callId: "auth-bad" }),
      headers: authHeaders("wrong"),
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
    const { getCalls } = await import("./db");
    expect((await getCalls()).filter((c) => c.dograhRunId === "auth-bad")).toHaveLength(0);
  });

  it("401s when the header is missing", async () => {
    const res = await handleDograhWebhook({ body: body(), headers: new Headers() });
    expect(res.status).toBe(401);
  });

  it("401s when the server has no WEBHOOK_SECRET configured (fail closed)", async () => {
    delete process.env.WEBHOOK_SECRET;
    try {
      const res = await handleDograhWebhook({ body: body(), headers: authHeaders() });
      expect(res.status).toBe(401);
    } finally {
      process.env.WEBHOOK_SECRET = SERVER_SECRET;
    }
  });

  it("accepts the correct secret under any header-name casing", async () => {
    const titleCase = await handleDograhWebhook({
      body: body({ callId: "case-1" }),
      headers: new Headers({ "X-Webhook-Secret": SERVER_SECRET }),
    });
    expect(titleCase.status).toBe(200);

    // A case-sensitive header bag (raw Node record style) also matches.
    const strict = { get: (name: string) => (name === "X-Webhook-Secret" ? SERVER_SECRET : null) };
    const res = await handleDograhWebhook({
      body: body({ callId: "case-2" }),
      headers: strict,
    });
    expect(res.status).toBe(200);
  });
});

describe("validation", () => {
  it("400s when the body was not valid JSON", async () => {
    const res = await handleDograhWebhook({
      body: null,
      headers: authHeaders(),
      jsonInvalid: true,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "request body must be valid JSON" });
  });

  it("400s when callId is missing (and for non-object bodies)", async () => {
    for (const bad of [{ junk: true }, "not-an-object", { callId: "   " }]) {
      const res = await handleDograhWebhook({ body: bad, headers: authHeaders() });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "callId is required" });
    }
  });
});

describe("happy path + persistence", () => {
  it("stores the call, links the business, keeps the raw payload, ignores extras", async () => {
    const res = await fire({
      callId: "store-1",
      totally_unknown_field: { even: ["objects"] },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.callId).toBe("store-1");
    expect(res.created).toBe(true);
    expect(res.pushPlan).toBeNull(); // no FCM token registered yet

    const { getAllBusinesses, getCallByDograhRunId, getCalls } = await import("./db");
    const sole = (await getAllBusinesses())[0];
    const call = await getCallByDograhRunId("store-1");
    expect(call).toMatchObject({
      businessId: sole.id,
      callerNumber: "+15550000123",
      businessNumber: "+15550001111",
      callStatus: "answered", // unknown status "completed" → answered
      durationSeconds: 184,
      customerName: "Priya Raman",
      // calls.outcome stays null in the DB; the row mapper in db.ts
      // normalizes a null/unknown outcome to "other" for the dashboard.
      outcome: "other",
      dograhDeliveryId: null,
    });
    expect(JSON.parse(call!.rawPayload!)).toMatchObject({
      callId: "store-1",
      totally_unknown_field: { even: ["objects"] },
    });
    expect((await getCalls()).filter((c) => c.dograhRunId === "store-1")).toHaveLength(1);
  });

  it("maps a known status verbatim (voicemail_left)", async () => {
    await fire({ callId: "status-vm", status: "voicemail_left" });
    const { getCallByDograhRunId } = await import("./db");
    expect((await getCallByDograhRunId("status-vm"))!.callStatus).toBe("voicemail_left");
  });

  it("upserts: the same callId twice updates the one row", async () => {
    const first = await fire({ callId: "dup-1", duration: "10" });
    expect(first.created).toBe(true);

    const second = await fire({
      callId: "dup-1",
      duration: "210",
      status: "voicemail_left",
      gathered: JSON.stringify({ context: { customer_name: "Updated Name" } }),
    });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ok: true });
    expect(second.created).toBe(false);
    expect(second.pushPlan).toBeNull(); // never re-push on updates

    const { getCalls, getCallByDograhRunId } = await import("./db");
    expect((await getCalls()).filter((c) => c.dograhRunId === "dup-1")).toHaveLength(1);
    const row = await getCallByDograhRunId("dup-1");
    expect(row).toMatchObject({
      durationSeconds: 210,
      callStatus: "voicemail_left",
      customerName: "Updated Name",
    });
  });

  it("links a call whose called_number matches no business to the sole business", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await fire({ callId: "fallback-1", called_number: "+19999999999" });
    expect(res.status).toBe(200);
    const { getAllBusinesses, getCallByDograhRunId } = await import("./db");
    const sole = (await getAllBusinesses())[0];
    expect((await getCallByDograhRunId("fallback-1"))!.businessId).toBe(sole.id);
    warn.mockRestore();
  });
});

describe("owner push (scheduled after the response)", () => {
  function fakeSend(result: Partial<NotifyMissedCallResult>) {
    return vi.fn(
      async (
        _token: string,
        _title: string,
        _body: string,
        _data?: Record<string, string>
      ): Promise<NotifyMissedCallResult> => ({ sent: true, messageId: "m-1", ...result })
    );
  }

  it("builds a push plan for NEW calls; deliverOwnerPush sends it", async () => {
    await setFcmToken("token-abc");

    const res = await fire({ callId: "push-1" });
    expect(res.status).toBe(200);
    expect(res.pushPlan).toMatchObject({ fcmToken: "token-abc", title: "✅ Call handled" });
    expect(res.pushPlan!.body).toContain("Priya Raman");

    const { getCallByDograhRunId } = await import("./db");
    const row = await getCallByDograhRunId("push-1");
    expect(res.pushPlan!.data).toEqual({
      callId: row!.id,
      callerNumber: "+15550000123",
    });

    const send = fakeSend({});
    await deliverOwnerPush(res.pushPlan!, send);
    expect(send).toHaveBeenCalledWith(
      "token-abc",
      "✅ Call handled",
      expect.stringContaining("Priya Raman"),
      expect.objectContaining({ callId: row!.id })
    );

    await setFcmToken(""); // cleanup for later tests
  });

  it("never re-pushes on the duplicate path", async () => {
    await setFcmToken("token-dup");
    const first = await fire({ callId: "push-dup-1" });
    expect(first.pushPlan).not.toBeNull();
    const second = await fire({ callId: "push-dup-1", duration: "9" });
    expect(second.pushPlan).toBeNull();
    await setFcmToken("");
  });

  it("forgets a dead FCM token when FCM reports it invalid", async () => {
    await setFcmToken("token-dead");
    const send = fakeSend({ sent: false, error: "unregistered", invalidToken: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plan: OwnerPushPlan = {
      fcmToken: "token-dead",
      title: "t",
      body: "b",
      data: {},
    };
    await deliverOwnerPush(plan, send);
    warn.mockRestore();

    const { getBusinessFcmToken } = await import("./db");
    expect(await getBusinessFcmToken()).toBe("");
  });

  it("logs a warning (and plans nothing) when no FCM token is registered", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await fire({ callId: "push-none-1" });
    expect(res.status).toBe(200);
    expect(res.pushPlan).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Push skipped"));
    warn.mockRestore();
  });
});

describe("business matching — assignedNumber (per-business DID)", () => {
  let bizAId = "";
  let bizBId = "";

  beforeAll(async () => {
    const { createBusiness } = await import("./db");
    // Two extra businesses with DIFFERENT assigned DIDs. Their phoneNumbers
    // are never dialled in these tests, so every link below is via
    // assignedNumber (or, after it is cleared, the legacy rules).
    bizAId = (
      await createBusiness({
        phoneNumber: "+15550002222",
        carrier: "other",
        forwardingStatus: "active",
        lastVerifiedAt: null,
        pendingVerificationFor: null,
        pendingVerificationExpiresAt: null,
        assignedNumber: "+15550006101",
      })
    ).id;
    bizBId = (
      await createBusiness({
        phoneNumber: "+15550003333",
        carrier: "other",
        forwardingStatus: "active",
        lastVerifiedAt: null,
        pendingVerificationFor: null,
        pendingVerificationExpiresAt: null,
        assignedNumber: "+15550006102",
      })
    ).id;
  });

  afterAll(async () => {
    // Restore the pre-suite shape (one business, nothing assigned) so this
    // describe can never influence a test that runs after it.
    const { getDb } = await import("./database");
    getDb()
      .prepare("DELETE FROM calls WHERE businessId IN (?, ?)")
      .run(bizAId, bizBId);
    getDb()
      .prepare("DELETE FROM businesses WHERE id IN (?, ?)")
      .run(bizAId, bizBId);
  });

  it("links a call whose called_number equals a business's assignedNumber to that business", async () => {
    const res = await fire({ callId: "assigned-1", called_number: "+15550006101" });
    expect(res.status).toBe(200);
    const { getCallByDograhRunId } = await import("./db");
    expect((await getCallByDograhRunId("assigned-1"))!.businessId).toBe(bizAId);
  });

  it("routes each of two assigned numbers to its own business", async () => {
    const { getCallByDograhRunId } = await import("./db");
    const resB = await fire({ callId: "assigned-2", called_number: "+15550006102" });
    expect(resB.status).toBe(200);
    expect((await getCallByDograhRunId("assigned-2"))!.businessId).toBe(bizBId);

    // Formatted input still normalizes to the stored E.164.
    const resA = await fire({ callId: "assigned-3", called_number: "+1 (555) 000-6101" });
    expect(resA.status).toBe(200);
    expect((await getCallByDograhRunId("assigned-3"))!.businessId).toBe(bizAId);
  });

  it("stores an empty called_number unlinked (several businesses → no fallback)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await fire({ callId: "assigned-empty-1", called_number: "" });
    expect(res.status).toBe(200);
    const { getCallByDograhRunId } = await import("./db");
    expect((await getCallByDograhRunId("assigned-empty-1"))!.businessId).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("UNLINKED"));
    warn.mockRestore();
  });

  it("keeps the legacy behavior when no business has an assignedNumber", async () => {
    // Clear every assignment: the database is now shaped exactly like before
    // the assignedNumber feature (phoneNumber matching + the fallback only).
    const { getDb } = await import("./database");
    getDb().prepare("UPDATE businesses SET assignedNumber = NULL").run();

    const { getCallByDograhRunId } = await import("./db");
    // 1. The legacy direct match on businesses.phoneNumber still links.
    const direct = await fire({ callId: "assigned-legacy-1", called_number: "+15550002222" });
    expect(direct.status).toBe(200);
    expect((await getCallByDograhRunId("assigned-legacy-1"))!.businessId).toBe(bizAId);

    // 2. An unknown number with several businesses stays unlinked, exactly as
    //    before (the single-business fallback needs exactly one business).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unlinked = await fire({
      callId: "assigned-legacy-2",
      called_number: "+15550009099",
    });
    expect(unlinked.status).toBe(200);
    expect((await getCallByDograhRunId("assigned-legacy-2"))!.businessId).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("UNLINKED"));
    warn.mockRestore();
  });
});