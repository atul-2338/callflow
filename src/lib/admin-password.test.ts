import { execFileSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";
import { hashAdminPassword, parseAdminPasswordHash, verifyAdminPassword } from "./admin-password";

const SCRIPT = path.resolve("scripts/admin-hash.mjs");
const TEST_PASSWORD = "test-password-123";

function runHashScript(input: string): string {
  // Piped stdin → the script's non-TTY path reads two lines and prints the
  // hash (and only the hash) on stdout.
  return execFileSync(process.execPath, [SCRIPT], { input, encoding: "utf8" });
}

describe("admin password hashing", () => {
  it("round-trips a password", () => {
    const stored = hashAdminPassword(TEST_PASSWORD);
    expect(parseAdminPasswordHash(stored)).not.toBeNull();
    expect(verifyAdminPassword(TEST_PASSWORD, stored)).toBe(true);
  });

  it("rejects the wrong password and empty input", () => {
    const stored = hashAdminPassword(TEST_PASSWORD);
    expect(verifyAdminPassword("wrong-password", stored)).toBe(false);
    expect(verifyAdminPassword("", stored)).toBe(false);
    expect(verifyAdminPassword(TEST_PASSWORD, "")).toBe(false);
  });

  it("rejects malformed stored hashes (fail closed)", () => {
    const stored = hashAdminPassword(TEST_PASSWORD);
    // Tampered hash digits still parse but must not verify.
    const tampered = `${stored.slice(0, -1)}${stored.endsWith("0") ? "1" : "0"}`;
    expect(verifyAdminPassword(TEST_PASSWORD, tampered)).toBe(false);
    expect(verifyAdminPassword(TEST_PASSWORD, "not-a-hash")).toBe(false);
    expect(verifyAdminPassword(TEST_PASSWORD, "md5$16384$8$1$aabb$ccdd")).toBe(false);
    expect(verifyAdminPassword(TEST_PASSWORD, "scrypt$16384$8$1$zzzz$ccdd")).toBe(false);
    expect(verifyAdminPassword(TEST_PASSWORD, "scrypt$abc$8$1$aabb$ccdd")).toBe(false);
    expect(verifyAdminPassword(TEST_PASSWORD, "scrypt$16384$8$1$aabb$cc")).toBe(false);
  });

  it("accepts a hash produced by the real scripts/admin-hash.mjs", () => {
    const stdout = runHashScript(`${TEST_PASSWORD}\n${TEST_PASSWORD}\n`);
    const hash = stdout.trim().split("\n").pop() ?? "";
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(verifyAdminPassword(TEST_PASSWORD, hash)).toBe(true);
    expect(verifyAdminPassword("wrong-password", hash)).toBe(false);
  });

  it("refuses mismatched confirmations and short passwords", () => {
    expect(() => runHashScript(`${TEST_PASSWORD}\nnope-123456789\n`)).toThrow();
    expect(() => runHashScript("short\nshort\n")).toThrow();
  });
});