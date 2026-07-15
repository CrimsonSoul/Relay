import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter, createPrivilegedRateLimiters, rateLimiters } from '../main/rateLimiter';

// Mock logger to prevent console noise during tests
vi.mock('./logger', () => ({
  loggers: {
    ipc: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should allow consumption when tokens are available', () => {
    const limiter = new RateLimiter({
      maxTokens: 10,
      refillRate: 5,
      name: 'TestLimiter',
    });

    const result = limiter.tryConsume(1);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBeUndefined();
    expect(limiter.getTokens()).toBe(9);
  });

  it('should block consumption when tokens are exhausted', () => {
    const limiter = new RateLimiter({
      maxTokens: 5,
      refillRate: 1,
      name: 'TestLimiter',
    });

    // Consume all tokens
    for (let i = 0; i < 5; i++) {
      expect(limiter.tryConsume(1).allowed).toBe(true);
    }

    // Next request should be blocked
    const result = limiter.tryConsume(1);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('should refill tokens over time', () => {
    const limiter = new RateLimiter({
      maxTokens: 10,
      refillRate: 5, // 5 tokens per second
      name: 'TestLimiter',
    });

    // Consume all tokens
    for (let i = 0; i < 10; i++) {
      limiter.tryConsume(1);
    }

    expect(limiter.getTokens()).toBe(0);

    // Advance time by 1 second (should refill 5 tokens)
    vi.advanceTimersByTime(1000);
    expect(limiter.getTokens()).toBe(5);

    // Advance time by another second (should reach max 10)
    vi.advanceTimersByTime(1000);
    expect(limiter.getTokens()).toBe(10); // Capped at max
  });

  it('should calculate correct retry time when rate limited', () => {
    const limiter = new RateLimiter({
      maxTokens: 10,
      refillRate: 5,
      name: 'TestLimiter',
    });

    // Consume all tokens
    for (let i = 0; i < 10; i++) {
      limiter.tryConsume(1);
    }

    const result = limiter.tryConsume(1);
    expect(result.allowed).toBe(false);
    // Need 1 token at rate of 5 per second = 200ms
    expect(result.retryAfterMs).toBe(200);
  });

  it('should handle costs greater than 1', () => {
    const limiter = new RateLimiter({
      maxTokens: 10,
      refillRate: 5,
      name: 'TestLimiter',
    });

    // Consume with cost of 3
    const result = limiter.tryConsume(3);
    expect(result.allowed).toBe(true);
    expect(limiter.getTokens()).toBe(7);

    // Try to consume more than available
    const blocked = limiter.tryConsume(8);
    expect(blocked.allowed).toBe(false);
    // Need 1 more token at rate of 5 per second = 200ms
    expect(blocked.retryAfterMs).toBe(200);
  });

  it('should not exceed max tokens when refilling', () => {
    const limiter = new RateLimiter({
      maxTokens: 5,
      refillRate: 10,
      name: 'TestLimiter',
    });

    // Consume 2 tokens
    limiter.tryConsume(2);
    expect(limiter.getTokens()).toBe(3);

    // Wait 1 second (10 tokens would be added, but capped at max 5)
    vi.advanceTimersByTime(1000);
    expect(limiter.getTokens()).toBe(5);
  });
});

describe('rateLimiters', () => {
  it('should have pre-configured limiters with expected settings', () => {
    expect(rateLimiters.fileImport).toBeDefined();
    expect(rateLimiters.dataMutation).toBeDefined();
    expect(rateLimiters.dataReload).toBeDefined();
    expect(rateLimiters.fsOperations).toBeDefined();
    expect(rateLimiters.rendererLogging).toBeDefined();

    // File import should be very restrictive
    expect(rateLimiters.fileImport.getTokens()).toBe(5);

    // Data mutation should be more permissive
    expect(rateLimiters.dataMutation.getTokens()).toBe(100);

    // Data reload should be moderate
    expect(rateLimiters.dataReload.getTokens()).toBe(3);

    // FS operations should have burst capacity
    expect(rateLimiters.fsOperations.getTokens()).toBe(10);

    // Renderer logging should be independent from mutation quotas
    expect(rateLimiters.rendererLogging.getTokens()).toBe(60);
  });

  it('should allow burst consumption up to max tokens', () => {
    const { dataMutation } = rateLimiters;
    const initialTokens = dataMutation.getTokens();

    // Consume all tokens in burst
    for (let i = 0; i < initialTokens; i++) {
      expect(dataMutation.tryConsume(1).allowed).toBe(true);
    }

    // Next request should be blocked
    expect(dataMutation.tryConsume(1).allowed).toBe(false);
  });
});

describe('privileged rate limiters', () => {
  it('allows five login attempts per account and device per 15 minutes', () => {
    const { login } = createPrivilegedRateLimiters();
    const key = 'account-admin:device-work-laptop';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(login.tryConsume(key).allowed).toBe(true);
    }
    expect(login.tryConsume(key).allowed).toBe(false);
    expect(login.tryConsume('different-account:device-work-laptop').allowed).toBe(true);

    vi.advanceTimersByTime(15 * 60 * 1_000);
    expect(login.tryConsume(key).allowed).toBe(true);
  });

  it('allows five verification attempts per pairing challenge per 10 minutes', () => {
    const { pairingVerification } = createPrivilegedRateLimiters();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(pairingVerification.tryConsume('challenge-1').allowed).toBe(true);
    }
    expect(pairingVerification.tryConsume('challenge-1').allowed).toBe(false);
    expect(pairingVerification.tryConsume('challenge-2').allowed).toBe(true);

    vi.advanceTimersByTime(10 * 60 * 1_000);
    expect(pairingVerification.tryConsume('challenge-1').allowed).toBe(true);
  });

  it('sustains 60 signed commands per minute with a burst capacity of 10 per device', () => {
    const { signedCommand } = createPrivilegedRateLimiters();

    for (let command = 0; command < 10; command += 1) {
      expect(signedCommand.tryConsume('device-1').allowed).toBe(true);
    }
    expect(signedCommand.tryConsume('device-1').allowed).toBe(false);
    expect(signedCommand.tryConsume('device-2').allowed).toBe(true);

    vi.advanceTimersByTime(1_000);
    expect(signedCommand.tryConsume('device-1').allowed).toBe(true);
    expect(signedCommand.tryConsume('device-1').allowed).toBe(false);
  });
});
