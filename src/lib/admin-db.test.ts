import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminCountBusinesses,
  adminCountCalls,
  adminCountUnlinkedCalls,
  adminListAuditEntries,
  adminListBusinesses,
  adminListBusinessesWithLastCall,
  adminListCalls,
  adminListRecentCallsForBusiness,
  adminSystemInfo,
} from "./admin-db";
import { logAdminAction } from "./admin-audit";
import { closeDb, getDb } from "./database";
import { createBusiness } from "./db";

// Throwaway database so the tests never touch ./data/callflow.db. getDb()
// resolves DATABASE_PATH lazily on first use, so setting the env in beforeAll
// is early enough.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-admin-db-test-${process.pid}-${Date.now()}.db`
);

function seedCall(options: {
  callStartedAt: string;
  businessId?: string | null;
  dograhRunId?: string | null;
  callStatus?: string;
  outcome?: string | null;
  dograhDisposition?: string | null;
}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO calls (id, businessId, callerNumber, businessNumber, callStatus,
         callStartedAt, textBackSent, followUpStatus, followUpNotes,
         dograhRunId, dograhDisposition, outcome, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'none', '', ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      options.businessId ?? null,
      "+12125550011",
      "",
      options.callStatus ?? "answered",
      options.callStartedAt,
      options.dograhRunId ?? null,
      options.dograhDisposition ?? null,
      options.outcome ?? null,
      now,
      now
    );
  return id;
}

/** Minimal business row factory (businesses now come only from signup). */
async function makeBusiness(phone: string, name?: string) {
  return createBusiness({
    phoneNumber: phone,
    carrier: "other",
    forwardingStatus: "not_started",
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
    ...(name ? { billingName: name } : {}),
  });
}

