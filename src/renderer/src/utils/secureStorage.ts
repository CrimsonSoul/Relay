/**
 * Obfuscating wrapper for localStorage.
 *
 * Values are base64-encoded under a `relay_` prefix to deter casual inspection.
 * This is NOT encryption: anyone with access to localStorage can decode them.
 *
 * USE CASES:
 * - UI preferences and non-sensitive cached data: SAFE ✓
 * - Passwords, API keys, or sensitive credentials: UNSAFE ✗
 *
 * For truly sensitive data (passwords, tokens, keys), use Electron's safeStorage API
 * via the main process credential manager instead.
 */

import { loggers } from './logger';
import { ErrorCategory } from '@shared/logging';

const STORAGE_PREFIX = 'relay_';

function simpleObfuscate(data: string): string {
  return btoa(encodeURIComponent(data));
}

function simpleDeobfuscate(data: string): string {
  try {
    return decodeURIComponent(atob(data));
  } catch {
    return data; // Return as-is if deobfuscation fails
  }
}

class SecureStorage {
  /**
   * Store obfuscated data
   */
  setItemSync<T>(key: string, value: T): void {
    try {
      const serialized = JSON.stringify(value);
      // JSON.stringify can return undefined for functions/undefined symbols
      if (typeof serialized !== 'string') return;

      const obfuscated = simpleObfuscate(serialized);
      localStorage.setItem(STORAGE_PREFIX + key, obfuscated);
    } catch (error: unknown) {
      loggers.storage.error('Failed to store item (sync)', {
        key,
        error: error instanceof Error ? error.message : String(error),
        category: ErrorCategory.RENDERER,
      });
      // Do not throw, just log. Throwing breaks the app loop.
    }
  }

  /**
   * Retrieve deobfuscated data
   */
  getItemSync<T>(key: string, defaultValue?: T): T | undefined {
    const storageKey = STORAGE_PREFIX + key;
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) return defaultValue;

      // Undecodable or non-JSON data falls through to the catch below.
      const deobfuscated = simpleDeobfuscate(stored);

      return JSON.parse(deobfuscated) as T;
    } catch (error: unknown) {
      loggers.storage.warn('Failed to retrieve item (sync), clearing corrupted data', {
        key,
        error: error instanceof Error ? error.message : String(error),
        category: ErrorCategory.RENDERER,
      });
      // Clear the corrupted key so we don't spam errors every frame/mount
      localStorage.removeItem(storageKey);
      return defaultValue;
    }
  }

  /**
   * Remove item
   */
  removeItem(key: string): void {
    localStorage.removeItem(STORAGE_PREFIX + key);
  }

  /**
   * Clear all relay-prefixed items
   */
  clear(): void {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith(STORAGE_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  }
}

// Export singleton instance
export const secureStorage = new SecureStorage();
