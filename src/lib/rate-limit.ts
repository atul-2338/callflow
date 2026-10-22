/**
 * Minimal fixed-window rate limiter for the paid/integration endpoints
 * (signup, verification calls, verification SMS). In-memory and per-process:
 * this deployment runs a single Node process against one SQLite file, so an
 * in-process map is the whole world. It resets on restart, which is the
 * documented trade-off — the limiter exists to blunt abuse, not to be a
 * distributed quota system.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  /** Calls left in the current window (0 when blocked). */
  remaining: number;
  /** Seconds until the window resets; 0 when allowed. */
  retryAfterSeconds: number;
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  if (bucket.count < limit) {
    bucket.count += 1;
    return {
      allowed: true,
      remaining: limit - bucket.count,
      retryAfterSeconds: 0,
    };
  }
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((bucket.windowStart + windowMs - now) / 1000)
  );
  return { allowed: false, remaining: 0, retryAfterSeconds };
}

/** Best-effort client IP for rate-limit keys. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}