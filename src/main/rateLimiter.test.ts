import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter, rateLimiters } from '../main/rateLimiter';

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

    // File import should be very restrictive
    expect(rateLimiters.fileImport.getTokens()).toBe(5);

    // Data mutation should be more permissive
    expect(rateLimiters.dataMutation.getTokens()).toBe(100);

    // Data reload should be moderate
    expect(rateLimiters.dataReload.getTokens()).toBe(3);

    // FS operations should have burst capacity
    expect(rateLimiters.fsOperations.getTokens()).toBe(10);
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
