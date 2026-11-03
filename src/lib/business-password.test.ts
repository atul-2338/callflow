import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

import {
  consumeSetupToken,
  findBusinessCredentialsByEmail,
  generateSetupToken,
  hashBusinessPassword,
  hashSetupToken,
  inspectSetupToken,
  passwordPolicyError,
  setupPasswordUrl,
  SETUP_TOKEN_TTL_MS,
  verifyBusinessPassword,
} from "./business-password";
import { closeDb, getDb } from "./database";

// Throwaway database: these tests write businesses rows. getDb() resolves
// DATABASE_PATH lazily on first use and nothing opens at import time, so the
// module-scope assignment below is early enough.
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `callflow-business-password-test-${process.pid}-${Date.now()}.db`
);
process.env.DATABASE_PATH = TEST_DB_PATH;

interface SeedInput {
  id?: string;
  email?: string | null;
  passwordHash?: string | null;
  setupTokenHash?: string | null;
  setupTokenExpiry?: string | null;
}

function seedBusiness(input: SeedInput = {}): string {
  const id = input.id ?? `biz-${Math.random().toString(16).slice(2)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO businesses
         (id, phoneNumber, billingName, billingEmail, passwordHash,
          setupTokenHash, setupTokenExpiry, createdAt, updatedAt)
       VALUES (@id, @phoneNumber, @billingName, @billingEmail, @passwordHash,
               @setupTokenHash, @setupTokenExpiry, @createdAt, @updatedAt)`
    )
    .run({
      id,
      phoneNumber: "+15550000001",
      billingName: "Reeves Plumbing",
      billingEmail: input.email === undefined ? "owner@reeves.test" : input.email,
      passwordHash: input.passwordHash ?? null,
      setupTokenHash: input.setupTokenHash ?? null,
      setupTokenExpiry: input.setupTokenExpiry ?? null,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

describe("passwordPolicyError", () => {
  it("requires a value, a minimum length and a matching confirmation", () => {
    expect(passwordPolicyError("", "")).toBe("Enter a new password.");
    expect(passwordPolicyError("short", "short")).toBe(
      "Password must be at least 8 characters."
    );
    expect(passwordPolicyError("long-enough-1", "long-enough-2")).toBe(
      "Passwords do not match."
    );
    expect(passwordPolicyError("long-enough-1", "long-enough-1")).toBeNull();
    // Length alone (no confirmation supplied) still passes.
    expect(passwordPolicyError("long-enough-1")).toBeNull();
  });
});

describe("password hashing", () => {
  it("round-trips and rejects the wrong password", () => {
    const stored = hashBusinessPassword("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyBusinessPassword("correct horse battery", stored)).toBe(true);
    expect(verifyBusinessPassword("wrong password", stored)).toBe(false);
  });

  it("fails closed on malformed or empty stored values", () => {
    expect(verifyBusinessPassword("anything", "")).toBe(false);
    expect(verifyBusinessPassword("anything", "not-a-hash")).toBe(false);
    expect(verifyBusinessPassword("", hashBusinessPassword("something"))).toBe(false);
  });

  it("never stores the plaintext password", () => {
    const id = seedBusiness({ passwordHash: hashBusinessPassword("plain-secret-1") });
    const row = getDb()
      .prepare("SELECT passwordHash FROM businesses WHERE id = ?")
      .get(id) as { passwordHash: string };
    expect(row.passwordHash).not.toContain("plain-secret-1");
    expect(row.passwordHash.startsWith("scrypt$")).toBe(true);
  });
});

describe("setup tokens", () => {
  it("mints a 48-hour token and stores only its SHA-256", () => {
    const minted = generateSetupToken(new Date("2026-10-27T00:00:00.000Z"));
    expect(minted.token.length).toBeGreaterThan(20);
    expect(minted.tokenHash).toBe(hashSetupToken(minted.token));
    expect(minted.tokenHash).not.toBe(minted.token);
    expect(new Date(minted.expiresAt).getTime()).toBe(
      new Date("2026-10-27T00:00:00.000Z").getTime() + SETUP_TOKEN_TTL_MS
    );
  });

  it("builds an absolute /setup-password URL", () => {
    expect(setupPasswordUrl("https://callflow.biz/", "abc")).toBe(
      "https://callflow.biz/setup-password?token=abc"
    );
  });

  it("reports invalid / expired / valid states", () => {
    expect(inspectSetupToken("")).toEqual({ state: "invalid" });
    expect(inspectSetupToken("never-issued")).toEqual({ state: "invalid" });

    const expired = generateSetupToken(new Date(Date.now() - SETUP_TOKEN_TTL_MS - 1000));
    const expiredId = seedBusiness({
      setupTokenHash: expired.tokenHash,
      setupTokenExpiry: expired.expiresAt,
    });
    expect(inspectSetupToken(expired.token)).toEqual({ state: "expired" });

    const live = generateSetupToken();
    const liveId = seedBusiness({
      setupTokenHash: live.tokenHash,
      setupTokenExpiry: live.expiresAt,
    });
    const state = inspectSetupToken(live.token);
    expect(state.state).toBe("valid");
    if (state.state === "valid") {
      expect(state.businessId).toBe(liveId);
      expect(state.expiresAt).toBe(live.expiresAt);
    }

    // An expired link can never be consumed…
    expect(
      consumeSetupToken(expired.token, hashBusinessPassword("long-enough-1"))
    ).toEqual({ ok: false, reason: "expired" });
    // …and that attempt leaves the row's password untouched.
    const expiredRow = getDb()
      .prepare("SELECT passwordHash FROM businesses WHERE id = ?")
      .get(expiredId) as { passwordHash: string | null };
    expect(expiredRow.passwordHash).toBeNull();
  });

  it("consumes a live token exactly once and clears it", () => {
    const minted = generateSetupToken();
    const id = seedBusiness({
      setupTokenHash: minted.tokenHash,
      setupTokenExpiry: minted.expiresAt,
    });
    const stored = hashBusinessPassword("owner-password-1");

    expect(consumeSetupToken(minted.token, stored)).toEqual({ ok: true, businessId: id });

    const row = getDb()
      .prepare(
        "SELECT passwordHash, setupTokenHash, setupTokenExpiry, setupTokenUsedAt FROM businesses WHERE id = ?"
      )
      .get(id) as {
      passwordHash: string | null;
      setupTokenHash: string | null;
      setupTokenExpiry: string | null;
      setupTokenUsedAt: string | null;
    };
    expect(row.passwordHash).toBe(stored);
    expect(row.setupTokenHash).toBeNull();
    expect(row.setupTokenExpiry).toBeNull();
    expect(row.setupTokenUsedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(verifyBusinessPassword("owner-password-1", row.passwordHash ?? "")).toBe(true);

    // A second use of the same link is refused. Because a successful use
    // CLEARS the stored hash (businesses.setupTokenHash → NULL), a replay is
    // indistinguishable from a token that never existed — "invalid", not
    // "used". That is the intended privacy property: nothing here can be probed
    // to learn which links were ever issued. ("used" is still returned in the
    // one real race — two submissions passing the read before either writes.)
    expect(consumeSetupToken(minted.token, hashBusinessPassword("another-pass-1"))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(inspectSetupToken(minted.token)).toEqual({ state: "invalid" });

    // The second attempt's password was never written.
    const after = getDb()
      .prepare("SELECT passwordHash FROM businesses WHERE id = ?")
      .get(id) as { passwordHash: string | null };
    expect(after.passwordHash).toBe(stored);
  });
});

describe("findBusinessCredentialsByEmail", () => {
  it("matches loosely and prefers the row that already has a password", () => {
    const stored = hashBusinessPassword("owner-password-2");
    seedBusiness({ id: "biz-no-password", email: "Dual@Example.test", passwordHash: null });
    seedBusiness({
      id: "biz-with-password",
      email: "dual@example.test",
      passwordHash: stored,
    });

    expect(findBusinessCredentialsByEmail("  DUAL@EXAMPLE.TEST ")).toEqual({
      businessId: "biz-with-password",
      passwordHash: stored,
    });
  });

  it("reports a known account with no password yet, and null for strangers", () => {
    seedBusiness({ id: "biz-pending", email: "pending@example.test", passwordHash: null });
    expect(findBusinessCredentialsByEmail("pending@example.test")).toEqual({
      businessId: "biz-pending",
      passwordHash: null,
    });

    expect(findBusinessCredentialsByEmail("")).toBeNull();
    expect(findBusinessCredentialsByEmail("nobody@example.test")).toBeNull();
  });
});

afterAll(() => {
  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});
