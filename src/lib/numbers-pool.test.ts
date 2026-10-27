import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "./database";
import { createBusiness } from "./db";
import {
  addNumbers,
  assignNumber,
  listPool,
  releaseNumber,
} from "./numbers-pool";

// Both storage locations are pointed at throwaway temp files BEFORE the first
// lazy getDb()/pool read inside a test — the modules read the env per call.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-numbers-pool-${process.pid}-${Date.now()}.db`
);
const TEST_POOL_PATH = path.join(
  os.tmpdir(),
  `callflow-numbers-pool-${process.pid}-${Date.now()}.json`
);
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.NUMBERS_POOL_PATH = TEST_POOL_PATH;

function poolPath(): string {
  return process.env.NUMBERS_POOL_PATH ?? TEST_POOL_PATH;
}

/** Minimal business row factory (same required shape as the other suites). */
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

beforeEach(() => {
  fs.rmSync(poolPath(), { force: true });
  getDb().prepare("DELETE FROM businesses").run();
});

afterEach(() => {
  fs.rmSync(poolPath(), { force: true });
});

afterAll(() => {
  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
  delete process.env.DATABASE_PATH;
  delete process.env.NUMBERS_POOL_PATH;
});

describe("pool file lifecycle", () => {
  it("creates the pool file as [] on first use", async () => {
    expect(fs.existsSync(poolPath())).toBe(false);
    expect(listPool()).toEqual([]);
    expect(fs.existsSync(poolPath())).toBe(true);
    expect(fs.readFileSync(poolPath(), "utf8").trim()).toBe("[]");
  });

  it("throws loudly on a malformed pool file instead of guessing", async () => {
    fs.writeFileSync(poolPath(), "{not json");
    expect(() => listPool()).toThrow(/not valid JSON/);
    fs.writeFileSync(poolPath(), '[{"number": 5}]');
    expect(() => listPool()).toThrow(/malformed/);
  });
});

describe("assignNumber", () => {
  it("assigns the first available number and mirrors it on the business row", async () => {
    fs.writeFileSync(
      poolPath(),
      JSON.stringify([
        { number: "+15550100001", status: "available", businessId: null, assignedAt: null },
        { number: "+15550100002", status: "available", businessId: null, assignedAt: null },
      ])
    );
    const business = await makeBusiness("+13125550100", "Acme");
    const result = await assignNumber(business.id, "+13125550100");
    expect(result).toEqual({ assignedNumber: "+15550100001", pending: false });

    const pool = listPool();
    expect(pool[0]).toMatchObject({
      number: "+15550100001",
      status: "assigned",
      businessId: business.id,
    });
    expect(pool[0].assignedAt).toBeTruthy();
    expect(pool[1]).toMatchObject({ number: "+15550100002", status: "available" });

    const { getBusinessById } = await import("./db");
    expect((await getBusinessById(business.id))?.assignedNumber).toBe("+15550100001");
  });

  it("prefers the owner's area code before falling back to the first available", async () => {
    fs.writeFileSync(
      poolPath(),
      JSON.stringify([
        { number: "+15550100001", status: "available", businessId: null, assignedAt: null },
        { number: "+12125550100", status: "available", businessId: null, assignedAt: null },
      ])
    );
    const business = await makeBusiness("+13125550100");
    const result = await assignNumber(business.id, "+12125550123");
    expect(result.assignedNumber).toBe("+12125550100");
  });

  it("accepts a leniently formatted owner phone for the area-code preference", async () => {
    fs.writeFileSync(
      poolPath(),
      JSON.stringify([
        { number: "+15550100001", status: "available", businessId: null, assignedAt: null },
        { number: "+12125550100", status: "available", businessId: null, assignedAt: null },
      ])
    );
    const business = await makeBusiness("+13125550100");
    const result = await assignNumber(business.id, "(212) 555-0123");
    expect(result.assignedNumber).toBe("+12125550100");
  });

  it("is idempotent — a business that already has a number keeps it", async () => {
    fs.writeFileSync(
      poolPath(),
      JSON.stringify([
        { number: "+15550100001", status: "available", businessId: null, assignedAt: null },
      ])
    );
    const business = await makeBusiness("+13125550100");
    await assignNumber(business.id, "+13125550100");
    const again = await assignNumber(business.id, "+13125550100");
    expect(again).toEqual({ assignedNumber: "+15550100001", pending: false });
    const pool = listPool();
    expect(pool.filter((e) => e.status === "assigned")).toHaveLength(1);
    expect(pool.filter((e) => e.status === "available")).toHaveLength(0);
  });

  it("marks the business pending without throwing when the pool is empty", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const business = await makeBusiness("+13125550100", "Dynamo Plumbers");
    const result = await assignNumber(business.id, "+13125550100");
    expect(result).toEqual({ assignedNumber: null, pending: true });

    const { getBusinessById } = await import("./db");
    expect((await getBusinessById(business.id))?.assignedNumber).toBeNull();
    // Two errors when SMTP is unconfigured: the POOL EMPTY alert + the SMTP hint.
    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("POOL EMPTY"))).toBe(true);
    errorSpy.mockRestore();
  });
});

