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

// Simple mock for localStorage if not present or broken in jsdom
const localStorageMock = (function() {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

// Override global localStorage
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

describe('columnStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('loadColumnWidths', () => {
    const defaults = {
      name: 150,
      email: 200,
      phone: 120
    };

    it('returns defaults when localStorage is empty', () => {
      const result = loadColumnWidths({
        storageKey: 'test-widths',
        defaults
      });

      expect(result).toEqual(defaults);
    });

    it('loads valid widths from localStorage', () => {
      const saved = { name: 175, email: 225, phone: 130 };
      localStorage.setItem('test-widths', JSON.stringify(saved));

      const result = loadColumnWidths({
        storageKey: 'test-widths',
        defaults
      });

      expect(result).toEqual(saved);
    });

    it('filters out stale keys not in defaults', () => {
      const saved = { name: 175, email: 225, phone: 130, oldKey: 100 };
      localStorage.setItem('test-widths', JSON.stringify(saved));

      const result = loadColumnWidths({
        storageKey: 'test-widths',
        defaults
      });

      expect(result).toEqual({ name: 175, email: 225, phone: 130 });
      expect(result).not.toHaveProperty('oldKey');
    });

    it('adds missing keys from defaults', () => {
      const saved = { name: 175 };
      localStorage.setItem('test-widths', JSON.stringify(saved));

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

    it('returns defaults on invalid JSON', () => {
      localStorage.setItem('test-widths', 'invalid json{');

      const result = loadColumnWidths({
        storageKey: 'test-widths',
        defaults
      });

      expect(result).toEqual(defaults);
    });

    it('returns defaults on non-object value', () => {
      localStorage.setItem('test-widths', JSON.stringify([1, 2, 3]));

      const result = loadColumnWidths({
        storageKey: 'test-widths',
        defaults
      });

      expect(result).toEqual(defaults);
    });

    it('ignores non-number values', () => {
      const saved = { name: 175, email: 'invalid', phone: 130 };
      localStorage.setItem('test-widths', JSON.stringify(saved));

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
    it('saves widths to localStorage', () => {
      const widths = { name: 150, email: 200 };
      saveColumnWidths('test-widths', widths);

      const saved = localStorage.getItem('test-widths');
      expect(saved).toBe(JSON.stringify(widths));
    });
  });

  describe('loadColumnOrder', () => {
    const defaults = ['name', 'email', 'phone'] as const;

    it('returns defaults when localStorage is empty', () => {
      const result = loadColumnOrder({
        storageKey: 'test-order',
        defaults: defaults as unknown as string[]
      });

      expect(result).toEqual(defaults);
    });

    it('loads valid order from localStorage', () => {
      const saved = ['email', 'name', 'phone'];
      localStorage.setItem('test-order', JSON.stringify(saved));

      const result = loadColumnOrder({
        storageKey: 'test-order',
        defaults: defaults as unknown as string[]
      });

      expect(result).toEqual(saved);
    });

    it('returns defaults if length does not match', () => {
      const saved = ['name', 'email']; // missing phone
      localStorage.setItem('test-order', JSON.stringify(saved));

      const result = loadColumnOrder({
        storageKey: 'test-order',
        defaults: defaults as unknown as string[]
      });

      expect(result).toEqual(defaults);
    });

    it('returns defaults if any key is invalid', () => {
      const saved = ['name', 'email', 'invalidKey'];
      localStorage.setItem('test-order', JSON.stringify(saved));

      const result = loadColumnOrder({
        storageKey: 'test-order',
        defaults: defaults as unknown as string[]
      });

      expect(result).toEqual(defaults);
    });

    it('returns defaults on invalid JSON', () => {
      localStorage.setItem('test-order', 'invalid json{');

      const result = loadColumnOrder({
        storageKey: 'test-order',
        defaults: defaults as unknown as string[]
      });

      expect(result).toEqual(defaults);
    });

    it('returns defaults on non-array value', () => {
      localStorage.setItem('test-order', JSON.stringify({ foo: 'bar' }));

      const result = loadColumnOrder({
        storageKey: 'test-order',
        defaults: defaults as unknown as string[]
      });

      expect(result).toEqual(defaults);
    });
  });

  describe('saveColumnOrder', () => {
    it('saves order to localStorage', () => {
      const order = ['email', 'name', 'phone'];
      saveColumnOrder('test-order', order);

      const saved = localStorage.getItem('test-order');
      expect(saved).toBe(JSON.stringify(order));
    });
  });

  describe('clearColumnStorage', () => {
    it('removes single storage key', () => {
      localStorage.setItem('test-1', 'value');
      clearColumnStorage('test-1');

      expect(localStorage.getItem('test-1')).toBeNull();
    });

    it('removes multiple storage keys', () => {
      localStorage.setItem('test-1', 'value1');
      localStorage.setItem('test-2', 'value2');
      localStorage.setItem('test-3', 'value3');

      clearColumnStorage('test-1', 'test-2', 'test-3');

      expect(localStorage.getItem('test-1')).toBeNull();
      expect(localStorage.getItem('test-2')).toBeNull();
      expect(localStorage.getItem('test-3')).toBeNull();
    });
  });
});
