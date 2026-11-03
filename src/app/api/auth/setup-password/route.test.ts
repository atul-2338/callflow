import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  generateSetupToken,
  SETUP_TOKEN_TTL_MS,
  verifyBusinessPassword,
} from "@/lib/business-password";
import { closeDb, getDb } from "@/lib/database";
import { resetRateLimits } from "@/lib/rate-limit";
import { LINK_INVALID_ERROR, POST } from "./route";

const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-setup-password-test-${process.pid}-${Date.now()}.db`
);
process.env.DATABASE_PATH = TEST_DB_PATH;

function seedBusinessWithToken(id: string, expiresAt: string): string {
  const token = generateSetupToken(new Date(Date.now() - SETUP_TOKEN_TTL_MS + 60_000));
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO businesses
         (id, phoneNumber, billingName, billingEmail, setupTokenHash, setupTokenExpiry,
          createdAt, updatedAt)
       VALUES (@id, @phoneNumber, @billingName, @billingEmail, @setupTokenHash,
               @setupTokenExpiry, @createdAt, @updatedAt)`
    )
    .run({
      id,
      phoneNumber: "+15550000011",
      billingName: "Reeves Plumbing",
      billingEmail: "owner@reeves.test",
      setupTokenHash: token.tokenHash,
      setupTokenExpiry: expiresAt,
      createdAt: now,
      updatedAt: now,
    });
  return token.token;
}

function setupRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/auth/setup-password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.11",
    },
    body: JSON.stringify(body),
  });
}

function storedPassword(id: string): string | null {
  const row = getDb()
    .prepare("SELECT passwordHash FROM businesses WHERE id = ?")
    .get(id) as { passwordHash: string | null } | undefined;
  return row?.passwordHash ?? null;
}

describe("POST /api/auth/setup-password", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  afterEach(() => {
    resetRateLimits();
    getDb().prepare("DELETE FROM businesses").run();
  });

  afterAll(() => {
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
    }
  });

  it("sets the password once and clears the link", async () => {
    const token = seedBusinessWithToken("biz-setup-1", new Date(Date.now() + 60_000).toISOString());
    const response = await POST(
      setupRequest({ token, password: "owner-password-1", confirm: "owner-password-1" })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const hash = storedPassword("biz-setup-1");
    expect(hash?.startsWith("scrypt$")).toBe(true);
    expect(verifyBusinessPassword("owner-password-1", hash ?? "")).toBe(true);

    const row = getDb()
      .prepare("SELECT setupTokenHash, setupTokenExpiry FROM businesses WHERE id = ?")
      .get("biz-setup-1") as { setupTokenHash: string | null; setupTokenExpiry: string | null };
    expect(row.setupTokenHash).toBeNull();
    expect(row.setupTokenExpiry).toBeNull();
  });

  it("refuses the same link a second time and keeps the first password", async () => {
    const token = seedBusinessWithToken("biz-setup-2", new Date(Date.now() + 60_000).toISOString());
    await POST(setupRequest({ token, password: "owner-password-1", confirm: "owner-password-1" }));
    const first = storedPassword("biz-setup-2");

    const replay = await POST(
      setupRequest({ token, password: "another-password-1", confirm: "another-password-1" })
    );
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: LINK_INVALID_ERROR });
    expect(storedPassword("biz-setup-2")).toBe(first);
  });

  it("refuses unknown and expired links with the same sentence", async () => {
    const unknown = await POST(
      setupRequest({
        token: "never-issued",
        password: "owner-password-1",
        confirm: "owner-password-1",
      })
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: LINK_INVALID_ERROR });

    const token = seedBusinessWithToken("biz-setup-3", new Date(Date.now() - 1000).toISOString());
    const expired = await POST(
      setupRequest({ token, password: "owner-password-1", confirm: "owner-password-1" })
    );
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ error: LINK_INVALID_ERROR });
    expect(storedPassword("biz-setup-3")).toBeNull();
  });

  it("enforces the shared password rule server-side", async () => {
    const token = seedBusinessWithToken("biz-setup-4", new Date(Date.now() + 60_000).toISOString());

    const short = await POST(setupRequest({ token, password: "short", confirm: "short" }));
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "Password must be at least 8 characters." });

    const mismatch = await POST(
      setupRequest({ token, password: "owner-password-1", confirm: "owner-password-2" })
    );
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({ error: "Passwords do not match." });

    // Neither rejected attempt wrote anything, so the link still works.
    expect(storedPassword("biz-setup-4")).toBeNull();
    const ok = await POST(
      setupRequest({ token, password: "owner-password-1", confirm: "owner-password-1" })
    );
    expect(ok.status).toBe(200);
  });

  it("rejects a malformed body without touching the database", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/auth/setup-password", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
        body: "not json",
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: LINK_INVALID_ERROR });
  });

  it("rate-limits repeated submissions", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await POST(
        setupRequest({
          token: "nope",
          password: "owner-password-1",
          confirm: "owner-password-1",
        })
      );
    }
    const response = await POST(
      setupRequest({ token: "nope", password: "owner-password-1", confirm: "owner-password-1" })
    );
    expect(response.status).toBe(429);
  });
});
