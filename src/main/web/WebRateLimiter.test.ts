import { describe, expect, it } from 'vitest';
import { WebRateLimiter } from './WebRateLimiter';

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
});
