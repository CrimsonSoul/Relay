/**
 * Secure Storage Wrapper for localStorage
 * 
 * Provides encryption for stored data using Web Crypto API when available,
 * with fallback to base64 obfuscation for older environments.
 * 
 * Note: This is obfuscation/encryption against casual inspection.
 * For truly sensitive data, use the main process credential manager.
 */

import { loggers, ErrorCategory } from './logger';

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
      this.initializeEncryption().catch((error) => {
        loggers.storage.warn('Failed to initialize encryption, falling back to obfuscation', {
          error: error.message,
          category: ErrorCategory.RENDERER
        });
      });
    }
  }

  /**
   * Initialize encryption key (Web Crypto API)
   */
  private async initializeEncryption(): Promise<void> {
    if (!CRYPTO_AVAILABLE) return;

    try {
      // Generate a stable key based on user agent (simple approach)
      // In production, you might derive this from a user-specific value
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(navigator.userAgent.substring(0, 32).padEnd(32, '0')),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
      );

      this.encryptionKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: new TextEncoder().encode('relay-salt-2026'),
          iterations: 10000, // Reduced: this is obfuscation, not security-critical encryption
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    } catch (error: any) {
      loggers.storage.error('Encryption initialization failed', {
        error: error.message,
        category: ErrorCategory.RENDERER
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
        encodedData
      );

      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encryptedData.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encryptedData), iv.length);

      // Convert to base64
      return btoa(String.fromCharCode(...combined));
    } catch (error: any) {
      loggers.storage.warn('Encryption failed, using obfuscation', {
        error: error.message,
        category: ErrorCategory.RENDERER
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
      const combined = Uint8Array.from(atob(data), c => c.charCodeAt(0));

      // Extract IV and encrypted data
      const iv = combined.slice(0, 12);
      const encryptedData = combined.slice(12);

      const decryptedData = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.encryptionKey,
        encryptedData
      );

      return new TextDecoder().decode(decryptedData);
    } catch (error: any) {
      // Fallback to simple deobfuscation if decryption fails
      loggers.storage.warn('Decryption failed, trying deobfuscation', {
        error: error.message,
        category: ErrorCategory.RENDERER
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
    } catch (error: any) {
      loggers.storage.error('Failed to store item', {
        key,
        error: error.message,
        category: ErrorCategory.RENDERER
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
    } catch (error: any) {
      loggers.storage.error('Failed to retrieve item', {
        key,
        error: error.message,
        category: ErrorCategory.RENDERER
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
      const obfuscated = simpleObfuscate(serialized);
      localStorage.setItem(STORAGE_PREFIX + key, obfuscated);
    } catch (error: any) {
      loggers.storage.error('Failed to store item (sync)', {
        key,
        error: error.message,
        category: ErrorCategory.RENDERER
      });
      throw error;
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
      
      // Basic JSON structure validation before parsing
      if (!deobfuscated || (!deobfuscated.startsWith('{') && !deobfuscated.startsWith('['))) {
         throw new Error('Stored data does not appear to be valid JSON after deobfuscation');
      }

      return JSON.parse(deobfuscated) as T;
    } catch (error: any) {
      loggers.storage.warn('Failed to retrieve item (sync), clearing corrupted data', {
        key,
        error: error.message,
        category: ErrorCategory.RENDERER
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

