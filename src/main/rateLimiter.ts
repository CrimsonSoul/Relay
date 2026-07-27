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

interface KeyedRateLimiterConfig extends RateLimiterConfig {
  idleTtlMs: number;
  maxKeys?: number;
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly name: string;

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

/**
 * Isolates token buckets by an opaque caller key without ever logging that key.
 * Old buckets are pruned so untrusted identifiers cannot grow memory forever.
 */
export class KeyedRateLimiter {
  private readonly buckets = new Map<string, { limiter: RateLimiter; lastUsedAt: number }>();
  private readonly maxKeys: number;

  constructor(private readonly config: KeyedRateLimiterConfig) {
    this.maxKeys = config.maxKeys ?? 10_000;
  }

  tryConsume(key: string, cost = 1): RateLimitResult {
    const now = Date.now();
    this.prune(now);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      this.evictOldestIfFull();
      bucket = {
        limiter: new RateLimiter({
          maxTokens: this.config.maxTokens,
          refillRate: this.config.refillRate,
          name: this.config.name,
        }),
        lastUsedAt: now,
      };
      this.buckets.set(key, bucket);
    }
    bucket.lastUsedAt = now;
    return bucket.limiter.tryConsume(cost);
  }

  clear(key?: string): void {
    if (key === undefined) {
      this.buckets.clear();
      return;
    }
    this.buckets.delete(key);
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastUsedAt >= this.config.idleTtlMs) this.buckets.delete(key);
    }
  }

  private evictOldestIfFull(): void {
    if (this.buckets.size < this.maxKeys) return;
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastUsedAt < oldestTime) {
        oldestKey = key;
        oldestTime = bucket.lastUsedAt;
      }
    }
    if (oldestKey !== null) this.buckets.delete(oldestKey);
  }
}

export function createPrivilegedRateLimiters() {
  return {
    login: new KeyedRateLimiter({
      maxTokens: 5,
      refillRate: 5 / (15 * 60),
      idleTtlMs: 30 * 60 * 1_000,
      name: 'PrivilegedLogin',
    }),
    // Reauthentication re-checks the account password to mint the proof that
    // gates destructive privileged commands, so it is as guessable as login and
    // needs the same kind of ceiling. Budget matches the Relay Web route
    // (10/min) so the IPC and HTTP surfaces cannot be played against each other.
    reauthentication: new KeyedRateLimiter({
      maxTokens: 10,
      refillRate: 10 / 60,
      idleTtlMs: 15 * 60 * 1_000,
      name: 'PrivilegedReauthentication',
    }),
    pairingVerification: new KeyedRateLimiter({
      maxTokens: 5,
      refillRate: 5 / (10 * 60),
      idleTtlMs: 20 * 60 * 1_000,
      name: 'PrivilegedPairingVerification',
    }),
    signedCommand: new KeyedRateLimiter({
      maxTokens: 10,
      refillRate: 1,
      idleTtlMs: 5 * 60 * 1_000,
      name: 'PrivilegedSignedCommand',
    }),
    // A single bounded batch may declare 100 files. Its signed control plane
    // (batch/status/manifest commands) is isolated from ordinary admin actions;
    // PDF bytes remain separately constrained by the two-chunk upload scheduler.
    knowledgeUploadCommand: new KeyedRateLimiter({
      maxTokens: 250,
      refillRate: 2,
      idleTtlMs: 15 * 60 * 1_000,
      name: 'KnowledgeUploadCommand',
    }),
  };
}

export const privilegedRateLimiters = createPrivilegedRateLimiters();

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
