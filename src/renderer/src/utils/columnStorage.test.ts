/**
 * Tests for column storage utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadColumnWidths,
  saveColumnWidths,
  loadColumnOrder,
  saveColumnOrder,
  clearColumnStorage
} from './columnStorage';
import { secureStorage } from './secureStorage';

// Simple mock for localStorage for the test environment
const localStorageMock = (function() {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    length: 0,
    key: vi.fn((_index: number) => null)
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true
});

describe('columnStorage', () => {
  beforeEach(() => {
    secureStorage.clear();
  });

  afterEach(() => {
    secureStorage.clear();
  });

  describe('loadColumnWidths', () => {
    const defaults = {
      name: 150,
      email: 200,
      phone: 120
    };

    it('returns defaults when storage is empty', () => {
      const result = loadColumnWidths({
        storageKey: 'test-widths',
        defaults
      });

      expect(result).toEqual(defaults);
    });

    it('loads valid widths from secure storage', () => {
      const saved = { name: 175, email: 225, phone: 130 };
      secureStorage.setItemSync('test-widths', saved);

      const result = loadColumnWidths({
        storageKey: 'test-widths',
        defaults
      });

      expect(result).toEqual(saved);
    });

    it('filters out stale keys not in defaults', () => {
      const saved = { name: 175, email: 225, phone: 130, oldKey: 100 };
      secureStorage.setItemSync('test-widths', saved);

      const result = loadColumnWidths({
        storageKey: 'test-widths',
        defaults
      });

      expect(result).toEqual({ name: 175, email: 225, phone: 130 });
      expect(result).not.toHaveProperty('oldKey');
    });

    it('adds missing keys from defaults', () => {
      const saved = { name: 175 };
      secureStorage.setItemSync('test-widths', saved);

      const result = loadColumnWidths({
        storageKey: 'test-widths',
        defaults
      });

      expect(result).toEqual({
        name: 175,
        email: 200,  // from defaults
        phone: 120   // from defaults
      });
    });

    it('returns defaults on invalid data in storage', () => {
      // Manually pollute with invalid data (fails B64 decode)
      localStorage.setItem('relay_test-widths', '!!!invalid!!!');

      const result = loadColumnWidths({
        storageKey: 'test-widths',
        defaults
      });

      expect(result).toEqual(defaults);
    });

    it('ignores non-number values', () => {
      const saved = { name: 175, email: 'invalid', phone: 130 };
      secureStorage.setItemSync('test-widths', saved);

      const result = loadColumnWidths({
        storageKey: 'test-widths',
        defaults
      });

      expect(result).toEqual({
        name: 175,
        email: 200,  // fallback to default
        phone: 130
      });
    });
  });

  describe('saveColumnWidths', () => {
    it('saves widths to secure storage', () => {
      const widths = { name: 150, email: 200 };
      saveColumnWidths('test-widths', widths);

      const saved = secureStorage.getItemSync('test-widths');
      expect(saved).toEqual(widths);
    });
  });

  describe('loadColumnOrder', () => {
    const defaults = ['name', 'email', 'phone'] as const;

    it('returns defaults when storage is empty', () => {
      const result = loadColumnOrder({
        storageKey: 'test-order',
        defaults: defaults as unknown as string[]
      });

      expect(result).toEqual(defaults);
    });

    it('loads valid order from secure storage', () => {
      const saved = ['email', 'name', 'phone'];
      secureStorage.setItemSync('test-order', saved);

      const result = loadColumnOrder({
        storageKey: 'test-order',
        defaults: defaults as unknown as string[]
      });

      expect(result).toEqual(saved);
    });

    it('returns defaults if length does not match', () => {
      const saved = ['name', 'email']; // missing phone
      secureStorage.setItemSync('test-order', saved);

      const result = loadColumnOrder({
        storageKey: 'test-order',
        defaults: defaults as unknown as string[]
      });

      expect(result).toEqual(defaults);
    });

    it('returns defaults if any key is invalid', () => {
      const saved = ['name', 'email', 'invalidKey'];
      secureStorage.setItemSync('test-order', saved);

      const result = loadColumnOrder({
        storageKey: 'test-order',
        defaults: defaults as unknown as string[]
      });

      expect(result).toEqual(defaults);
    });
  });

  describe('saveColumnOrder', () => {
    it('saves order to secure storage', () => {
      const order = ['email', 'name', 'phone'];
      saveColumnOrder('test-order', order);

      const saved = secureStorage.getItemSync('test-order');
      expect(saved).toEqual(order);
    });
  });

  describe('clearColumnStorage', () => {
    it('removes single storage key', () => {
      secureStorage.setItemSync('test-1', 'value');
      clearColumnStorage('test-1');

      expect(secureStorage.getItemSync('test-1')).toBeUndefined();
    });

    it('removes multiple storage keys', () => {
      secureStorage.setItemSync('test-1', 'value1');
      secureStorage.setItemSync('test-2', 'value2');
      secureStorage.setItemSync('test-3', 'value3');

      clearColumnStorage('test-1', 'test-2', 'test-3');

      expect(secureStorage.getItemSync('test-1')).toBeUndefined();
      expect(secureStorage.getItemSync('test-2')).toBeUndefined();
      expect(secureStorage.getItemSync('test-3')).toBeUndefined();
    });
  });
});
