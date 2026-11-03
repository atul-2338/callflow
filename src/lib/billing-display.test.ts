import { describe, expect, it } from "vitest";

import { daysUntil } from "./billing-display";

const NOW = new Date("2026-10-27T12:00:00.000Z");

describe("daysUntil", () => {
  it("counts whole days until the timestamp", () => {
    expect(daysUntil("2026-10-30T12:00:00.000Z", NOW)).toBe(3);
    expect(daysUntil("2026-10-28T12:00:00.000Z", NOW)).toBe(1);
  });

  it("rounds UP, so part of a day still reads as a day", () => {
    // 11 hours left is "1 day left", never "0".
    expect(daysUntil("2026-10-27T23:00:00.000Z", NOW)).toBe(1);
  });

  it("never goes negative", () => {
    expect(daysUntil("2026-10-27T11:00:00.000Z", NOW)).toBe(0);
    expect(daysUntil("2026-10-01T00:00:00.000Z", NOW)).toBe(0);
  });

  it("returns null when there is nothing to count down", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil(undefined, NOW)).toBeNull();
    expect(daysUntil("", NOW)).toBeNull();
    expect(daysUntil("not-a-timestamp", NOW)).toBeNull();
  });
});
