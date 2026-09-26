import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

// Point the app database at a throwaway file *before* `./database` opens it.
const testDbPath = path.join(os.tmpdir(), `callflow-waitlist-test-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = testDbPath;

const {
  addWaitlistSignup,
  checkSmsVerificationCode,
  createBusiness,
  getWaitlistSignups,
  setSmsVerificationCode,
} = await import("./db");

type NewBusiness = Parameters<typeof createBusiness>[0];

function seed(overrides: Partial<NewBusiness> = {}): NewBusiness {
  return {
    phoneNumber: "+15550001111",
    carrier: "other",
    forwardingStatus: "pending",
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
    ...overrides,
  };
}

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${testDbPath}${suffix}`, { force: true });
    } catch {
      // Windows keeps the file locked while the connection is open.
    }
  }
}

afterAll(cleanup);

describe("waitlist", () => {
  it("records a signup and is idempotent per email", async () => {
    const first = await addWaitlistSignup("Owner@Example.com");
    expect(first.created).toBe(true);
    expect(first.signup.email).toBe("owner@example.com");

    const second = await addWaitlistSignup("OWNER@example.com");
    expect(second.created).toBe(false);
    expect(second.signup.id).toBe(first.signup.id);

    const all = await getWaitlistSignups();
    expect(all).toHaveLength(1);
  });

  it("keeps the source label", async () => {
    const { signup } = await addWaitlistSignup("tester@example.com", "landing");
    expect(signup.source).toBe("landing");
  });
});

describe("SMS verification codes", () => {
  it("accepts the stored code once, then consumes it", async () => {
    const business = await createBusiness(seed());
    await setSmsVerificationCode(business.id, "123456");

    expect(await checkSmsVerificationCode(business.id, "123456")).toBe(true);
    // Consumed — a replay must fail.
    expect(await checkSmsVerificationCode(business.id, "123456")).toBe(false);
  });

  it("rejects a wrong code", async () => {
    const business = await createBusiness(seed({ phoneNumber: "+15550002222" }));
    await setSmsVerificationCode(business.id, "111111");
    expect(await checkSmsVerificationCode(business.id, "000000")).toBe(false);
  });

  it("rejects when no code was ever issued", async () => {
    const business = await createBusiness(seed({ phoneNumber: "+15550003333" }));
    expect(await checkSmsVerificationCode(business.id, "123456")).toBe(false);
  });
});
