import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_ON_CALL_FONT_SCALE,
  ON_CALL_BOARD_GAP_PX,
  ON_CALL_FONT_SCALE_MAX,
  ON_CALL_FONT_SCALE_MIN,
  ON_CALL_FONT_SCALE_STEP,
  ON_CALL_FONT_SCALE_STORAGE_KEY,
  clampOnCallFontScale,
  getStoredOnCallFontScale,
  setOnCallFontScale,
} from '../onCallDisplay';

describe('on-call board font scale preferences', () => {
  beforeEach(() => {
    localStorage.removeItem(ON_CALL_FONT_SCALE_STORAGE_KEY);
    localStorage.removeItem('relay-oncall-display-size');
  });

  it('defaults to 100 percent with bounded five-percent steps', () => {
    expect(DEFAULT_ON_CALL_FONT_SCALE).toBe(100);
    expect(ON_CALL_FONT_SCALE_MIN).toBe(85);
    expect(ON_CALL_FONT_SCALE_MAX).toBe(150);
    expect(ON_CALL_FONT_SCALE_STEP).toBe(5);
    expect(getStoredOnCallFontScale()).toBe(100);
  });

  it('persists and reads a selected board font scale', () => {
    setOnCallFontScale(125);
    expect(localStorage.getItem(ON_CALL_FONT_SCALE_STORAGE_KEY)).toBe('125');
    expect(getStoredOnCallFontScale()).toBe(125);
  });

  it('clamps invalid or out-of-range values to safe board scale steps', () => {
    expect(clampOnCallFontScale(82)).toBe(85);
    expect(clampOnCallFontScale(151)).toBe(150);
    expect(clampOnCallFontScale(123)).toBe(125);
    expect(clampOnCallFontScale('not-a-number')).toBe(100);
  });

  it('keeps the JS masonry gap constant in sync with the on-call board CSS', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(resolve(testDir, '../../components/oncall/oncall.css'), 'utf8');
    const masonryRule = /(?:^|\n)\.oncall-masonry\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(masonryRule).toContain(`gap: ${ON_CALL_BOARD_GAP_PX}px`);
  });

  it('migrates legacy compact, standard, and wall display sizes into numeric scale values', () => {
    localStorage.setItem('relay-oncall-display-size', 'compact');
    expect(getStoredOnCallFontScale()).toBe(90);

    localStorage.setItem('relay-oncall-display-size', 'standard');
    expect(getStoredOnCallFontScale()).toBe(100);

    localStorage.setItem('relay-oncall-display-size', 'wall');
    expect(getStoredOnCallFontScale()).toBe(125);
  });
});
