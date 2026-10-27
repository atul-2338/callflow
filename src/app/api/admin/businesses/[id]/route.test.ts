import fs from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The guard is replaced wholesale: these tests exercise route behavior
// (validation, status codes, audit rows), not the session cookie itself.
const requireAdminApiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-session", () => ({ requireAdminApi: requireAdminApiMock }));

import { PATCH } from "./route";
import { closeDb, getDb } from "@/lib/database";
import { createBusiness, getBusinessById } from "@/lib/db";

// Throwaway database so the tests never touch ./data/callflow.db.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-admin-business-patch-test-${process.pid}-${Date.now()}.db`
);

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

function auditCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM admin_audit_log")
    .get() as { n: number };
  return row.n;
}

function routeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: unknown, id: string): Request {
  return new Request(`http://localhost:3000/api/admin/businesses/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("PATCH /api/admin/businesses/[id]", () => {
  let bizAId = "";
  let bizBId = "";

  beforeAll(async () => {
    process.env.DATABASE_PATH = TEST_DB_PATH;
    closeDb();
    const a = await createBusiness({
      phoneNumber: "+12129998877",
      carrier: "other",
      forwardingStatus: "not_started",
      lastVerifiedAt: null,
      pendingVerificationFor: null,
      pendingVerificationExpiresAt: null,
      billingName: "Alpha Plumbing",
    });
    const b = await createBusiness({
      phoneNumber: "+13129994444",
      carrier: "verizon",
      forwardingStatus: "not_started",
      lastVerifiedAt: null,
      pendingVerificationFor: null,
      pendingVerificationExpiresAt: null,
      billingName: "Beta Plumbing",
    });
    bizAId = a.id;
    bizBId = b.id;
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
    const response = await PATCH(
      makeRequest({ assignedNumber: "+12125550123" }, bizAId),
      routeContext(bizAId)
    );
    expect(response.status).toBe(401);
  });

  it("answers 400 on a malformed body", async () => {
    const response = await PATCH(makeRequest("{not-json", bizAId), routeContext(bizAId));
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error?: string };
    expect(data.error).toMatch(/valid JSON/i);
  });

  it("answers 400 when assignedNumber is missing or not a string", async () => {
    const response = await PATCH(makeRequest({}, bizAId), routeContext(bizAId));
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error?: string };
    expect(data.error).toMatch(/assignedNumber is required/i);
  });

  it("answers 404 for an unknown business id", async () => {
    const response = await PATCH(
      makeRequest({ assignedNumber: "+12125550123" }, "no-such-id"),
      routeContext("no-such-id")
    );
    expect(response.status).toBe(404);
  });

  it("answers 400 when the assigned number is not a valid international number", async () => {
    const before = auditCount();
    const response = await PATCH(
      makeRequest({ assignedNumber: "12345" }, bizAId),
      routeContext(bizAId)
    );
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error?: string };
    expect(data.error).toMatch(/international number/i);
    expect(auditCount()).toBe(before);
  });

  it("sets the assigned number and writes an audit row on success", async () => {
    const before = auditCount();
    const response = await PATCH(
      makeRequest({ assignedNumber: "+13035550101" }, bizAId),
      routeContext(bizAId)
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      business?: { id: string; assignedNumber: string | null };
    };
    expect(data.business?.assignedNumber).toBe("+13035550101");
    expect((await getBusinessById(bizAId))?.assignedNumber).toBe("+13035550101");

    const row = lastAuditRow();
    expect(row?.action).toBe("business_assigned_number_set");
    expect(row?.target).toBe(bizAId);
    expect(JSON.parse(row?.details ?? "{}")).toEqual({
      clientUid: (await getBusinessById(bizAId))?.clientUid,
      assignedNumber: "+13035550101",
      previousAssignedNumber: null,
    });
    expect(row?.ip).toBe("198.51.100.7");
    expect(auditCount()).toBe(before + 1);
  });

  it("answers 409 when the number is another business's phoneNumber", async () => {
    const before = auditCount();
    const response = await PATCH(
      makeRequest({ assignedNumber: "+1 212 999 8877" }, bizBId),
      routeContext(bizBId)
    );
    expect(response.status).toBe(409);
    const data = (await response.json()) as { error?: string };
    expect(data.error).toMatch(/already in use/i);
    expect(auditCount()).toBe(before);
  });

  it("answers 409 when the number is another business's assignedNumber", async () => {
    const response = await PATCH(
      makeRequest({ assignedNumber: "+1 (303) 555-0101" }, bizBId),
      routeContext(bizBId)
    );
    expect(response.status).toBe(409);
    const data = (await response.json()) as { error?: string };
    expect(data.error).toMatch(/already in use/i);
  });

  it("allows re-saving the business's own phoneNumber as its assigned number", async () => {
    const response = await PATCH(
      makeRequest({ assignedNumber: "+12129998877" }, bizAId),
      routeContext(bizAId)
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      business?: { assignedNumber: string | null };
    };
    expect(data.business?.assignedNumber).toBe("+12129998877");
  });

  it("clears the assigned number on an empty value", async () => {
    const before = auditCount();
    const response = await PATCH(
      makeRequest({ assignedNumber: "" }, bizAId),
      routeContext(bizAId)
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      business?: { assignedNumber: string | null };
    };
    expect(data.business?.assignedNumber).toBeNull();
    expect((await getBusinessById(bizAId))?.assignedNumber).toBeNull();
    const row = lastAuditRow();
    expect(JSON.parse(row?.details ?? "{}")).toEqual({
      clientUid: (await getBusinessById(bizAId))?.clientUid,
      assignedNumber: null,
      previousAssignedNumber: "+12129998877",
    });
    expect(auditCount()).toBe(before + 1);
  });
});