describe("admin-db", () => {
  beforeAll(() => {
    process.env.DATABASE_PATH = TEST_DB_PATH;
    process.env.WEBHOOK_SECRET = "test-webhook-secret";
    delete process.env.APP_AUTH_TOKEN;
    closeDb();
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
    delete process.env.DATABASE_PATH;
    delete process.env.WEBHOOK_SECRET;
  });

  it("starts with zeroed counts on a fresh database", async () => {
    expect(await adminCountBusinesses()).toBe(0);
    expect(await adminCountCalls()).toBe(0);
    expect(await adminCountUnlinkedCalls()).toBe(0);
    expect(await adminListAuditEntries(200)).toEqual({
      entries: [],
      total: 0,
      limit: 200,
    });
  });

  describe("adminListBusinessesWithLastCall", () => {
    it("lists businesses with each one's last-call timestamp and pool assignment", async () => {
      const first = await makeBusiness("+12129998877", "Acme Plumbing LLC");
      const second = await makeBusiness("+13129994444");
      const { updateBusiness } = await import("./db");
      await updateBusiness(first.id, { assignedNumber: "+15550100042" });

      const linkedCallId = seedCall({
        callStartedAt: "2026-10-21T09:00:00.000Z",
        businessId: first.id,
      });

      const rows = await adminListBusinessesWithLastCall();
      expect(rows.length).toBeGreaterThanOrEqual(2);

      const acme = rows.find((row) => row.id === first.id);
      expect(acme?.billingName).toBe("Acme Plumbing LLC");
      expect(acme?.assignedNumber).toBe("+15550100042");
      expect(acme?.lastCallAt).toBe("2026-10-21T09:00:00.000Z");

      const other = rows.find((row) => row.id === second.id);
      expect(other?.lastCallAt).toBeNull();

      // The linked call really exists (sanity for the MAX() join above).
      const stored = getDb()
        .prepare("SELECT callStartedAt FROM calls WHERE id = ?")
        .get(linkedCallId) as { callStartedAt: string };
      expect(stored.callStartedAt).toBe("2026-10-21T09:00:00.000Z");

      // Clean up so later totals in this file are not skewed by this seed.
      getDb().prepare("DELETE FROM calls WHERE id = ?").run(linkedCallId);
    });
  });

  describe("adminListCalls", () => {
    it("pages newest-first with business labels and clamps the page", async () => {
      const biz = await makeBusiness("+17029991111", "Acme Plumbing LLC");
      seedCall({ callStartedAt: "2026-10-20T08:00:00.000Z" });
      seedCall({ callStartedAt: "2026-10-20T09:00:00.000Z" });
      seedCall({
        callStartedAt: "2026-10-20T10:00:00.000Z",
        businessId: biz.id,
      });

      const page = await adminListCalls({ page: 1, pageSize: 2 });
      expect(page.total).toBe(3);
      expect(page.pageCount).toBe(2);
      expect(page.calls).toHaveLength(2);
      // Newest first: the linked call leads page 1.
      expect(page.calls[0].businessId).toBe(biz.id);
      expect(page.calls[0].businessLabel).toMatch(
        /^(Acme Plumbing LLC|TE-[0-9a-f]{8})$/
      );

      // Page 2 holds the remainder; the page is clamped into range instead of
      // rendering an empty table.
      const clamped = await adminListCalls({ page: 99, pageSize: 2 });
      expect(clamped.page).toBe(2);
      expect(clamped.calls).toHaveLength(1);
    });

    it("filters to unlinked calls only", async () => {
      const unlinked = await adminListCalls({ unlinkedOnly: true });
      expect(unlinked.total).toBe(2);
      for (const call of unlinked.calls) {
        expect(call.businessId).toBeNull();
      }
      const linked = await adminListCalls({ unlinkedOnly: false });
      expect(linked.total).toBe(3);
    });

    it("lists recent calls for one business", async () => {
      const biz = await adminListBusinesses();
      const target = biz[0];
      const recent = await adminListRecentCallsForBusiness(target.id);
      expect(recent).toHaveLength(1);
      expect(recent[0].businessId).toBe(target.id);
      expect(recent[0].businessLabel).toMatch(/^(Acme Plumbing LLC|TE-[0-9a-f]{8})$/);
    });
  });

  describe("adminListAuditEntries", () => {
    it("returns entries newest-first with a total count", async () => {
      logAdminAction({ action: "first_action", target: "t1" });
      logAdminAction({ action: "second_action", target: "t2" });
      logAdminAction({ action: "third_action", target: "t3" });

      const { entries, total } = await adminListAuditEntries(2);
      expect(total).toBeGreaterThanOrEqual(3);
      expect(entries).toHaveLength(2);
      expect(entries[0].action).toBe("third_action");
      expect(entries[1].action).toBe("second_action");
      // newest-first: createdAt is non-increasing
      expect(entries[0].createdAt >= entries[1].createdAt).toBe(true);
    });
  });

  describe("adminSystemInfo", () => {
    it("reports env NAMES with set/not-set booleans and never values", async () => {
      const info = await adminSystemInfo();
      expect(info.dbPath).toBe(TEST_DB_PATH);
      expect(info.dbFileBytes).toBeGreaterThan(0);
      expect(info.nodeVersion).toMatch(/^v\d+\./);
      expect(info.appVersion).toBe("0.1.0");
      expect(info.versions?.next).toBe("16.3.2");

      const webhook = info.envStatus.find((e) => e.name === "WEBHOOK_SECRET");
      expect(webhook).toEqual({ name: "WEBHOOK_SECRET", set: true });
      const appAuth = info.envStatus.find((e) => e.name === "APP_AUTH_TOKEN");
      expect(appAuth).toEqual({ name: "APP_AUTH_TOKEN", set: false });

      // The removed shared-DID variable must not be reported anymore.
      expect(
        info.envStatus.find((e) => e.name === "CALLFLOW_FORWARDING_DID")
      ).toBeUndefined();

      // The secret VALUE must not leak anywhere in the returned structure.
      expect(JSON.stringify(info)).not.toContain("test-webhook-secret");
    });

    it("derives Dograh webhook results from the calls table", async () => {
      seedCall({
        callStartedAt: "2026-10-22T08:00:00.000Z",
        dograhRunId: "run-1",
        dograhDisposition: "booked",
        outcome: "booked",
      });
      seedCall({
        callStartedAt: "2026-10-22T09:00:00.000Z",
        dograhRunId: "run-2",
        dograhDisposition: "callback",
        outcome: "callback",
        callStatus: "missed",
      });
      seedCall({ callStartedAt: "2026-10-22T10:00:00.000Z" }); // not a webhook row

      const info = await adminSystemInfo();
      expect(info.dograhCallCount).toBe(2);
      expect(info.recentDograhCalls).toHaveLength(2);
      expect(info.recentDograhCalls[0].dograhRunId).toBe("run-2");
      expect(info.recentDograhCalls[0].callStatus).toBe("missed");
      expect(info.recentDograhCalls[1].dograhRunId).toBe("run-1");
    });
  });
});