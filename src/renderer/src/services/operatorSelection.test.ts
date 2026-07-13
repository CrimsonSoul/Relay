import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadSelectedOperatorId,
  persistSelectedOperatorId,
  SELECTED_OPERATOR_STORAGE_KEY,
} from './operatorSelection';

describe('operator selection storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and trims a stored operator ID', () => {
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, '  operator-1  ');

    expect(loadSelectedOperatorId()).toBe('operator-1');
  });

  it('saves a trimmed operator ID', () => {
    persistSelectedOperatorId('  operator-2  ');

    expect(localStorage.getItem(SELECTED_OPERATOR_STORAGE_KEY)).toBe('operator-2');
  });

  it('clears the stored operator ID', () => {
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, 'operator-3');

    persistSelectedOperatorId(null);

    expect(localStorage.getItem(SELECTED_OPERATOR_STORAGE_KEY)).toBeNull();
  });

  it('treats empty and whitespace-only values as malformed', () => {
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, '   ');

    expect(loadSelectedOperatorId()).toBeNull();

    persistSelectedOperatorId('   ');
    expect(localStorage.getItem(SELECTED_OPERATOR_STORAGE_KEY)).toBeNull();
  });

  it('falls back safely when local storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(loadSelectedOperatorId()).toBeNull();
    expect(() => persistSelectedOperatorId('operator-4')).not.toThrow();
    expect(() => persistSelectedOperatorId(null)).not.toThrow();
  });
});
