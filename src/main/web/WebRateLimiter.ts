export type WebRateLimit = {
  limit: number;
  windowMs: number;
};

export type WebRateLimitResult =
  { allowed: true; remaining: number } | { allowed: false; remaining: 0; retryAfterMs: number };

type Bucket = {
  count: number;
  resetAt: number;
};

export const MAX_WEB_RATE_LIMIT_KEYS = 10_000;
const RATE_LIMIT_SWEEP_INTERVAL_MS = 60_000;

export class WebRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private nextSweepAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  consume(bucket: string, key: string, limit: WebRateLimit): WebRateLimitResult {
    const mapKey = `${bucket}\u0000${key}`;
    const now = this.now();
    let current = this.buckets.get(mapKey);
    if (now >= this.nextSweepAt || (!current && this.buckets.size >= MAX_WEB_RATE_LIMIT_KEYS)) {
      this.sweepExpired(now);
      current = this.buckets.get(mapKey);
    }
    if (current && now >= current.resetAt) {
      this.buckets.delete(mapKey);
      current = undefined;
    }
    if (!current && this.buckets.size >= MAX_WEB_RATE_LIMIT_KEYS) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: this.retryAfterCapacity(now),
      };
    }
    if (!current) {
      current = { count: 0, resetAt: now + limit.windowMs };
      this.buckets.set(mapKey, current);
      this.nextSweepAt = Math.min(this.nextSweepAt, current.resetAt);
    }
    if (current.count >= limit.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, current.resetAt - now),
      };
    }
    current.count += 1;
    return { allowed: true, remaining: Math.max(0, limit.limit - current.count) };
  }

  clearKey(key: string): void {
    const suffix = `\u0000${key}`;
    for (const mapKey of this.buckets.keys()) {
      if (mapKey.endsWith(suffix)) this.buckets.delete(mapKey);
    }
  }

  clear(): void {
    this.buckets.clear();
    this.nextSweepAt = 0;
  }

  private sweepExpired(now: number): void {
    let nextSweepAt = now + RATE_LIMIT_SWEEP_INTERVAL_MS;
    for (const [key, value] of this.buckets) {
      if (now >= value.resetAt) this.buckets.delete(key);
      else nextSweepAt = Math.min(nextSweepAt, value.resetAt);
    }
    this.nextSweepAt = nextSweepAt;
  }

  private retryAfterCapacity(now: number): number {
    let retryAfterMs = Number.POSITIVE_INFINITY;
    for (const value of this.buckets.values()) {
      retryAfterMs = Math.min(retryAfterMs, Math.max(1, value.resetAt - now));
    }
    return Number.isFinite(retryAfterMs) ? retryAfterMs : RATE_LIMIT_SWEEP_INTERVAL_MS;
  }
}
