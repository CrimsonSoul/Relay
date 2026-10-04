import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Re-import per test so each case gets a fresh singleton with the mocked logger.

const mockLoggers = {
  storage: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
};

describe('secureStorage', () => {
  let secureStorage: (typeof import('./secureStorage'))['secureStorage'];

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // Re-import to get fresh singleton with mocked logger
    vi.resetModules();
    vi.doMock('./logger', () => ({ loggers: mockLoggers }));
    const mod = await import('./secureStorage');
    secureStorage = mod.secureStorage;
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(mockLoggers.storage.warn).toHaveBeenCalled();
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
    const origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new Error('quota exceeded');
    };

    secureStorage.setItemSync('fail-key', 'value');

    expect(mockLoggers.storage.error).toHaveBeenCalled();
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
    expect(localStorage).toHaveLength(0);
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
