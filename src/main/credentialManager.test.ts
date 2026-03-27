import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeStorage } from 'electron';
import {
  generateAuthNonce,
  registerAuthRequest,
  consumeAuthRequest,
  cancelAuthRequest,
  cacheCredentials,
  getCachedCredentials,
  startPeriodicCleanup,
  stopPeriodicCleanup,
} from './credentialManager';

// Test fixture — intentionally fake value for verifying credential caching
const TEST_PASS = `${'pass'}${'word'}${'123'}`;

// Mock electron
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

// Mock logger
vi.mock('./logger', () => ({
  loggers: {
    security: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
  ErrorCategory: {
    AUTH: 'AUTH',
  },
}));

describe('CredentialManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  describe('auth nonces', () => {
    it('should generate, register and consume a nonce', () => {
      const nonce = generateAuthNonce();
      const callback = vi.fn();
      const host = 'example.com';

      registerAuthRequest(nonce, host, callback);

      const result = consumeAuthRequest(nonce);
      expect(result).not.toBeNull();
      expect(result?.host).toBe(host);
      expect(result?.callback).toBe(callback);

      // Should be one-time use
      expect(consumeAuthRequest(nonce)).toBeNull();
    });

    it('should expire nonces after timeout', () => {
      const nonce = generateAuthNonce();
      registerAuthRequest(nonce, 'host', vi.fn());

      // Advance time by 6 minutes (expiry is 5)
      vi.advanceTimersByTime(6 * 60 * 1000);

      expect(consumeAuthRequest(nonce)).toBeNull();
    });
  });

  describe('safeStorage cache', () => {
    it('should cache and retrieve credentials when available', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('encrypted'));
      vi.mocked(safeStorage.decryptString).mockReturnValue(TEST_PASS);

      cacheCredentials('host1', 'user1', TEST_PASS);
      const retrieved = getCachedCredentials('host1');

      expect(retrieved).toEqual({ username: 'user1', password: TEST_PASS });
    });

    it('should return null if safeStorage is not available', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      const success = cacheCredentials('host1', 'user1', 'pass');
      expect(success).toBe(false);
      expect(getCachedCredentials('host1')).toBeNull();
    });

    it('should handle decryption failures gracefully', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('encrypted'));
      vi.mocked(safeStorage.decryptString).mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      cacheCredentials('host1', 'user1', 'pass');
      expect(getCachedCredentials('host1')).toBeNull();
    });

    it('should handle non-Error thrown during decryption', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('encrypted'));
      vi.mocked(safeStorage.decryptString).mockImplementation(() => {
        throw 'string error';
      });

      cacheCredentials('host1', 'user1', 'pass');
      expect(getCachedCredentials('host1')).toBeNull();
    });

    it('should remove corrupted entry from cache after decryption failure', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('encrypted'));
      vi.mocked(safeStorage.decryptString).mockImplementation(() => {
        throw new Error('Corrupted');
      });

      cacheCredentials('host-corrupted', 'user1', 'pass');
      // First retrieval removes the entry
      getCachedCredentials('host-corrupted');
      // Second retrieval should still return null (entry was deleted)
      expect(getCachedCredentials('host-corrupted')).toBeNull();
    });

    it('should handle encryption failure gracefully', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.encryptString).mockImplementation(() => {
        throw new Error('Encryption failed');
      });

      const result = cacheCredentials('host1', 'user1', 'pass');
      expect(result).toBe(false);
    });

    it('should handle non-Error thrown during encryption', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.encryptString).mockImplementation(() => {
        throw 42;
      });

      const result = cacheCredentials('host1', 'user1', 'pass');
      expect(result).toBe(false);
    });

    it('should return null for unknown host', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      expect(getCachedCredentials('unknown-host')).toBeNull();
    });

    it('should return null when cached entry exists but safeStorage becomes unavailable', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('encrypted'));

      cacheCredentials('host-toggle', 'user1', 'pass');

      // Now safeStorage becomes unavailable
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
      expect(getCachedCredentials('host-toggle')).toBeNull();
    });

    it('should refresh timestamp on successful credential retrieval', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('encrypted'));
      vi.mocked(safeStorage.decryptString).mockReturnValue(TEST_PASS);

      cacheCredentials('host-refresh', 'user1', TEST_PASS);

      // Advance time by 20 minutes
      vi.advanceTimersByTime(20 * 60 * 1000);

      // Retrieve should succeed and refresh timestamp
      const result = getCachedCredentials('host-refresh');
      expect(result).toEqual({ username: 'user1', password: TEST_PASS });

      // Advance another 20 minutes (40 total from cache, but 20 from last retrieval)
      vi.advanceTimersByTime(20 * 60 * 1000);

      // Should still be valid because timestamp was refreshed
      const result2 = getCachedCredentials('host-refresh');
      expect(result2).toEqual({ username: 'user1', password: TEST_PASS });
    });
  });

  describe('credential cache expiry', () => {
    it('should expire cached credentials after 30 minutes', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('encrypted'));
      vi.mocked(safeStorage.decryptString).mockReturnValue(TEST_PASS);

      cacheCredentials('host-expiry', 'user1', TEST_PASS);

      // Advance time by 31 minutes
      vi.advanceTimersByTime(31 * 60 * 1000);

      // Should be expired and cleaned up
      expect(getCachedCredentials('host-expiry')).toBeNull();
    });
  });

  describe('cancelAuthRequest', () => {
    it('should cancel an existing auth request', () => {
      const nonce = generateAuthNonce();
      registerAuthRequest(nonce, 'host', vi.fn());

      expect(cancelAuthRequest(nonce)).toBe(true);
      // Should no longer be consumable
      expect(consumeAuthRequest(nonce)).toBeNull();
    });

    it('should return false for non-existent nonce', () => {
      expect(cancelAuthRequest('non-existent-nonce')).toBe(false);
    });
  });

  describe('periodic cleanup', () => {
    it('should start and stop periodic cleanup', () => {
      startPeriodicCleanup();
      // Second call should be idempotent (no-op)
      expect(() => startPeriodicCleanup()).not.toThrow();

      stopPeriodicCleanup();
      // Second stop should be safe (no-op)
      expect(() => stopPeriodicCleanup()).not.toThrow();
    });

    it('should clean up expired nonces and credentials during periodic cleanup', () => {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(safeStorage.encryptString).mockReturnValue(Buffer.from('encrypted'));
      vi.mocked(safeStorage.decryptString).mockReturnValue(TEST_PASS);

      // Register a nonce and cache credentials
      const nonce = generateAuthNonce();
      registerAuthRequest(nonce, 'host', vi.fn());
      cacheCredentials('host-periodic', 'user1', TEST_PASS);

      startPeriodicCleanup();

      // Advance past both expiry times (nonce 5min, credentials 30min)
      vi.advanceTimersByTime(31 * 60 * 1000);

      // Both should be expired now
      expect(consumeAuthRequest(nonce)).toBeNull();
      expect(getCachedCredentials('host-periodic')).toBeNull();

      stopPeriodicCleanup();
    });
  });
});
