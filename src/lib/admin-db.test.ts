import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminAssignCallToBusiness,
  adminCountBusinesses,
  adminCountCalls,
  adminCountUnlinkedCalls,
  adminCreateBusiness,
  adminListAuditEntries,
  adminListBusinesses,
  adminListCalls,
  adminListRecentCallsForBusiness,
  adminSystemInfo,
} from "./admin-db";
import { logAdminAction } from "./admin-audit";
import { closeDb, getDb } from "./database";

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

  describe("adminCreateBusiness", () => {
    it("normalizes the phone to E.164 and assigns a permanent clientUid", async () => {
      const result = await adminCreateBusiness({
        phoneNumber: "212 999 8877",
        billingName: "  Acme Plumbing LLC  ",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.business.phoneNumber).toBe("+12129998877");
      expect(result.business.clientUid).toMatch(/^TE-[0-9a-f]{8}$/);
      expect(result.business.billingName).toBe("Acme Plumbing LLC");
      expect(result.business.carrier).toBe("other");
      expect(result.business.forwardingStatus).toBe("not_started");
      expect(result.business.subscriptionStatus).toBe("not_started");
    });

    it("rejects numbers that are not valid E.164", async () => {
      const tooShort = await adminCreateBusiness({ phoneNumber: "12345" });
      expect(tooShort).toMatchObject({ ok: false, reason: "invalid_phone" });

      const empty = await adminCreateBusiness({ phoneNumber: "   " });
      expect(empty).toMatchObject({
        ok: false,
        reason: "invalid_phone",
        message: "A business phone number is required.",
      });
    });

    it("rejects a duplicate phone number", async () => {
      const first = await adminCreateBusiness({ phoneNumber: "+16465551234" });
      expect(first.ok).toBe(true);
      const second = await adminCreateBusiness({ phoneNumber: "+16465551234" });
      expect(second).toMatchObject({ ok: false, reason: "duplicate_phone" });
    });

    it("rejects unknown carriers", async () => {
      const result = await adminCreateBusiness({
        phoneNumber: "+13129994444",
        carrier: "sky",
      });
      expect(result).toMatchObject({ ok: false, reason: "invalid_carrier" });
    });
  });

  it("lists businesses newest-first", async () => {
    await adminCreateBusiness({ phoneNumber: "+15129990001" });
    await adminCreateBusiness({ phoneNumber: "+15129990002" });
    const businesses = await adminListBusinesses();
    expect(businesses.length).toBeGreaterThanOrEqual(2);
    expect(businesses[0].phoneNumber).toBe("+15129990002");
  });

  describe("adminListCalls", () => {
    it("paginates newest-first and joins a business label", async () => {
      const biz = await adminCreateBusiness({ phoneNumber: "+17029990001" });
      if (!biz.ok) throw new Error("business creation failed");
      const businessId = biz.business.id;

      seedCall({ callStartedAt: "2026-10-20T10:00:00.000Z", businessId });
      seedCall({ callStartedAt: "2026-10-20T11:00:00.000Z" });
      seedCall({ callStartedAt: "2026-10-20T12:00:00.000Z" });

      const page1 = await adminListCalls({ page: 1, pageSize: 2 });
      expect(page1.total).toBe(3);
      expect(page1.pageCount).toBe(2);
      expect(page1.calls).toHaveLength(2);
      expect(page1.calls[0].callStartedAt).toBe("2026-10-20T12:00:00.000Z");

      const page2 = await adminListCalls({ page: 2, pageSize: 2 });
      expect(page2.calls).toHaveLength(1);
      // label comes from COALESCE(billingName, clientUid)
      expect(page2.calls[0].businessLabel).toMatch(
        /^(Acme Plumbing LLC|TE-[0-9a-f]{8})$/
      );

      // Page is clamped into range instead of rendering an empty table.
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

  describe("adminAssignCallToBusiness", () => {
    it("links a call and reports the previous business", async () => {
      const bizA = await adminCreateBusiness({ phoneNumber: "+18139990001" });
      const bizB = await adminCreateBusiness({ phoneNumber: "+18139990002" });
      if (!bizA.ok || !bizB.ok) throw new Error("business creation failed");
      const callId = seedCall({ callStartedAt: "2026-10-21T09:00:00.000Z" });

      const first = await adminAssignCallToBusiness(callId, bizA.business.id);
      expect(first).toMatchObject({
        ok: true,
        previousBusinessId: null,
        businessClientUid: bizA.business.clientUid,
      });
      const row = getDb()
        .prepare("SELECT businessId, updatedAt FROM calls WHERE id = ?")
        .get(callId) as { businessId: string; updatedAt: string };
      expect(row.businessId).toBe(bizA.business.id);
      expect(row.updatedAt).toBeTruthy();

      const second = await adminAssignCallToBusiness(callId, bizB.business.id);
      expect(second).toMatchObject({
        ok: true,
        previousBusinessId: bizA.business.id,
      });
    });

    it("answers call_not_found and business_not_found", async () => {
      const biz = await adminCreateBusiness({ phoneNumber: "+18139990003" });
      if (!biz.ok) throw new Error("business creation failed");

      expect(
        await adminAssignCallToBusiness("no-such-call", biz.business.id)
      ).toEqual({ ok: false, reason: "call_not_found" });

      const callId = seedCall({ callStartedAt: "2026-10-21T10:00:00.000Z" });
      expect(
        await adminAssignCallToBusiness(callId, "no-such-business")
      ).toEqual({ ok: false, reason: "business_not_found" });
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