import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashAdminPassword } from "@/lib/admin-password";
import { resetRateLimits } from "@/lib/rate-limit";
import { closeDb, getDb } from "@/lib/database";
import { POST } from "./route";

const TEST_HASH = hashAdminPassword("admin-pass-123456");
const TEST_SECRET = "login-route-test-secret";
// The success path now writes an admin_login audit row, so this test file
// needs its own throwaway database. getDb() resolves DATABASE_PATH lazily on
// first use and nothing opens at import time, so a module-scope assignment is
// early enough even with the static route import above.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-admin-login-test-${process.pid}-${Date.now()}.db`
);
process.env.DATABASE_PATH = TEST_DB_PATH;

function loginRequest(password: unknown): Request {
  return new Request("http://localhost:3000/api/admin/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.7",
    },
    body: JSON.stringify({ password }),
  });
}

describe("POST /api/admin/login", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", TEST_HASH);
    vi.stubEnv("ADMIN_SESSION_SECRET", TEST_SECRET);
    resetRateLimits();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
  });

  it("404s when the admin env vars are missing (fail closed)", async () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    const response = await POST(loginRequest("admin-pass-123456"));
    expect(response.status).toBe(404);
  });

  it("401s on a wrong password with a generic message", async () => {
    const response = await POST(loginRequest("nope-nope-nope"));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("Invalid credentials");
  });

  it("401s on malformed/empty bodies without leaking specifics", async () => {
    const malformed = new Request("http://localhost:3000/api/admin/login", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.7" },
      body: "not json",
    });
    expect((await POST(malformed)).status).toBe(401);
    expect((await POST(loginRequest(null))).status).toBe(401);
    expect((await POST(loginRequest(42))).status).toBe(401);
  });

  it("sets the admin session cookie on success", async () => {
    const response = await POST(loginRequest("admin-pass-123456"));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie.startsWith("callflow_admin_session=")).toBe(true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=28800");
  });

  it("writes an admin_login audit row on success", async () => {
    const response = await POST(loginRequest("admin-pass-123456"));
    expect(response.status).toBe(200);
    const row = getDb()
      .prepare(
        "SELECT target, details, ip, createdAt FROM admin_audit_log WHERE action = 'admin_login'"
      )
      .get() as
      | { target: string | null; details: string | null; ip: string; createdAt: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.ip).toBe("203.0.113.7");
    expect(row?.target).toBeNull();
    expect(row?.details).toBeNull();
    expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rate-limits the 6th attempt in the window with 429", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await POST(loginRequest("wrong-wrong-wrong"));
      expect(response.status).toBe(401);
    }
    // Even the CORRECT password is refused once the window is exhausted.
    const response = await POST(loginRequest("admin-pass-123456"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).not.toBeNull();
  });
});