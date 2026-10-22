import { afterEach, describe, expect, it } from "vitest";
import { clientIp, rateLimit, resetRateLimits } from "./rate-limit";

afterEach(() => {
  resetRateLimits();
});

describe("rateLimit", () => {
  it("allows calls up to the limit inside the window, then blocks", () => {
    let now = 1_000_000;
    expect(rateLimit("k", 3, 60_000, now).allowed).toBe(true);
    now += 1_000;
    expect(rateLimit("k", 3, 60_000, now).allowed).toBe(true);
    now += 1_000;
    expect(rateLimit("k", 3, 60_000, now).allowed).toBe(true);
    now += 1_000;

    const blocked = rateLimit("k", 3, 60_000, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("opens a fresh window after the previous one elapses", () => {
    let now = 0;
    for (let i = 0; i < 3; i++) {
      rateLimit("k", 3, 10_000, now);
      now += 100;
    }
    expect(rateLimit("k", 3, 10_000, now).allowed).toBe(false);

    now = 10_001; // past windowStart + windowMs for the original bucket
    expect(rateLimit("k", 3, 10_000, now).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    expect(rateLimit("a", 1, 60_000, 0).allowed).toBe(true);
    expect(rateLimit("b", 1, 60_000, 0).allowed).toBe(true);
    expect(rateLimit("a", 1, 60_000, 0).allowed).toBe(false);
    expect(rateLimit("b", 1, 60_000, 0).allowed).toBe(false);
  });

  it("reports the remaining quota as it is consumed", () => {
    expect(rateLimit("r", 2, 60_000, 0).remaining).toBe(1);
    expect(rateLimit("r", 2, 60_000, 0).remaining).toBe(0);
    expect(rateLimit("r", 2, 60_000, 0).remaining).toBe(0);
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for entry", () => {
    const request = new Request("http://x/", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientIp(request)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(
      clientIp(new Request("http://x/", { headers: { "x-real-ip": "198.51.100.2" } }))
    ).toBe("198.51.100.2");
    expect(clientIp(new Request("http://x/"))).toBe("unknown");
  });
});