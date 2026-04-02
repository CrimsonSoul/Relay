import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger before importing secureStorage
vi.mock('./logger', () => ({
  loggers: {
    storage: {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

import { loggers } from './logger';

// We need to test the singleton, but also control crypto availability.
// The module uses CRYPTO_AVAILABLE at module scope, so we test the
// fallback paths (obfuscation) since jsdom doesn't have full crypto.subtle.

describe('secureStorage', () => {
  let secureStorage: typeof import('./secureStorage')['secureStorage'];

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    // Re-import to get fresh singleton
    vi.resetModules();
    const mod = await import('./secureStorage');
    secureStorage = mod.secureStorage;
  });

  afterEach(() => {
    localStorage.clear();
  });

  // --- setItemSync / getItemSync ---

  it('setItemSync stores obfuscated data and getItemSync retrieves it', () => {
    secureStorage.setItemSync('test-key', { hello: 'world' });

    const raw = localStorage.getItem('relay_test-key');
    expect(raw).toBeTruthy();
    // Should be base64 encoded, not plain JSON
    expect(raw).not.toContain('"hello"');

    const result = secureStorage.getItemSync<{ hello: string }>('test-key');
    expect(result).toEqual({ hello: 'world' });
  });

  it('getItemSync returns defaultValue when key does not exist', () => {
    const result = secureStorage.getItemSync('nonexistent', 'fallback');
    expect(result).toBe('fallback');
  });

  it('getItemSync returns undefined when key does not exist and no default', () => {
    const result = secureStorage.getItemSync('nonexistent');
    expect(result).toBeUndefined();
  });

  it('getItemSync returns defaultValue and clears corrupted data', () => {
    // Store raw invalid data (not valid base64 obfuscated JSON)
    localStorage.setItem('relay_corrupt', '!!!not-valid-base64!!!');

    const result = secureStorage.getItemSync('corrupt', 'default');
    expect(result).toBe('default');

    // Should have cleared the corrupted key
    expect(localStorage.getItem('relay_corrupt')).toBeNull();

    // Should have logged a warning
    expect(loggers.storage.warn).toHaveBeenCalled();
  });

  it('setItemSync handles values that serialize normally', () => {
    secureStorage.setItemSync('num', 42);
    expect(secureStorage.getItemSync<number>('num')).toBe(42);

    secureStorage.setItemSync('bool', true);
    expect(secureStorage.getItemSync<boolean>('bool')).toBe(true);

    secureStorage.setItemSync('arr', [1, 2, 3]);
    expect(secureStorage.getItemSync<number[]>('arr')).toEqual([1, 2, 3]);
  });

  it('setItemSync logs error when localStorage.setItem throws', () => {
    const origSetItem = localStorage.setItem;
    localStorage.setItem = vi.fn(() => {
      throw new Error('quota exceeded');
    });

    secureStorage.setItemSync('fail-key', 'value');

    expect(loggers.storage.error).toHaveBeenCalled();

    localStorage.setItem = origSetItem;
  });

  // --- async setItem / getItem ---

  it('setItem stores data and getItem retrieves it', async () => {
    await secureStorage.setItem('async-key', { data: 123 });

    const result = await secureStorage.getItem<{ data: number }>('async-key');
    expect(result).toEqual({ data: 123 });
  });

  it('getItem returns defaultValue when key does not exist', async () => {
    const result = await secureStorage.getItem('missing', 'default-val');
    expect(result).toBe('default-val');
  });

  it('getItem returns undefined when key does not exist and no default', async () => {
    const result = await secureStorage.getItem('missing');
    expect(result).toBeUndefined();
  });

  it('getItem returns defaultValue on parse error and logs error', async () => {
    // Store something that will fail JSON.parse after deobfuscation
    localStorage.setItem('relay_bad-json', btoa(encodeURIComponent('not json {')));

    const result = await secureStorage.getItem('bad-json', 'fallback');
    expect(result).toBe('fallback');
    expect(loggers.storage.error).toHaveBeenCalled();
  });

  it('setItem throws and logs on failure', async () => {
    const origSetItem = localStorage.setItem;
    localStorage.setItem = vi.fn(() => {
      throw new Error('storage full');
    });

    await expect(secureStorage.setItem('fail', 'data')).rejects.toThrow('storage full');
    expect(loggers.storage.error).toHaveBeenCalled();

    localStorage.setItem = origSetItem;
  });

  // --- removeItem ---

  it('removeItem removes the prefixed key', () => {
    secureStorage.setItemSync('to-remove', 'value');
    expect(secureStorage.getItemSync('to-remove')).toBe('value');

    secureStorage.removeItem('to-remove');
    expect(secureStorage.getItemSync('to-remove')).toBeUndefined();
  });

  // --- clear ---

  it('clear removes only relay-prefixed keys', () => {
    secureStorage.setItemSync('key1', 'v1');
    secureStorage.setItemSync('key2', 'v2');
    localStorage.setItem('other_app_key', 'keep');

    secureStorage.clear();

    expect(localStorage.getItem('relay_key1')).toBeNull();
    expect(localStorage.getItem('relay_key2')).toBeNull();
    expect(localStorage.getItem('other_app_key')).toBe('keep');
  });

  it('clear handles empty localStorage', () => {
    secureStorage.clear();
    expect(localStorage.length).toBe(0);
  });

  // --- Edge cases for obfuscation ---

  it('handles unicode strings in sync storage', () => {
    secureStorage.setItemSync('unicode', 'Hello');
    expect(secureStorage.getItemSync<string>('unicode')).toBe('Hello');
  });

  it('handles empty string values', () => {
    secureStorage.setItemSync('empty', '');
    expect(secureStorage.getItemSync<string>('empty')).toBe('');
  });

  it('handles null values', () => {
    secureStorage.setItemSync('null-val', null);
    expect(secureStorage.getItemSync('null-val')).toBeNull();
  });
});
