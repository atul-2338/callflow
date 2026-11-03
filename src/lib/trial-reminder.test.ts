import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createBusiness, getBusinessById, updateBusiness } from "./db";
import { trialReminder, type ReminderDeps } from "./trial-reminder";

/**
 * Behaviour of the day-2 "first payment is on ..." email.
 *
 * Real SQLite in a TEMPORARY DATABASE_PATH (never the dev database), with the
 * mailer and clock injected, so nothing touches SMTP or the network.
 */

const SMTP = {
  host: "smtp.test.local",
  port: 587,
  user: "u",
  pass: "p",
  from: "Callflow <a@t.local>",
};

let tmpDir = "";
let now = new Date("2026-11-03T12:00:00.000Z");

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "callflow-trial-reminder-"));
  process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
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
});

function startOf(offsetMs: number): string {
  return new Date(now.getTime() - offsetMs).toISOString();
}

async function freshBusiness(overrides: Record<string, unknown> = {}) {
  const business = await createBusiness({
    phoneNumber: "+15550001234",
    carrier: "other",
    forwardingStatus: "pending",
    lastVerifiedAt: null,
    pendingVerificationFor: null,
    pendingVerificationExpiresAt: null,
    ...overrides,
  });
  return business;
}

function deps(sent = true): {
  deps: ReminderDeps;
  send: ReturnType<typeof vi.fn>;
  config: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn(async () => (sent ? { sent: true } : { sent: false, error: "x" }));
  const config = vi.fn(() => SMTP);
  return {
    deps: { send, readConfig: config, now: () => now },
    send,
    config,
  };
}

beforeEach(async () => {
  now = new Date("2026-11-03T12:00:00.000Z");
  const { getDb } = await import("./database");
  getDb().prepare("DELETE FROM businesses").run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trial reminder (day 2)", () => {
  it("stays quiet on day 1", async () => {
    const business = await freshBusiness({
      trialStartedAt: startOf(23 * 60 * 60 * 1000),
      notificationEmail: "owner@example.com",
    });
    const d = deps();
    expect(await trialReminder(business, d.deps)).toBe("not_due");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("sends once on day 2 with the charge date, then never again", async () => {
    const business = await freshBusiness({
      trialStartedAt: startOf(50 * 60 * 60 * 1000),
      notificationEmail: "owner@example.com",
    });
    const d = deps();
    expect(await trialReminder(business, d.deps)).toBe("sent");
    expect(d.send).toHaveBeenCalledTimes(1);

    const stored = await getBusinessById(business.id);
    expect(stored?.trialReminderEmailAt).toBeTruthy();

    // Same day, next visit: the stamp blocks a second send.
    expect(await trialReminder(stored!, d.deps)).toBe("already_sent");
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("does not send for an expired trial (the trial-ended email owns that case)", async () => {
    const business = await freshBusiness({
      trialStartedAt: startOf(4 * 24 * 60 * 60 * 1000),
      notificationEmail: "owner@example.com",
    });
    const d = deps();
    expect(await trialReminder(business, d.deps)).toBe("trial_over");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("reports no_email / no_smtp instead of throwing", async () => {
    const business = await freshBusiness({
      trialStartedAt: startOf(50 * 60 * 60 * 1000),
    });
    const d = deps();
    expect(await trialReminder(business, d.deps)).toBe("no_email");

    const withEmail = await updateBusiness(business.id, {
      billingEmail: "owner@example.com",
    });
    d.deps.readConfig = () => null;
    expect(await trialReminder(withEmail!, d.deps)).toBe("no_smtp");
    expect(d.send).not.toHaveBeenCalled();
  });

  it("records send_failed without stamping, so the next visit retries", async () => {
    const business = await freshBusiness({
      trialStartedAt: startOf(50 * 60 * 60 * 1000),
      notificationEmail: "owner@example.com",
    });
    const d = deps(false);
    expect(await trialReminder(business, d.deps)).toBe("send_failed");
    expect((await getBusinessById(business.id))?.trialReminderEmailAt).toBeNull();
  });
});
