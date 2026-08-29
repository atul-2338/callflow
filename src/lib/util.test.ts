import { describe, it, expect } from "vitest";
import { formatTemplate, maskValue, normalizeEnvValue, isValidPhone, digitCount } from "./util";
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

describe("digitCount", () => {
  it("counts only digits", () => {
    expect(digitCount("+1 (555) 123-4567")).toBe(11);
  });
});
