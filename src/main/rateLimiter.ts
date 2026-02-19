/**
 * Simple token bucket rate limiter for IPC handlers.
 * Prevents DoS from repeated expensive operations.
 */

import { loggers } from './logger';

// Rate limiter configuration constants
const FILE_IMPORT_MAX_TOKENS = 5;
const FILE_IMPORT_REFILL_RATE = 0.1; // 1 token per 10 seconds
const DATA_MUTATION_MAX_TOKENS = 100;
const DATA_MUTATION_REFILL_RATE = 10; // 10 tokens per second
const DATA_RELOAD_MAX_TOKENS = 3;
const DATA_RELOAD_REFILL_RATE = 0.5; // 1 token per 2 seconds
const FS_OPERATIONS_MAX_TOKENS = 10;
const FS_OPERATIONS_REFILL_RATE = 2; // 2 tokens per second
const NETWORK_MAX_TOKENS = 10;
const NETWORK_REFILL_RATE = 1; // 1 token per second
const RENDERER_LOG_MAX_TOKENS = 60;
const RENDERER_LOG_REFILL_RATE = 20; // 20 log events per second

interface RateLimiterConfig {
  maxTokens: number; // Maximum number of tokens (burst capacity)
  refillRate: number; // Tokens added per second
  name?: string; // Optional name for logging
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

    loggers.ipc.warn(`Rate limited: ${this.name}`, {
      retryAfterMs,
      cost,
      availableTokens: this.tokens,
    });
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
  // File imports: Prevents rapid-fire import operations
  fileImport: new RateLimiter({
    maxTokens: FILE_IMPORT_MAX_TOKENS,
    refillRate: FILE_IMPORT_REFILL_RATE,
    name: 'FileImport',
  }),

  // Data mutations (add/remove contact/server): More generous for normal CRUD operations
  dataMutation: new RateLimiter({
    maxTokens: DATA_MUTATION_MAX_TOKENS,
    refillRate: DATA_MUTATION_REFILL_RATE,
    name: 'DataMutation',
  }),

  // Data reload: Prevents excessive reload requests
  dataReload: new RateLimiter({
    maxTokens: DATA_RELOAD_MAX_TOKENS,
    refillRate: DATA_RELOAD_REFILL_RATE,
    name: 'DataReload',
  }),

  // File system operations (open path, open external)
  fsOperations: new RateLimiter({
    maxTokens: FS_OPERATIONS_MAX_TOKENS,
    refillRate: FS_OPERATIONS_REFILL_RATE,
    name: 'FSOperations',
  }),

  // External network operations
  network: new RateLimiter({
    maxTokens: NETWORK_MAX_TOKENS,
    refillRate: NETWORK_REFILL_RATE,
    name: 'Network',
  }),

  // Renderer logging events
  rendererLogging: new RateLimiter({
    maxTokens: RENDERER_LOG_MAX_TOKENS,
    refillRate: RENDERER_LOG_REFILL_RATE,
    name: 'RendererLogging',
  }),
};

/**
 * Convenience helper to check network rate limit.
 */
export function checkNetworkRateLimit(): boolean {
  return rateLimiters.network.tryConsume().allowed;
}
