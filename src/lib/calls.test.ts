import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  addCall,
  createBusiness,
  getCallById,
  getCallsForBusiness,
  setCallFollowUp,
  updateCall,
} from "./db";
import { businessSessionCookieName, createBusinessSessionToken } from "./business-session";

/**
 * Follow-up workflow tests against a real temp SQLite database, plus the
 * /api/calls route handlers exercised directly (auth, validation, tenancy).
 */

let tmpDir = "";
let businessA = "";
let businessB = "";
let callA = "";
let callB = "";

function sessionCookie(businessId: string): string {
  return `cookie: ${businessSessionCookieName()}=${createBusinessSessionToken(businessId)}`;
}

function callRow(overrides: Partial<Parameters<typeof addCall>[0]> = {}) {
  return {
    businessId: null,
    callerNumber: "+15550000123",
    businessNumber: "+15559998888",
    callStatus: "answered" as const,
    callStartedAt: "2026-10-01T10:00:00.000Z",
    callEndedAt: "2026-10-01T10:03:00.000Z",
    durationSeconds: 180,
    textBackSent: false,
    textBackSentAt: null,
    signalwireCallSid: null,
    recordingUrl: null,
    transcript: "Caller: my sink is leaking",
    dograhRunId: null,
    dograhDeliveryId: null,
    dograhDisposition: "callback_requested",
    outcome: "callback" as const,
    customerName: null,
    callbackNumber: null,
    calendarEventId: null,
    transcriptUrl: null,
    serviceRequested: "Leaking sink",
    urgency: null,
    preferredCallbackTime: null,
    ...overrides,
  };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "callflow-calls-"));
  process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
  process.env.BUSINESS_SESSION_SECRET = "vitest-session-secret";
  delete process.env.APP_AUTH_TOKEN;

  const a = await createBusiness({
    phoneNumber: "+15550001111",
    carrier: "other",
    forwardingStatus: "active",
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
  });
  const b = await createBusiness({
    phoneNumber: "+15550002222",
    carrier: "other",
    forwardingStatus: "active",
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
  });
  businessA = a.id;
  businessB = b.id;

  const aCall = await addCall(callRow({ businessId: businessA, dograhRunId: "run-a" }));
  const bCall = await addCall(callRow({ businessId: businessB, dograhRunId: "run-b" }));
  callA = aCall.id;
  callB = bCall.id;
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
  delete process.env.BUSINESS_SESSION_SECRET;
});

describe("follow-up persistence", () => {
  it("defaults new calls to an untouched follow-up workflow", async () => {
    const call = await getCallById(callA);
    expect(call!.followUpStatus).toBe("none");
    expect(call!.followUpNotes).toBe("");
    expect(call!.followUpUpdatedAt).toBeNull();
    expect(call!.serviceRequested).toBe("Leaking sink");
  });

  it("flags a call for follow-up and stamps the update time", async () => {
    const updated = await setCallFollowUp(callA, { status: "needed" });
    expect(updated!.followUpStatus).toBe("needed");
    expect(updated!.followUpUpdatedAt).not.toBeNull();

    const reread = await getCallById(callA);
    expect(reread!.followUpStatus).toBe("needed");
    expect(reread!.followUpUpdatedAt).toBe(updated!.followUpUpdatedAt);
  });

  it("saves notes and resolves without losing earlier notes", async () => {
    await setCallFollowUp(callA, {
      status: "resolved",
      notes: "Called back, quoted $180, customer booked Thursday.",
    });
    const resolved = await getCallById(callA);
    expect(resolved!.followUpStatus).toBe("resolved");
    expect(resolved!.followUpNotes).toContain("$180");

    // A later status change keeps the notes unless they are explicitly replaced.
    await setCallFollowUp(callA, { status: "needed" });
    const reflagged = await getCallById(callA);
    expect(reflagged!.followUpNotes).toContain("$180");
    expect(reflagged!.followUpStatus).toBe("needed");
  });

  it("updateCall preserves follow-up fields it was not given", async () => {
    await setCallFollowUp(callA, { status: "needed", notes: "keep me" });
    await updateCall(callA, { transcript: "Caller: updated transcript" });
    const call = await getCallById(callA);
    expect(call!.followUpStatus).toBe("needed");
    expect(call!.followUpNotes).toBe("keep me");
    expect(call!.transcript).toBe("Caller: updated transcript");
  });

  it("getCallsForBusiness scopes reads to one business", async () => {
    const aCalls = await getCallsForBusiness(businessA);
    expect(aCalls.map((c) => c.id)).toContain(callA);
    expect(aCalls.map((c) => c.id)).not.toContain(callB);

    const bCalls = await getCallsForBusiness(businessB);
    expect(bCalls.map((c) => c.id)).toEqual([callB]);
  });

  it("returns null for unknown ids", async () => {
    expect(await setCallFollowUp("no-such-id", { status: "needed" })).toBeNull();
  });
});

