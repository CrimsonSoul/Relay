import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_ON_CALL_DISPLAY_SIZE,
  ON_CALL_DISPLAY_SIZES,
  ON_CALL_DISPLAY_STORAGE_KEY,
  getStoredOnCallDisplaySize,
  setOnCallDisplaySize,
} from '../onCallDisplay';

describe('on-call display size preferences', () => {
  beforeEach(() => {
    localStorage.removeItem(ON_CALL_DISPLAY_STORAGE_KEY);
  });

  it('defaults to standard with compact and wall alternatives', () => {
    expect(DEFAULT_ON_CALL_DISPLAY_SIZE).toBe('standard');
    expect(ON_CALL_DISPLAY_SIZES.map((option) => option.id)).toEqual([
      'compact',
      'standard',
      'wall',
    ]);
    expect(getStoredOnCallDisplaySize()).toBe('standard');
  });

  it('persists and reads a selected board display size', () => {
    setOnCallDisplaySize('wall');
    expect(localStorage.getItem(ON_CALL_DISPLAY_STORAGE_KEY)).toBe('wall');
    expect(getStoredOnCallDisplaySize()).toBe('wall');
  });

  it('falls back to standard when stored data is invalid', () => {
    localStorage.setItem(ON_CALL_DISPLAY_STORAGE_KEY, 'oversized');
    expect(getStoredOnCallDisplaySize()).toBe('standard');
  });
});