describe("releaseNumber", () => {
  it("returns the number to the pool and clears the business row", async () => {
    fs.writeFileSync(
      poolPath(),
      JSON.stringify([
        { number: "+15550100001", status: "available", businessId: null, assignedAt: null },
      ])
    );
    const business = await makeBusiness("+13125550100");
    await assignNumber(business.id, "+13125550100");

    const released = await releaseNumber(business.id);
    expect(released).toBe(true);
    expect(listPool()[0]).toEqual({
      number: "+15550100001",
      status: "available",
      businessId: null,
      assignedAt: null,
    });
    const { getBusinessById } = await import("./db");
    expect((await getBusinessById(business.id))?.assignedNumber).toBeNull();

    // The released number can be assigned again.
    const next = await makeBusiness("+13125550200");
    const result = await assignNumber(next.id, "+13125550200");
    expect(result.assignedNumber).toBe("+15550100001");
  });

  it("still clears the business row when no pool entry exists (legacy manual assignment)", async () => {
    const business = await makeBusiness("+13125550100");
    await updateBusinessRow(business.id, { assignedNumber: "+15550100999" });
    const released = await releaseNumber(business.id);
    expect(released).toBe(false);
    const { getBusinessById } = await import("./db");
    expect((await getBusinessById(business.id))?.assignedNumber).toBeNull();
  });
});

describe("addNumbers", () => {
  it("adds valid new numbers as available and reports added vs skipped", async () => {
    fs.writeFileSync(
      poolPath(),
      JSON.stringify([
        { number: "+15550100001", status: "available", businessId: null, assignedAt: null },
      ])
    );
    const result = await addNumbers(
      ["+15550100001", "+15550100002", "5550100003", "not-a-number", "+15550100002"].join("\n")
    );
    expect(result.added).toEqual(["+15550100002"]);
    // "5550100003" is 10 digits without the +1 → invalid; the exact duplicate too.
    expect(result.skippedInvalid).toEqual(["5550100003", "not-a-number"]);
    expect(result.skippedDuplicate).toEqual(["+15550100001", "+15550100002"]);

    const pool = listPool();
    expect(pool).toHaveLength(2);
    expect(pool[1]).toMatchObject({ number: "+15550100002", status: "available" });
  });

  it("never re-adds a number already live on a business row", async () => {
    const business = await makeBusiness("+13125550100");
    await updateBusinessRow(business.id, { assignedNumber: "+15550100999" });
    const result = await addNumbers("+15550100999\n+15550100004");
    expect(result.skippedDuplicate).toEqual(["+15550100999"]);
    expect(result.added).toEqual(["+15550100004"]);
  });
});

async function updateBusinessRow(id: string, data: { assignedNumber: string }) {
  const { updateBusiness } = await import("./db");
  await updateBusiness(id, data);
}