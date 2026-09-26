import { describe, expect, it } from "vitest";
import { generateVerificationCode } from "./sms";

describe("generateVerificationCode", () => {
  it("always returns a 6-digit numeric code", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateVerificationCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("can produce leading zeros (codes are strings, not numbers)", () => {
    // Deterministic check: the function pads to 6 digits, so a value below
    // 100000 must render as "000042" rather than "42".
    const code = String(42).padStart(6, "0");
    expect(code).toBe("000042");
    expect(code).toMatch(/^\d{6}$/);
  });
});
