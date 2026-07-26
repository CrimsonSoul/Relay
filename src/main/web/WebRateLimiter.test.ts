import { describe, expect, it } from 'vitest';
import { WebRateLimiter } from './WebRateLimiter';

function bucketCount(limiter: WebRateLimiter): number {
  return (
    limiter as unknown as {
      buckets: Map<string, unknown>;
    }
  ).buckets.size;
}

describe('WebRateLimiter', () => {
  it('enforces independent route buckets per key and resets after the window', () => {
    let now = 1_000;
    const limiter = new WebRateLimiter(() => now);

    expect(limiter.consume('login', 'client-a', { limit: 2, windowMs: 60_000 }).allowed).toBe(true);
    expect(limiter.consume('login', 'client-a', { limit: 2, windowMs: 60_000 }).allowed).toBe(true);
    expect(limiter.consume('login', 'client-a', { limit: 2, windowMs: 60_000 })).toMatchObject({
      allowed: false,
      retryAfterMs: 60_000,
    });
    expect(limiter.consume('refresh', 'client-a', { limit: 1, windowMs: 60_000 }).allowed).toBe(
      true,
    );
    expect(limiter.consume('login', 'client-b', { limit: 2, windowMs: 60_000 }).allowed).toBe(true);

    now += 60_000;
    expect(limiter.consume('login', 'client-a', { limit: 2, windowMs: 60_000 }).allowed).toBe(true);
  });

  it('bounds retry timing and can clear one session without clearing other clients', () => {
    let now = 5_000;
    const limiter = new WebRateLimiter(() => now);
    limiter.consume('privileged', 'session-a', { limit: 1, windowMs: 10_000 });
    limiter.consume('privileged', 'session-b', { limit: 1, windowMs: 10_000 });
    now += 2_500;

    const limited = limiter.consume('privileged', 'session-a', { limit: 1, windowMs: 10_000 });
    expect(limited.allowed ? null : limited.retryAfterMs).toBe(7_500);
    limiter.clearKey('session-a');
    expect(limiter.consume('privileged', 'session-a', { limit: 1, windowMs: 10_000 }).allowed).toBe(
      true,
    );
    expect(limiter.consume('privileged', 'session-b', { limit: 1, windowMs: 10_000 }).allowed).toBe(
      false,
    );
  });

  it('physically reclaims expired keys during continued use', () => {
    let now = 10_000;
    const limiter = new WebRateLimiter(() => now);
    limiter.consume('login', 'client-a', { limit: 1, windowMs: 1_000 });
    limiter.consume('login', 'client-b', { limit: 1, windowMs: 1_000 });
    expect(bucketCount(limiter)).toBe(2);

    now += 1_001;
    limiter.consume('login', 'client-c', { limit: 1, windowMs: 1_000 });

    expect(bucketCount(limiter)).toBe(1);
  });

  it('fails closed for an unseen key at the physical key cap without evicting active counters', () => {
    const limiter = new WebRateLimiter(() => 20_000);
    const limit = { limit: 2, windowMs: 60_000 };
    expect(limiter.consume('login', 'existing', limit).allowed).toBe(true);
    for (let index = 1; index < 10_000; index += 1) {
      expect(limiter.consume('login', `client-${index}`, limit).allowed).toBe(true);
    }

    expect(limiter.consume('login', 'existing', limit)).toEqual({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume('login', 'over-capacity', limit)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(bucketCount(limiter)).toBe(10_000);
  });
});
