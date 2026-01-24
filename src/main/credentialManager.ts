/**
 * Secure credential manager using Electron's safeStorage API
 * Provides encrypted storage for HTTP authentication credentials
 */

import { safeStorage } from 'electron';
import * as crypto from 'crypto';
import { loggers } from './logger';
import { ErrorCategory } from '@shared/logging';

type AuthCallback = (_authParams: [username: string, password: string]) => void;

// In-memory store for pending auth requests (nonce -> callback)
const pendingAuthRequests = new Map<string, {
  callback: AuthCallback;
  host: string;
  timestamp: number;
}>();

// Encrypted credential cache (in-memory, cleared on app close or timeout)
const credentialCache = new Map<string, { 
  username: string; 
  encryptedPassword: Buffer;
  timestamp: number;
}>();

// Nonce expiry time (5 minutes)
const NONCE_EXPIRY_MS = 5 * 60 * 1000;
// Credential cache expiry (30 minutes)
const CREDENTIAL_CACHE_EXPIRY_MS = 30 * 60 * 1000;

/**
 * Generate a secure random nonce for auth request validation
 */
export function generateAuthNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Register a pending auth request with a nonce
 */
export function registerAuthRequest(
  nonce: string,
  host: string,
  callback: AuthCallback
): void {
  // Clean up expired nonces first
  cleanupExpiredNonces();

  pendingAuthRequests.set(nonce, {
    callback,
    host,
    timestamp: Date.now()
  });
}

/**
 * Clean up expired auth request nonces
 */
function cleanupExpiredNonces(): void {
  const now = Date.now();
  for (const [nonce, request] of pendingAuthRequests.entries()) {
    if (now - request.timestamp > NONCE_EXPIRY_MS) {
      pendingAuthRequests.delete(nonce);
    }
  }
}

/**
 * Clean up expired cached credentials
 */
function cleanupExpiredCredentials(): void {
  const now = Date.now();
  for (const [host, entry] of credentialCache.entries()) {
    if (now - entry.timestamp > CREDENTIAL_CACHE_EXPIRY_MS) {
      credentialCache.delete(host);
    }
  }
}

/**
 * Validate and consume a nonce, returning the associated callback
 * Returns null if nonce is invalid or expired
 */
export function consumeAuthRequest(nonce: string): {
  callback: AuthCallback;
  host: string;
} | null {
  const request = pendingAuthRequests.get(nonce);
  if (!request) {
    return null;
  }

  // Check expiry
  if (Date.now() - request.timestamp > NONCE_EXPIRY_MS) {
    pendingAuthRequests.delete(nonce);
    return null;
  }

  // Consume the nonce (one-time use)
  pendingAuthRequests.delete(nonce);
  return { callback: request.callback, host: request.host };
}

/**
 * Cancel a pending auth request
 */
export function cancelAuthRequest(nonce: string): boolean {
  return pendingAuthRequests.delete(nonce);
}

/**
 * Check if safeStorage is available and usable
 */
export function isSafeStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    // safeStorage may not be available on all platforms - fail gracefully
    return false;
  }
}

/**
 * Cache credentials for a host using safeStorage encryption
 */
export function cacheCredentials(host: string, username: string, password: string): boolean {
  cleanupExpiredCredentials();
  if (!isSafeStorageAvailable()) {
    loggers.security.warn('safeStorage not available, credentials will not be cached', {
      host,
      category: ErrorCategory.AUTH
    });
    return false;
  }

  try {
    const encryptedPassword = safeStorage.encryptString(password);
    credentialCache.set(host, { username, encryptedPassword, timestamp: Date.now() });
    return true;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    loggers.security.error('Failed to cache credentials', {
      error: err.message,
      stack: err.stack,
      category: ErrorCategory.AUTH,
      host
    });
    return false;
  }
}

/**
 * Retrieve cached credentials for a host
 */
export function getCachedCredentials(host: string): { username: string; password: string } | null {
  cleanupExpiredCredentials();
  const cached = credentialCache.get(host);
  if (!cached || !isSafeStorageAvailable()) {
    return null;
  }

  try {
    const password = safeStorage.decryptString(cached.encryptedPassword);
    // Refresh timestamp on successful use
    credentialCache.set(host, { ...cached, timestamp: Date.now() });
    return { username: cached.username, password };
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    loggers.security.error('Failed to decrypt cached credentials', {
      error: err.message,
      stack: err.stack,
      category: ErrorCategory.AUTH,
      host
    });
    // Remove corrupted cache entry
    credentialCache.delete(host);
    return null;
  }
}

/**
 * Clear cached credentials for a host
 */
export function clearCachedCredentials(host: string): boolean {
  return credentialCache.delete(host);
}

/**
 * Clear all cached credentials
 */
export function clearAllCachedCredentials(): void {
  credentialCache.clear();
}

/**
 * Get list of hosts with cached credentials
 */
export function getCachedHosts(): string[] {
  return Array.from(credentialCache.keys());
}
