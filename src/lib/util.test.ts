import { describe, it, expect } from "vitest";
import {
  formatTemplate,
  maskValue,
  normalizeEnvValue,
  isValidPhone,
  isValidInternationalPhone,
  toE164InternationalPhone,
  digitCount,
  generateClientUid,
} from "./util";
import { toE164 } from "./db";

describe("formatTemplate", () => {
  it("replaces {{placeholders}} with values", () => {
    expect(
      formatTemplate("Hi {{name}}, call {{phone}}", {
        name: "Atul",
        phone: "+919876543210",
      })
    ).toBe("Hi Atul, call +919876543210");
  });

  it("leaves unknown placeholders as empty", () => {
    expect(formatTemplate("Hi {{name}}!", {})).toBe("Hi !");
  });

  it("leaves text without placeholders unchanged", () => {
    expect(formatTemplate("Hello world", {})).toBe("Hello world");
  });
});

describe("maskValue", () => {
  it("returns empty for empty input", () => {
    expect(maskValue("")).toBe("");
  });

  it("masks long values keeping a prefix", () => {
    const masked = maskValue("+919650758230", 4);
    expect(masked).toMatch(/^\+919/);
    expect(masked).not.toContain("0758230");
  });
});

describe("normalizeEnvValue", () => {
  it("strips surrounding quotes", () => {
    expect(normalizeEnvValue('"abc"')).toBe("abc");
  });

  it("strips surrounding brackets", () => {
    expect(normalizeEnvValue("[abc]")).toBe("abc");
  });

  it("returns empty for undefined", () => {
    expect(normalizeEnvValue(undefined)).toBe("");
  });
});

describe("toE164", () => {
  it("keeps existing + prefix", () => {
    expect(toE164("+919876543210")).toBe("+919876543210");
  });

  it("adds + prefix when missing", () => {
    expect(toE164("919876543210")).toBe("+919876543210");
  });
});

describe("isValidPhone", () => {
  it("accepts 10 digits", () => {
    expect(isValidPhone("9876543210")).toBe(true);
  });

  it("accepts E.164 with country code", () => {
    expect(isValidPhone("+919876543210")).toBe(true);
  });

  it("accepts formatted numbers with spaces/dashes", () => {
    expect(isValidPhone("+1 (555) 123-4567")).toBe(true);
  });

  it("rejects fewer than 10 digits", () => {
    expect(isValidPhone("123456789")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidPhone("")).toBe(false);
  });
});

describe("isValidInternationalPhone", () => {
  it("accepts a valid E.164 number", () => {
    expect(isValidInternationalPhone("+18568243790")).toBe(true);
  });

  it("accepts a valid Indian number", () => {
    expect(isValidInternationalPhone("+919650758232")).toBe(true);
  });

  it("rejects a 10-digit US number that is one digit short", () => {
    expect(isValidInternationalPhone("+1555826572")).toBe(false);
  });

  it("rejects a fictional 555 exchange", () => {
    expect(isValidInternationalPhone("+15555826570")).toBe(false);
  });

  it("rejects a bare national number without country code", () => {
    expect(isValidInternationalPhone("18568243790")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidInternationalPhone("")).toBe(false);
  });
});

describe("toE164InternationalPhone", () => {
  it("keeps an already-valid E.164 number", () => {
    expect(toE164InternationalPhone("+18568243790")).toBe("+18568243790");
  });

  it("resolves a bare US national number against the default country", () => {
    expect(toE164InternationalPhone("18568243790", "US")).toBe("+18568243790");
  });

  it("resolves a bare Indian national number against the given country", () => {
    expect(toE164InternationalPhone("9650758232", "IN")).toBe("+919650758232");
  });

  it("strips formatting characters", () => {
    expect(toE164InternationalPhone("(856) 824-3790", "US")).toBe("+18568243790");
  });

  it("throws a friendly error for an invalid number", () => {
    expect(() => toE164InternationalPhone("+1555826572", "US")).toThrow(
      /valid international number/
    );
  });

  it("throws a friendly error for an empty string", () => {
    expect(() => toE164InternationalPhone("", "US")).toThrow(
      /valid international number/
    );
  });
});

describe("digitCount", () => {
  it("counts only digits", () => {
    expect(digitCount("+1 (555) 123-4567")).toBe(11);
  });
});

describe("generateClientUid", () => {
  it("matches the documented TE- + 8 lowercase hex shape", () => {
    expect(generateClientUid()).toMatch(/^TE-[0-9a-f]{8}$/);
  });

  it("generates a fresh random value on every call", () => {
    const uids = new Set(Array.from({ length: 1000 }, () => generateClientUid()));
    expect(uids.size).toBe(1000);
  });
});