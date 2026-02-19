/**
 * Secure Storage Wrapper for localStorage
 *
 * Provides encryption for stored data using Web Crypto API when available,
 * with fallback to base64 obfuscation for older environments.
 *
 * SECURITY NOTICE - ENCRYPTION LIMITATIONS:
 * ==========================================
 * This module provides OBFUSCATION, not cryptographically secure encryption.
 *
 * Key derivation uses navigator.userAgent (lines 57-59), which means:
 * - The encryption key is predictable and identical for all users with the same browser
 * - An attacker with access to localStorage can decrypt all data
 * - This is intentional: we're protecting against casual inspection, not determined attackers
 *
 * USE CASES:
 * - UI preferences and non-sensitive cached data: SAFE ✓
 * - Passwords, API keys, or sensitive credentials: UNSAFE ✗
 *
 * For truly sensitive data (passwords, tokens, keys), use Electron's safeStorage API
 * via the main process credential manager instead.
 *
 * This design is by choice for performance and user experience with non-sensitive data.
 */

import { loggers } from './logger';
import { ErrorCategory } from '@shared/logging';

const STORAGE_PREFIX = 'relay_';
const CRYPTO_AVAILABLE = typeof crypto !== 'undefined' && crypto.subtle;

/**
 * Simple obfuscation for environments without crypto API
 */
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

/**
 * Secure storage wrapper
 */
class SecureStorage {
  private encryptionKey: CryptoKey | null = null;

  constructor() {
    if (CRYPTO_AVAILABLE) {
      this.initializeEncryption().catch((error: unknown) => {
        loggers.storage.warn('Failed to initialize encryption, falling back to obfuscation', {
          error: error instanceof Error ? error.message : String(error),
          category: ErrorCategory.RENDERER,
        });
      });
    }
  }

  /**
   * Initialize encryption key (Web Crypto API)
   *
   * WARNING: This uses navigator.userAgent for key derivation, which is NOT secure.
   * All users with the same browser version will have the same encryption key.
   * This is intentional obfuscation for UI preferences, not security-critical data.
   */
  private async initializeEncryption(): Promise<void> {
    if (!CRYPTO_AVAILABLE) return;

    try {
      // SECURITY: Key derived from user agent - predictable and not unique per user
      // This is obfuscation only. Do NOT store sensitive data here.
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(navigator.userAgent.substring(0, 32).padEnd(32, '0')),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey'],
      );

      this.encryptionKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: new TextEncoder().encode('relay-salt-2026'),
          iterations: 10000, // Reduced: this is obfuscation, not security-critical encryption
          hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    } catch (error: unknown) {
      loggers.storage.error('Encryption initialization failed', {
        error: error instanceof Error ? error.message : String(error),
        category: ErrorCategory.RENDERER,
      });
    }
  }

  /**
   * Encrypt data using Web Crypto API
   */
  private async encrypt(data: string): Promise<string> {
    if (!this.encryptionKey || !CRYPTO_AVAILABLE) {
      return simpleObfuscate(data);
    }

    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encodedData = new TextEncoder().encode(data);

      const encryptedData = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        this.encryptionKey,
        encodedData,
      );

      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encryptedData.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encryptedData), iv.length);

      // Convert to base64
      return btoa(String.fromCharCode(...combined));
    } catch (error: unknown) {
      loggers.storage.warn('Encryption failed, using obfuscation', {
        error: error instanceof Error ? error.message : String(error),
        category: ErrorCategory.RENDERER,
      });
      return simpleObfuscate(data);
    }
  }

  /**
   * Decrypt data using Web Crypto API
   */
  private async decrypt(data: string): Promise<string> {
    if (!this.encryptionKey || !CRYPTO_AVAILABLE) {
      return simpleDeobfuscate(data);
    }

    try {
      // Convert from base64
      const combined = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

      // Extract IV and encrypted data
      const iv = combined.slice(0, 12);
      const encryptedData = combined.slice(12);

      const decryptedData = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.encryptionKey,
        encryptedData,
      );

      return new TextDecoder().decode(decryptedData);
    } catch (error: unknown) {
      // Fallback to simple deobfuscation if decryption fails
      loggers.storage.warn('Decryption failed, trying deobfuscation', {
        error: error instanceof Error ? error.message : String(error),
        category: ErrorCategory.RENDERER,
      });
      return simpleDeobfuscate(data);
    }
  }

  /**
   * Store encrypted data (async)
   */
  async setItem<T>(key: string, value: T): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      const encrypted = await this.encrypt(serialized);
      localStorage.setItem(STORAGE_PREFIX + key, encrypted);
    } catch (error: unknown) {
      loggers.storage.error('Failed to store item', {
        key,
        error: error instanceof Error ? error.message : String(error),
        category: ErrorCategory.RENDERER,
      });
      throw error;
    }
  }

  /**
   * Retrieve decrypted data (async)
   */
  async getItem<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + key);
      if (!stored) return defaultValue;

      const decrypted = await this.decrypt(stored);
      return JSON.parse(decrypted) as T;
    } catch (error: unknown) {
      loggers.storage.error('Failed to retrieve item', {
        key,
        error: error instanceof Error ? error.message : String(error),
        category: ErrorCategory.RENDERER,
      });
      return defaultValue;
    }
  }

  /**
   * Store encrypted data (synchronous - uses obfuscation only)
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
   * Retrieve deobfuscated data (synchronous)
   */
  getItemSync<T>(key: string, defaultValue?: T): T | undefined {
    const storageKey = STORAGE_PREFIX + key;
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) return defaultValue;

      // Robustness check: If the string contains non-printable characters or looks like binary,
      // it was likely stored via the async 'encrypt' method and can't be read synchronously.
      // We catch this here to prevent JSON.parse from exploding.
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
