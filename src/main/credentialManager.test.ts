import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeStorage } from 'electron';
import { 
  generateAuthNonce, 
  registerAuthRequest, 
  consumeAuthRequest, 
  cacheCredentials, 
  getCachedCredentials,
} from './credentialManager';

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
    AUTH: 'AUTH'
  }
}));

describe('credentialManager', () => {
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
      vi.mocked(safeStorage.decryptString).mockReturnValue('password123');

      cacheCredentials('host1', 'user1', 'password123');
      const retrieved = getCachedCredentials('host1');

      expect(retrieved).toEqual({ username: 'user1', password: 'password123' });
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
  });
});
