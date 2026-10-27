/**
 * Phase 5 safety net: every /api/admin/* route must reject callers that do
 * not carry a valid admin session. Unlike the route.test.ts files (which mock
 * requireAdminApi to exercise route behavior), these tests run the REAL guard
 * inside the real route handlers — nothing is mocked.
 *
 * /api/admin/login is intentionally reachable without a cookie — it IS the
 * authentication endpoint — so its unauthenticated rejection is the generic
 * 401 on bad credentials. The guarded routes must 401 before any database
 * access; none of the tests below open the database.
 *
 * The owner cookie used here is genuinely valid (minted by the real
 * business-session module): an owner login must never unlock admin APIs.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { businessSessionCookieName, createBusinessSessionToken } from "@/lib/business-session";
import { hashAdminPassword } from "@/lib/admin-password";
import { resetRateLimits } from "@/lib/rate-limit";

import { POST as numbersPOST } from "./numbers/route";
import { POST as releasePOST } from "./numbers/release/route";
import { POST as assignPOST } from "./businesses/[id]/assign/route";
import { POST as loginPOST } from "./login/route";
import { POST as logoutPOST } from "./logout/route";

const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-admin-guard-safety-${process.pid}-${Date.now()}.db`
);
// getDb() resolves lazily and the 401 paths below never touch the database;
// this only guarantees a stray access can never hit ./data/callflow.db.
process.env.DATABASE_PATH = TEST_DB_PATH;

const ADMIN_HASH = hashAdminPassword("admin-pass-123456");
const ADMIN_SECRET = "guard-safety-test-admin-secret";
const OWNER_SECRET = "guard-safety-test-owner-secret";

const NUMBERS_URL = "http://localhost:3000/api/admin/numbers";
const RELEASE_URL = "http://localhost:3000/api/admin/numbers/release";
const ASSIGN_URL = "http://localhost:3000/api/admin/businesses/some-biz-id/assign";
const LOGOUT_URL = "http://localhost:3000/api/admin/logout";
const LOGIN_URL = "http://localhost:3000/api/admin/login";

function request(url: string, cookie?: string): Request {
  return new Request(url, { method: "POST", headers: cookie ? { cookie } : {} });
}

function ownerCookie(): string {
  return `${businessSessionCookieName()}=${createBusinessSessionToken("biz-owner-1")}`;
}

function loginRequest(body: string): Request {
  return new Request(LOGIN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("admin API guard safety (real requireAdminApi)", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", ADMIN_HASH);
    vi.stubEnv("ADMIN_SESSION_SECRET", ADMIN_SECRET);
    vi.stubEnv("BUSINESS_SESSION_SECRET", OWNER_SECRET);
    resetRateLimits();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  afterAll(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
    delete process.env.DATABASE_PATH;
  });

  it("401s without a cookie on every guarded route", async () => {
    expect((await numbersPOST(request(NUMBERS_URL))).status).toBe(401);
    expect((await releasePOST(request(RELEASE_URL))).status).toBe(401);
    expect(
      (await assignPOST(request(ASSIGN_URL), { params: Promise.resolve({ id: "some-biz-id" }) })).status
    ).toBe(401);
    expect((await logoutPOST(request(LOGOUT_URL))).status).toBe(401);
  });

  it("401s on every guarded route when the only cookie is a valid owner session", async () => {
    const cookie = ownerCookie();
    expect((await numbersPOST(request(NUMBERS_URL, cookie))).status).toBe(401);
    expect((await releasePOST(request(RELEASE_URL, cookie))).status).toBe(401);
    expect(
      (await assignPOST(request(ASSIGN_URL, cookie), {
        params: Promise.resolve({ id: "some-biz-id" }),
      })).status
    ).toBe(401);
    expect((await logoutPOST(request(LOGOUT_URL, cookie))).status).toBe(401);
  });

  it("401s on /api/admin/login for a wrong password with the generic message", async () => {
    const response = await loginPOST(loginRequest(JSON.stringify({ password: "wrong-password" })));
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toMatch(/invalid credentials/i);
  });

  it("401s on /api/admin/login for a malformed body", async () => {
    const response = await loginPOST(loginRequest("{not-json"));
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toMatch(/invalid credentials/i);
  });
});