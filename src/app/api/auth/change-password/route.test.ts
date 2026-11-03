import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  hashBusinessPassword,
  verifyBusinessPassword,
} from "@/lib/business-password";
import { businessSessionCookieName, createBusinessSessionToken } from "@/lib/business-session";
import { closeDb, getDb } from "@/lib/database";
import { resetRateLimits } from "@/lib/rate-limit";
import {
  MISSING_CURRENT_PASSWORD_ERROR,
  NO_SESSION_ERROR,
  POST,
  WRONG_CURRENT_PASSWORD_ERROR,
} from "./route";

const TEST_SECRET = "change-password-route-test-secret";
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-change-password-test-${process.pid}-${Date.now()}.db`
);
process.env.DATABASE_PATH = TEST_DB_PATH;

function seedBusiness(id: string, passwordHash: string | null): void {
  const now = new Date().toISOString();
  // phoneNumber carries a UNIQUE index → derive a distinct number per id.
  const suffix = (id.replace(/\D/g, "") || "0").padStart(4, "0");
  getDb()
    .prepare(
      `INSERT INTO businesses
         (id, phoneNumber, billingName, billingEmail, passwordHash, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, `+1555000${suffix}`, "Reeves Plumbing", "owner@reeves.test", passwordHash, now, now);
}

function storedHash(id: string): string | null {
  const row = getDb().prepare("SELECT passwordHash FROM businesses WHERE id = ?").get(id) as
    | { passwordHash: string | null }
    | undefined;
  return row?.passwordHash ?? null;
}

/** A real owner session cookie — the same HMAC token every existing route trusts. */
function ownerCookie(businessId = "biz-account-1"): string {
  return `${businessSessionCookieName()}=${createBusinessSessionToken(businessId)}`;
}

function changeRequest(body: unknown, cookie?: string, bodyText?: string): Request {
  return new Request("http://localhost:3000/api/auth/change-password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.30",
      ...(cookie ? { cookie } : {}),
    },
    body: bodyText ?? JSON.stringify(body),
  });
}

const CURRENT = "owner-password-1";
const NEXT = "owner-password-2";

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    resetRateLimits();
    seedBusiness("biz-account-1", hashBusinessPassword(CURRENT));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
    getDb().prepare("DELETE FROM businesses").run();
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
  });

  it("401s without a session cookie", async () => {
    const response = await POST(changeRequest({ newPassword: NEXT, confirm: NEXT }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: NO_SESSION_ERROR });
  });

  it("changes the password and stores the new scrypt hash", async () => {
    const response = await POST(
      changeRequest(
        { currentPassword: CURRENT, newPassword: NEXT, confirm: NEXT },
        ownerCookie()
      )
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const hash = storedHash("biz-account-1");
    expect(hash).not.toBeNull();
    expect(verifyBusinessPassword(NEXT, hash!)).toBe(true);
    expect(verifyBusinessPassword(CURRENT, hash!)).toBe(false);
  });

  it("refuses a wrong current password and leaves the hash untouched", async () => {
    const before = storedHash("biz-account-1");
    const response = await POST(
      changeRequest(
        { currentPassword: "not-the-password", newPassword: NEXT, confirm: NEXT },
        ownerCookie()
      )
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: WRONG_CURRENT_PASSWORD_ERROR });
    expect(storedHash("biz-account-1")).toBe(before);
  });

  it("requires the current password when one is already set", async () => {
    const response = await POST(
      changeRequest({ newPassword: NEXT, confirm: NEXT }, ownerCookie())
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: MISSING_CURRENT_PASSWORD_ERROR });
  });

  it("enforces the shared password policy before touching the database", async () => {
    const short = await POST(
      changeRequest(
        { currentPassword: CURRENT, newPassword: "short", confirm: "short" },
        ownerCookie()
      )
    );
    expect(short.status).toBe(400);
    expect(((await short.json()) as { error: string }).error).toMatch(/at least 8 characters/i);

    const mismatch = await POST(
      changeRequest(
        { currentPassword: CURRENT, newPassword: NEXT, confirm: `${NEXT}x` },
        ownerCookie()
      )
    );
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { error: string }).error).toMatch(/do not match/i);
  });

  it("lets an owner with no password yet set one (nothing to confirm against)", async () => {
    seedBusiness("biz-account-2", null);

    const response = await POST(
      changeRequest({ newPassword: NEXT, confirm: NEXT }, ownerCookie("biz-account-2"))
    );
    expect(response.status).toBe(200);
    expect(verifyBusinessPassword(NEXT, storedHash("biz-account-2")!)).toBe(true);
  });

  it("404s when the session points at a business that no longer exists", async () => {
    const response = await POST(
      changeRequest({ newPassword: NEXT, confirm: NEXT }, ownerCookie("biz-missing"))
    );
    expect(response.status).toBe(404);
  });

  it("rate-limits the 6th attempt in the window with 429", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await POST(
        changeRequest(
          { currentPassword: "wrong-wrong", newPassword: NEXT, confirm: NEXT },
          ownerCookie()
        )
      );
    }
    const blocked = await POST(
      changeRequest({ currentPassword: CURRENT, newPassword: NEXT, confirm: NEXT }, ownerCookie())
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
  });
});
