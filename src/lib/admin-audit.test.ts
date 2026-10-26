import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { logAdminAction } from "./admin-audit";
import { closeDb, getDb } from "./database";

// Throwaway database so the tests never touch ./data/callflow.db. getDb()
// resolves DATABASE_PATH lazily on first use and nothing opens at import
// time, so setting the env in beforeAll is early enough.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-admin-audit-test-${process.pid}-${Date.now()}.db`
);

interface AuditRow {
  id: string;
  action: string;
  target: string | null;
  details: string | null;
  ip: string;
  createdAt: string;
}

function lastRow(): AuditRow | undefined {
  return getDb()
    .prepare(
      "SELECT id, action, target, details, ip, createdAt FROM admin_audit_log ORDER BY rowid DESC LIMIT 1"
    )
    .get() as AuditRow | undefined;
}

describe("logAdminAction", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = TEST_DB_PATH;
    closeDb();
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
    delete process.env.DATABASE_PATH;
  });

  it("records action, target, JSON details, ip and an ISO createdAt", () => {
    logAdminAction({
      action: "business_create",
      target: "biz-123",
      details: { clientUid: "TE-abcd1234", carrier: "telnyx" },
      ip: "203.0.113.9",
    });
    const row = lastRow();
    expect(row?.action).toBe("business_create");
    expect(row?.target).toBe("biz-123");
    expect(JSON.parse(row?.details ?? '"no-details"')).toEqual({
      clientUid: "TE-abcd1234",
      carrier: "telnyx",
    });
    expect(row?.ip).toBe("203.0.113.9");
    expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(row?.id).toHaveLength(36);
  });

  it("stores NULL target/details and empty ip when omitted", () => {
    logAdminAction({ action: "admin_login" });
    const row = lastRow();
    expect(row?.action).toBe("admin_login");
    expect(row?.target).toBeNull();
    expect(row?.details).toBeNull();
    expect(row?.ip).toBe("");
  });

  it("truncates oversized details instead of writing giant rows", () => {
    logAdminAction({
      action: "blob_action",
      details: { blob: "x".repeat(5000) },
    });
    const row = lastRow();
    expect(row?.details?.length).toBeLessThan(5000);
    expect(row?.details?.endsWith("[truncated]")).toBe(true);
  });

  it("never throws when details are not JSON-serializable", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      logAdminAction({ action: "odd_action", details: circular })
    ).not.toThrow();
    const row = lastRow();
    expect(row?.action).toBe("odd_action");
    expect(row?.details).toBeNull();
  });

  it("survives a database reopen (schema re-applied idempotently)", () => {
    logAdminAction({ action: "pre_reopen" });
    closeDb();
    expect(() => logAdminAction({ action: "post_reopen" })).not.toThrow();
    const row = lastRow();
    expect(row?.action).toBe("post_reopen");
  });
});