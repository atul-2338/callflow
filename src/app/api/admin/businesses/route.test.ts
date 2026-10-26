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
import { closeDb, getDb } from "@/lib/database";

// Throwaway database so the tests never touch ./data/callflow.db.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-admin-businesses-route-test-${process.pid}-${Date.now()}.db`
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

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/admin/businesses", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/admin/businesses", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = TEST_DB_PATH;
    closeDb();
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
    const response = await POST(makeRequest({ phoneNumber: "+12129998877" }));
    expect(response.status).toBe(401);
  });

  it("answers 400 on a malformed body", async () => {
    const response = await POST(makeRequest("{not-json"));
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error?: string };
    expect(data.error).toMatch(/valid JSON/i);
  });

  it("answers 400 when the phone number is missing or not E.164", async () => {
    const missing = await POST(makeRequest({}));
    expect(missing.status).toBe(400);

    const garbage = await POST(makeRequest({ phoneNumber: "12345" }));
    expect(garbage.status).toBe(400);
    const data = (await garbage.json()) as { error?: string };
    expect(data.error).toMatch(/international number/i);

    // Failed attempts are not audit-logged (same success-only policy as login).
    expect(auditCount()).toBe(0);
  });

  it("answers 409 when the phone number is already enrolled", async () => {
    const first = await POST(makeRequest({ phoneNumber: "+12129998877" }));
    expect(first.status).toBe(201);
    const duplicate = await POST(makeRequest({ phoneNumber: "+1 212 999 8877" }));
    expect(duplicate.status).toBe(409);
    const data = (await duplicate.json()) as { error?: string };
    expect(data.error).toMatch(/already exists/i);
  });

  it("creates the business and writes an audit row on success", async () => {
    const before = auditCount();
    const response = await POST(
      makeRequest({ phoneNumber: "+13129994444", billingName: "Acme Co", carrier: "verizon" })
    );
    expect(response.status).toBe(201);
    const data = (await response.json()) as {
      business?: { id: string; clientUid: string | null; phoneNumber: string; carrier: string };
    };
    expect(data.business?.clientUid).toMatch(/^TE-[0-9a-f]{8}$/);
    expect(data.business?.phoneNumber).toBe("+13129994444");
    expect(data.business?.carrier).toBe("verizon");

    const row = lastAuditRow();
    expect(row?.action).toBe("business_create");
    expect(row?.target).toBe(data.business?.id);
    expect(JSON.parse(row?.details ?? "{}")).toEqual({
      clientUid: data.business?.clientUid,
      phoneNumber: "+13129994444",
      carrier: "verizon",
    });
    expect(row?.ip).toBe("198.51.100.7");
    expect(auditCount()).toBe(before + 1);
  });
});