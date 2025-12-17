/**
 * Simple token bucket rate limiter for IPC handlers.
 * Prevents DoS from repeated expensive operations.
 */

interface RateLimiterConfig {
  maxTokens: number;      // Maximum number of tokens (burst capacity)
  refillRate: number;     // Tokens added per second
  name?: string;          // Optional name for logging
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private refillRate: number;
  private name: string;

  constructor(config: RateLimiterConfig) {
    this.maxTokens = config.maxTokens;
    this.refillRate = config.refillRate;
    this.tokens = config.maxTokens;
    this.lastRefill = Date.now();
    this.name = config.name || 'RateLimiter';
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    const tokensToAdd = (elapsedMs / 1000) * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Try to consume a token. Returns whether the request is allowed.
   */
  tryConsume(cost: number = 1): RateLimitResult {
    this.refill();

    if (this.tokens >= cost) {
      this.tokens -= cost;
      return { allowed: true };
    }

    // Calculate when enough tokens will be available
    const tokensNeeded = cost - this.tokens;
    const retryAfterMs = Math.ceil((tokensNeeded / this.refillRate) * 1000);

    console.warn(`[${this.name}] Rate limited. Retry after ${retryAfterMs}ms`);
    return { allowed: false, retryAfterMs };
  }

  /**
   * Get current token count (for debugging/monitoring)
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }
}

// Pre-configured rate limiters for different operation types
export const rateLimiters = {
  // File imports: Allow 5 imports with burst, refill 1 per 10 seconds
  // Prevents rapid-fire import operations
  fileImport: new RateLimiter({
    maxTokens: 5,
    refillRate: 0.1, // 1 token per 10 seconds
    name: 'FileImport'
  }),

  // Data mutations (add/remove contact/server): Allow 30 with burst, refill 5/second
  // More generous for normal CRUD operations
  dataMutation: new RateLimiter({
    maxTokens: 30,
    refillRate: 5,
    name: 'DataMutation'
  }),

  // Data reload: Allow 3 with burst, refill 1 per 2 seconds
  // Prevents excessive reload requests
  dataReload: new RateLimiter({
    maxTokens: 3,
    refillRate: 0.5, // 1 token per 2 seconds
    name: 'DataReload'
  }),

  // File system operations (open path, open external): Allow 10 with burst
  fsOperations: new RateLimiter({
    maxTokens: 10,
    refillRate: 2,
    name: 'FSOperations'
  })
};

/**
 * Wrapper to apply rate limiting to an IPC handler.
 * Returns null if rate limited, otherwise executes the handler.
 */
export function withRateLimit<T>(
  limiter: RateLimiter,
  handler: () => Promise<T> | T,
  cost: number = 1
): Promise<T | null> {
  const result = limiter.tryConsume(cost);
  if (!result.allowed) {
    return Promise.resolve(null);
  }
  return Promise.resolve(handler());
}