describe("GET /api/calls", () => {
  it("401s when APP_AUTH_TOKEN is set and the request is unauthenticated", async () => {
    vi.stubEnv("APP_AUTH_TOKEN", "secret-token");
    const { GET } = await import("@/app/api/calls/route");
    const res = await GET(new Request("http://localhost/api/calls"));
    expect(res.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("401s when APP_AUTH_TOKEN is unset and the request is unauthenticated", async () => {
    delete process.env.APP_AUTH_TOKEN;
    const { GET } = await import("@/app/api/calls/route");
    const res = await GET(new Request("http://localhost/api/calls"));
    expect(res.status).toBe(401);
  });

  it("scopes list reads to the session business", async () => {
    const { GET } = await import("@/app/api/calls/route");
    const [cookieHeader] = sessionCookie(businessA).split(": ").slice(-1);
    const res = await GET(
      new Request("http://localhost/api/calls", { headers: { cookie: cookieHeader } })
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<{ id: string }>;
    expect(data.map((c) => c.id)).toEqual([callA]);
  });

  it("filters by followUp and validates unknown filters", async () => {
    const { GET } = await import("@/app/api/calls/route");
    const [cookieHeader] = sessionCookie(businessA).split(": ").slice(-1);
    const res = await GET(
      new Request("http://localhost/api/calls?followUp=needed", {
        headers: { cookie: cookieHeader },
      })
    );
    const data = (await res.json()) as Array<{ followUpStatus: string }>;
    expect(data.every((c) => c.followUpStatus === "needed")).toBe(true);

    expect(
      (
        await GET(
          new Request("http://localhost/api/calls?followUp=weird", {
            headers: { cookie: cookieHeader },
          })
        )
      ).status
    ).toBe(400);
    expect(
      (
        await GET(
          new Request("http://localhost/api/calls?status=weird", {
            headers: { cookie: cookieHeader },
          })
        )
      ).status
    ).toBe(400);
  });

  it("caps limit and falls back to the default for a non-positive one", async () => {
    const { GET } = await import("@/app/api/calls/route");
    const [cookieHeader] = sessionCookie(businessA).split(": ").slice(-1);
    const authed = (url: string) =>
      new Request(url, { headers: { cookie: cookieHeader } });

    // A second call for the session's business so the cap is observable
    // (reads are scoped to businessA).
    await addCall(callRow({ businessId: businessA, dograhRunId: "run-a2" }));

    const data = (await (await GET(authed("http://localhost/api/calls?limit=1"))).json()) as unknown[];
    expect(data.length).toBe(1);

    const dataDefault = (
      await (await GET(authed("http://localhost/api/calls?limit=0"))).json()
    ) as unknown[];
    expect(dataDefault.length).toBeGreaterThan(1);
  });
});

describe("PATCH /api/calls/[id]", () => {
  async function patch(
    callId: string,
    init: { headers?: Record<string, string>; body?: unknown } = {}
  ) {
    const { PATCH } = await import("@/app/api/calls/[id]/route");
    const request = new Request(`http://localhost/api/calls/${callId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...init.headers },
      body: JSON.stringify(init.body ?? {}),
    });
    return PATCH(request, { params: Promise.resolve({ id: callId }) });
  }

  it("401s when APP_AUTH_TOKEN is set and no credentials are provided", async () => {
    vi.stubEnv("APP_AUTH_TOKEN", "secret-token");
    expect((await patch(callA)).status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("rejects invalid bodies with 400", async () => {
    const [aCookie] = sessionCookie(businessA).split(": ").slice(-1);
    expect((await patch(callA, { headers: { cookie: aCookie } })).status).toBe(400); // no follow-up fields
    expect(
      (await patch(callA, { headers: { cookie: aCookie }, body: { followUpStatus: "urgent" } }))
        .status
    ).toBe(400);
    expect(
      (
        await patch(callA, {
          headers: { cookie: aCookie },
          body: { followUpNotes: "x".repeat(2001) },
        })
      ).status
    ).toBe(400);
  });

  it("flags, notes, resolves a call end-to-end", async () => {
    const [bCookie] = sessionCookie(businessB).split(": ").slice(-1);
    const flagged = await patch(callB, {
      headers: { cookie: bCookie },
      body: { followUpStatus: "needed" },
    });
    expect(flagged.status).toBe(200);
    expect(((await flagged.json()) as { followUpStatus: string }).followUpStatus).toBe("needed");

    const noted = await patch(callB, {
      headers: { cookie: bCookie },
      body: { followUpNotes: "Owner: quoted $220, callback Friday." },
    });
    expect(noted.status).toBe(200);
    expect(((await noted.json()) as { followUpNotes: string }).followUpNotes).toContain("$220");

    const resolved = await patch(callB, {
      headers: { cookie: bCookie },
      body: { followUpStatus: "resolved", followUpNotes: "Closed out." },
    });
    const resolvedBody = (await resolved.json()) as {
      followUpStatus: string;
      followUpNotes: string;
      followUpUpdatedAt: string | null;
    };
    expect(resolvedBody.followUpStatus).toBe("resolved");
    expect(resolvedBody.followUpNotes).toBe("Closed out.");
    expect(resolvedBody.followUpUpdatedAt).not.toBeNull();

    const stored = await getCallById(callB);
    expect(stored!.followUpStatus).toBe("resolved");
    expect(stored!.followUpNotes).toBe("Closed out.");
  });

  it("404s unknown ids and hides other businesses' calls from a session", async () => {
    const [aCookie] = sessionCookie(businessA).split(": ").slice(-1);
    expect(
      (await patch("no-such-id", { headers: { cookie: aCookie }, body: { followUpStatus: "needed" } }))
        .status
    ).toBe(404);

    const foreign = await patch(
      callB,
      { headers: { cookie: aCookie }, body: { followUpStatus: "needed" } }
    );
    expect(foreign.status).toBe(404);
    // The rejected attempt must not have changed anything.
    expect((await getCallById(callB))!.followUpStatus).toBe("resolved");
  });

  it("lets a session update its own call and accepts a notes clear", async () => {
    const [aCookie] = sessionCookie(businessA).split(": ").slice(-1);
    const [bCookie] = sessionCookie(businessB).split(": ").slice(-1);
    const res = await patch(
      callA,
      { headers: { cookie: aCookie }, body: { followUpStatus: "resolved" } }
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { followUpStatus: string }).followUpStatus).toBe("resolved");

    const cleared = await patch(callB, {
      headers: { cookie: bCookie },
      body: { followUpNotes: "" },
    });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { followUpNotes: string }).followUpNotes).toBe("");
  });
});