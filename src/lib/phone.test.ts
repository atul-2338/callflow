import { describe, expect, it } from "vitest";

import {
  isValidPoolNumber,
  normalizeOwnerPhone,
  usAreaCode,
} from "./phone";

describe("isValidPoolNumber (strict pool format)", () => {
  it("accepts exactly +1 followed by 10 digits", () => {
    expect(isValidPoolNumber("+15550100001")).toBe(true);
    expect(isValidPoolNumber("  +15550100001 ")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isValidPoolNumber("5550100001")).toBe(false); // no +1
    expect(isValidPoolNumber("+1555010000")).toBe(false); // 9 digits
    expect(isValidPoolNumber("+155501000011")).toBe(false); // 11 digits
    expect(isValidPoolNumber("+1 555 010 0001")).toBe(false); // formatted
    expect(isValidPoolNumber("+447911123456")).toBe(false); // not US
    expect(isValidPoolNumber("")).toBe(false);
  });
});

describe("normalizeOwnerPhone (lenient owner input)", () => {
  it("normalizes US-formatted input to E.164", () => {
    expect(normalizeOwnerPhone("(212) 555-0123")).toBe("+12125550123");
    expect(normalizeOwnerPhone("212.555.0123")).toBe("+12125550123");
    expect(normalizeOwnerPhone("2125550123")).toBe("+12125550123");
    expect(normalizeOwnerPhone("1 212 555 0123")).toBe("+12125550123");
    expect(normalizeOwnerPhone("+12125550123")).toBe("+12125550123");
  });

  it("returns null for invalid or empty input instead of throwing", () => {
    expect(normalizeOwnerPhone("")).toBeNull();
    expect(normalizeOwnerPhone("   ")).toBeNull();
    expect(normalizeOwnerPhone("12345")).toBeNull();
    expect(normalizeOwnerPhone("not-a-phone")).toBeNull();
  });
});

describe("usAreaCode", () => {
  it("extracts the area code from a strict US E.164 number", () => {
    expect(usAreaCode("+15551234567")).toBe("555");
    expect(usAreaCode("+12125550123")).toBe("212");
  });

  it("returns null for non-US or malformed values", () => {
    expect(usAreaCode("5551234567")).toBeNull();
    expect(usAreaCode("+447911123456")).toBeNull();
    expect(usAreaCode("")).toBeNull();
  });
});