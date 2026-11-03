import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashBusinessPassword } from "@/lib/business-password";
import { businessSessionCookieName, verifyBusinessSessionToken } from "@/lib/business-session";
import { closeDb, getDb } from "@/lib/database";
import { resetRateLimits } from "@/lib/rate-limit";
import { INVALID_CREDENTIALS_ERROR, NOT_SET_UP_ERROR, POST } from "./route";

const TEST_HASH = hashBusinessPassword("owner-password-1");
const TEST_SECRET = "login-route-test-secret";
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-owner-login-test-${process.pid}-${Date.now()}.db`
);
process.env.DATABASE_PATH = TEST_DB_PATH;

function seedBusiness(id: string, email: string, passwordHash: string | null): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO businesses
         (id, phoneNumber, billingName, billingEmail, passwordHash, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, "+15550000009", "Reeves Plumbing", email, passwordHash, now, now);
}

function loginRequest(body: unknown, bodyText?: string): Request {
  return new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.9",
    },
    body: bodyText ?? JSON.stringify(body),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.stubEnv("BUSINESS_SESSION_SECRET", TEST_SECRET);
    resetRateLimits();
    seedBusiness("biz-login-1", "owner@reeves.test", TEST_HASH);
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

  it("mints the existing owner session cookie on success", async () => {
    const response = await POST(loginRequest({ email: "owner@reeves.test", password: "owner-password-1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie.startsWith(`${businessSessionCookieName()}=`)).toBe(true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    // The cookie is the SAME HMAC token every existing route already trusts.
    const token = cookie.split(";")[0].slice(businessSessionCookieName().length + 1);
    expect(verifyBusinessSessionToken(token)).toBe("biz-login-1");
  });

  it("answers one generic sentence for a wrong password", async () => {
    const response = await POST(loginRequest({ email: "owner@reeves.test", password: "nope-nope-nope" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: INVALID_CREDENTIALS_ERROR });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("answers the identical sentence for an unknown email (no enumeration)", async () => {
    const response = await POST(loginRequest({ email: "stranger@example.test", password: "owner-password-1" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: INVALID_CREDENTIALS_ERROR });
  });

  it("treats a malformed body exactly like wrong credentials", async () => {
    const response = await POST(loginRequest({}, "not json"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: INVALID_CREDENTIALS_ERROR });
  });

  it("tells an owner whose password was never set to use the setup link", async () => {
    seedBusiness("biz-login-pending", "pending@reeves.test", null);
    const response = await POST(loginRequest({ email: "pending@reeves.test", password: "anything-here" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: NOT_SET_UP_ERROR });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("matches the email case- and whitespace-insensitively", async () => {
    const response = await POST(
      loginRequest({ email: "  OWNER@Reeves.Test ", password: "owner-password-1" })
    );
    expect(response.status).toBe(200);
  });

  it("rate-limits the 6th attempt in the window with 429", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await POST(loginRequest({ email: "owner@reeves.test", password: "wrong-wrong" }))).status).toBe(401);
    }
    // Even the CORRECT password is refused once the window is exhausted.
    const response = await POST(loginRequest({ email: "owner@reeves.test", password: "owner-password-1" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).not.toBeNull();
  });
});
