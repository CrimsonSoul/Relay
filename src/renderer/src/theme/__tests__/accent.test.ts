import { describe, it, expect, beforeEach } from 'vitest';
import {
  ACCENT_SCHEMES,
  DEFAULT_ACCENT,
  getStoredAccent,
  setAccent,
  initAccent,
  ACCENT_STORAGE_KEY,
} from '../accent';

describe('accent theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-accent');
  });

  it('exposes the six schemes with red as default', () => {
    expect(ACCENT_SCHEMES.map((s) => s.id)).toEqual([
      'red',
      'orange',
      'blue',
      'green',
      'pink',
      'purple',
    ]);
    expect(DEFAULT_ACCENT).toBe('red');
  });

  it('setAccent applies data-accent and persists', () => {
    setAccent('purple');
    expect(document.documentElement.getAttribute('data-accent')).toBe('purple');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('purple');
  });

  it('getStoredAccent falls back to default on garbage', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'mauve');
    expect(getStoredAccent()).toBe('red');
  });

  it('initAccent applies the stored scheme', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'green');
    initAccent();
    expect(document.documentElement.getAttribute('data-accent')).toBe('green');
  });

  it('initAccent follows storage events from other windows', () => {
    initAccent();
    localStorage.setItem(ACCENT_STORAGE_KEY, 'blue');
    window.dispatchEvent(
      new StorageEvent('storage', { key: ACCENT_STORAGE_KEY, newValue: 'blue' }),
    );
    expect(document.documentElement.getAttribute('data-accent')).toBe('blue');
  });

  it('reverts to default when another window clears the stored accent', () => {
    initAccent();
    setAccent('purple');
    window.dispatchEvent(new StorageEvent('storage', { key: ACCENT_STORAGE_KEY, newValue: null }));
    expect(document.documentElement.getAttribute('data-accent')).toBe('red');
  });

  it('initAccent is idempotent (no duplicate listeners)', () => {
    initAccent();
    initAccent();
    window.dispatchEvent(
      new StorageEvent('storage', { key: ACCENT_STORAGE_KEY, newValue: 'green' }),
    );
    expect(document.documentElement.getAttribute('data-accent')).toBe('green');
  });
});
