export type WebRateLimit = {
  limit: number;
  windowMs: number;
};

export type WebRateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; remaining: 0; retryAfterMs: number };

type Bucket = {
  count: number;
  resetAt: number;
};

export class WebRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  consume(bucket: string, key: string, limit: WebRateLimit): WebRateLimitResult {
    const mapKey = `${bucket}\u0000${key}`;
    const now = this.now();
    let current = this.buckets.get(mapKey);
    if (!current || now >= current.resetAt) {
      current = { count: 0, resetAt: now + limit.windowMs };
      this.buckets.set(mapKey, current);
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
  }
}
