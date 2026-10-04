import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the renderer logger used by secureStorage
vi.mock('../logger', () => ({
  loggers: {
    storage: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

// Import after mocks
import { secureStorage } from '../secureStorage';

const STORAGE_PREFIX = 'relay_';

describe('secureStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('setItemSync / getItemSync', () => {
    it('stores obfuscated value in localStorage', () => {
      secureStorage.setItemSync('setting', 'enabled');

      const raw = localStorage.getItem(STORAGE_PREFIX + 'setting');
      expect(raw).not.toBeNull();
      // The raw value should NOT be the plain JSON string
      expect(raw).not.toBe('"enabled"');
      expect(raw).not.toBe('enabled');
      // It should be a base64-encoded string
      expect(raw!.length).toBeGreaterThan(0);
    });

    it('retrieves and decodes value', () => {
      secureStorage.setItemSync('count', 42);
      const result = secureStorage.getItemSync<number>('count');
      expect(result).toBe(42);
    });

    it('round-trips complex objects', () => {
      const data = { nested: { arr: [1, 2, 3], flag: true } };
      secureStorage.setItemSync('complex', data);
      const result = secureStorage.getItemSync('complex');
      expect(result).toEqual(data);
    });

    it('returns default for missing key', () => {
      const result = secureStorage.getItemSync<string>('nonexistent', 'fallback');
      expect(result).toBe('fallback');
    });

    it('returns undefined when no default provided and key missing', () => {
      const result = secureStorage.getItemSync('nonexistent');
      expect(result).toBeUndefined();
    });

    it('returns default for corrupted data', () => {
      // Write garbage directly to localStorage under the prefixed key
      localStorage.setItem(STORAGE_PREFIX + 'broken', '!!!not-base64!!!');
      const result = secureStorage.getItemSync<string>('broken', 'safe');
      expect(result).toBe('safe');
    });
  });

  describe('removeItem', () => {
    it('removes the prefixed key', () => {
      secureStorage.setItemSync('toRemove', 'value');
      expect(localStorage.getItem(STORAGE_PREFIX + 'toRemove')).not.toBeNull();

      secureStorage.removeItem('toRemove');
      expect(localStorage.getItem(STORAGE_PREFIX + 'toRemove')).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes all relay-prefixed keys but not others', () => {
      // Set relay-prefixed keys
      secureStorage.setItemSync('a', 1);
      secureStorage.setItemSync('b', 2);

      // Set a non-relay key directly
      localStorage.setItem('other_key', 'keep_me');

      secureStorage.clear();

      // Relay keys should be gone
      expect(localStorage.getItem(STORAGE_PREFIX + 'a')).toBeNull();
      expect(localStorage.getItem(STORAGE_PREFIX + 'b')).toBeNull();

      // Non-relay key should survive
      expect(localStorage.getItem('other_key')).toBe('keep_me');
    });
  });
});
