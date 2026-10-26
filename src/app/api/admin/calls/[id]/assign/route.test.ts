import fs from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The guard is replaced wholesale: these tests exercise route behavior
// (validation, status codes, audit rows), not the session cookie itself.
const requireAdminApiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-session", () => ({ requireAdminApi: requireAdminApiMock }));

import { POST } from "./route";
import { adminCreateBusiness } from "@/lib/admin-db";
import { closeDb, getDb } from "@/lib/database";

// Throwaway database so the tests never touch ./data/callflow.db.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-admin-assign-route-test-${process.pid}-${Date.now()}.db`
);

function seedCall(callStartedAt: string): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO calls (id, callerNumber, businessNumber, callStatus, callStartedAt,
         textBackSent, followUpStatus, followUpNotes, createdAt, updatedAt)
       VALUES (?, ?, '', 'missed', ?, 0, 'none', '', ?, ?)`
    )
    .run(id, "+12125550099", callStartedAt, now, now);
  return id;
}

interface AuditRow {
  action: string;
  target: string | null;
  details: string | null;
  ip: string;
}

function lastAuditRow(): AuditRow | undefined {
  return getDb()
    .prepare(
      "SELECT action, target, details, ip FROM admin_audit_log ORDER BY rowid DESC LIMIT 1"
    )
    .get() as AuditRow | undefined;
}

function makeRequest(id: string, body: unknown): Request {
  return new Request(`http://localhost:3000/api/admin/calls/${id}/assign`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.8" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function routeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/calls/[id]/assign", () => {
  let businessId: string;
  let businessClientUid: string;

  beforeAll(async () => {
    process.env.DATABASE_PATH = TEST_DB_PATH;
    closeDb();
    const biz = await adminCreateBusiness({
      phoneNumber: "+17029991111",
      billingName: "Assign Route Biz",
    });
    if (!biz.ok) throw new Error("business creation failed");
    businessId = biz.business.id;
    businessClientUid = biz.business.clientUid;
  });

  beforeEach(() => {
    requireAdminApiMock.mockReset();
    requireAdminApiMock.mockReturnValue(null);
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
    delete process.env.DATABASE_PATH;
  });

  it("answers 401 when the admin guard rejects", async () => {
    requireAdminApiMock.mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
    const response = await POST(
      makeRequest("call-1", { businessId }),
      routeContext("call-1")
    );
    expect(response.status).toBe(401);
  });

  it("answers 400 on a malformed body or a missing businessId", async () => {
    const malformed = await POST(makeRequest("call-1", "{bad"), routeContext("call-1"));
    expect(malformed.status).toBe(400);

    const missing = await POST(makeRequest("call-1", {}), routeContext("call-1"));
    expect(missing.status).toBe(400);
    const data = (await missing.json()) as { error?: string };
    expect(data.error).toMatch(/businessId is required/i);
  });

  it("answers 404 for an unknown call", async () => {
    const response = await POST(
      makeRequest("no-such-call", { businessId }),
      routeContext("no-such-call")
    );
    expect(response.status).toBe(404);
  });

  it("answers 400 for an unknown business", async () => {
    const callId = seedCall("2026-10-22T08:00:00.000Z");
    const response = await POST(
      makeRequest(callId, { businessId: "no-such-business" }),
      routeContext(callId)
    );
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error?: string };
    expect(data.error).toMatch(/Business not found/i);
  });

  it("assigns the call and writes an audit row on success", async () => {
    const callId = seedCall("2026-10-22T09:00:00.000Z");
    const response = await POST(
      makeRequest(callId, { businessId }),
      routeContext(callId)
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as { call?: { businessId: string | null } };
    expect(data.call?.businessId).toBe(businessId);

    const row = getDb()
      .prepare("SELECT businessId, updatedAt FROM calls WHERE id = ?")
      .get(callId) as { businessId: string; updatedAt: string };
    expect(row.businessId).toBe(businessId);
    expect(row.updatedAt).toBeTruthy();

    const audit = lastAuditRow();
    expect(audit?.action).toBe("call_assign");
    expect(audit?.target).toBe(callId);
    expect(JSON.parse(audit?.details ?? "{}")).toEqual({
      businessId,
      businessClientUid,
      previousBusinessId: null,
    });
    expect(audit?.ip).toBe("198.51.100.8");
  });
});