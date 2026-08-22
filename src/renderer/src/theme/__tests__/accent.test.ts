import { describe, it, expect, beforeEach } from 'vitest';
import {
  ACCENT_SCHEMES,
  DEFAULT_ACCENT,
  getStoredAccent,
  setAccent,
  setCustomAccent,
  initAccent,
  ACCENT_STORAGE_KEY,
  ACCENT_SCHEDULE_STORAGE_KEY,
  CUSTOM_ACCENT_STORAGE_KEY,
  CUSTOM_ACCENTS_STORAGE_KEY,
  applyScheduledAccent,
  getStoredCustomAccent,
  getStoredCustomAccents,
  getStoredAccentSchedule,
  getCurrentAccentScheduleSlot,
  removeCustomAccent,
  normalizeHexAccent,
  setAccentScheduleEnabled,
  setAccentScheduleSlot,
} from '../accent';

describe('accent theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-accent');
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent-hover');
    document.documentElement.style.removeProperty('--accent-bright');
    document.documentElement.style.removeProperty('--on-accent');
  });

  it('exposes the accent schemes with red as default', () => {
    expect(ACCENT_SCHEMES.map((s) => s.id)).toEqual([
      'red',
      'orange',
      'yellow',
      'blue',
      'cyan',
      'green',
      'lime',
      'pink',
      'purple',
      'violet',
    ]);
    expect(DEFAULT_ACCENT).toBe('red');
  });

  it('uses the configured rose pink for the pink swatch', () => {
    expect(ACCENT_SCHEMES.find((s) => s.id === 'pink')?.swatch).toBe('#fc8da9');
  });

  it('setAccent applies data-accent and persists', () => {
    setAccent('purple');
    expect(document.documentElement.getAttribute('data-accent')).toBe('purple');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('purple');
  });

  it('setAccent supports the yellow scheme', () => {
    setAccent('yellow');
    expect(document.documentElement.getAttribute('data-accent')).toBe('yellow');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('yellow');
  });

  it('getStoredAccent falls back to default on garbage', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'mauve');
    expect(getStoredAccent()).toBe('red');
  });

  it('normalizes 3 and 6 digit custom hex values', () => {
    expect(normalizeHexAccent('fc8da9')).toBe('#fc8da9');
    expect(normalizeHexAccent('#F0A')).toBe('#ff00aa');
    expect(normalizeHexAccent('#nope')).toBeNull();
  });

  it('setCustomAccent applies custom css variables and persists normalized hex', () => {
    setCustomAccent('123abc');

    expect(document.documentElement.getAttribute('data-accent')).toBe('custom');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#123abc');
    expect(document.documentElement.style.getPropertyValue('--accent-hover')).toMatch(
      /^#[0-9a-f]{6}$/,
    );
    expect(document.documentElement.style.getPropertyValue('--accent-bright')).toMatch(
      /^#[0-9a-f]{6}$/,
    );
    expect(document.documentElement.style.getPropertyValue('--on-accent')).toBe('#ffffff');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('custom');
    expect(localStorage.getItem(CUSTOM_ACCENT_STORAGE_KEY)).toBe('#123abc');
    expect(localStorage.getItem(CUSTOM_ACCENTS_STORAGE_KEY)).toBe('["#123abc"]');
    expect(getStoredAccent()).toBe('custom');
    expect(getStoredCustomAccent()).toBe('#123abc');
    expect(getStoredCustomAccents()).toEqual(['#123abc']);
  });

  it('keeps four saved custom accents and replaces the oldest on the fifth save', () => {
    setCustomAccent('#111111');
    setCustomAccent('#222222');
    setCustomAccent('#333333');
    setCustomAccent('#444444');
    setCustomAccent('#555555');

    expect(getStoredCustomAccents()).toEqual(['#222222', '#333333', '#444444', '#555555']);
    expect(getStoredCustomAccent()).toBe('#555555');
  });

  it('deduplicates saved custom accents and moves an existing color to the newest slot', () => {
    setCustomAccent('#111111');
    setCustomAccent('#222222');
    setCustomAccent('#333333');
    setCustomAccent('#222222');

    expect(getStoredCustomAccents()).toEqual(['#111111', '#333333', '#222222']);
  });

  it('migrates the legacy single custom accent into the saved custom palette', () => {
    localStorage.setItem(CUSTOM_ACCENT_STORAGE_KEY, '#fc8da9');

    expect(getStoredCustomAccents()).toEqual(['#fc8da9']);
  });

  it('removes saved custom accents and falls back when removing the active one', () => {
    setCustomAccent('#111111');
    setCustomAccent('#222222');

    expect(removeCustomAccent('#222222')).toEqual(['#111111']);
    expect(getStoredCustomAccent()).toBe('#111111');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#111111');

    expect(removeCustomAccent('#111111')).toEqual([]);
    expect(getStoredAccent()).toBe('red');
    expect(document.documentElement.getAttribute('data-accent')).toBe('red');
  });

  it('falls back to default when custom is selected without a valid saved hex', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'custom');
    localStorage.setItem(CUSTOM_ACCENT_STORAGE_KEY, '#wat');

    expect(getStoredAccent()).toBe('red');
    expect(getStoredCustomAccent()).toBeNull();
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
      new StorageEvent('storage', { key: ACCENT_STORAGE_KEY, newValue: 'cyan' }),
    );
    expect(document.documentElement.getAttribute('data-accent')).toBe('cyan');
  });

  it('reverts to default when another window clears the stored accent', () => {
    initAccent();
    setAccent('purple');
    window.dispatchEvent(new StorageEvent('storage', { key: ACCENT_STORAGE_KEY, newValue: null }));
    expect(document.documentElement.getAttribute('data-accent')).toBe('red');
  });

  it('initAccent follows custom accent changes from other windows', () => {
    initAccent();
    localStorage.setItem(CUSTOM_ACCENT_STORAGE_KEY, '#fc8da9');
    localStorage.setItem(ACCENT_STORAGE_KEY, 'custom');
    window.dispatchEvent(
      new StorageEvent('storage', { key: ACCENT_STORAGE_KEY, newValue: 'custom' }),
    );

    expect(document.documentElement.getAttribute('data-accent')).toBe('custom');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#fc8da9');
  });

  it('initAccent is idempotent (no duplicate listeners)', () => {
    initAccent();
    initAccent();
    window.dispatchEvent(
      new StorageEvent('storage', { key: ACCENT_STORAGE_KEY, newValue: 'green' }),
    );
    expect(document.documentElement.getAttribute('data-accent')).toBe('green');
  });

  it('maps the fixed Central Time schedule windows', () => {
    expect(getCurrentAccentScheduleSlot(new Date('2026-06-24T11:30:00Z')).id).toBe('day');
    expect(getCurrentAccentScheduleSlot(new Date('2026-06-24T19:30:00Z')).id).toBe('swing');
    expect(getCurrentAccentScheduleSlot(new Date('2026-06-25T03:30:00Z')).id).toBe('night');
    expect(getCurrentAccentScheduleSlot(new Date('2026-06-24T10:30:00Z')).id).toBe('night');
  });

  it('stores fixed shift colors and applies current slot changes while enabled', () => {
    const dayShift = new Date('2026-06-24T11:30:00Z');

    setAccentScheduleEnabled(true, dayShift);
    setAccentScheduleSlot('day', 'pink', dayShift);

    expect(getStoredAccentSchedule()).toEqual({
      enabled: true,
      slots: {
        day: 'pink',
        swing: 'yellow',
        night: 'blue',
      },
    });
    expect(localStorage.getItem(ACCENT_SCHEDULE_STORAGE_KEY)).toBe(
      '{"enabled":true,"slots":{"day":"pink","swing":"yellow","night":"blue"}}',
    );
    expect(document.documentElement.getAttribute('data-accent')).toBe('pink');
  });

  it('supports saved custom colors in scheduled slots', () => {
    const nightShift = new Date('2026-06-25T03:30:00Z');
    setCustomAccent('#22c55e');
    setAccentScheduleEnabled(true, nightShift);

    setAccentScheduleSlot('night', 'custom:#22c55e', nightShift);

    expect(document.documentElement.getAttribute('data-accent')).toBe('custom');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#22c55e');
  });

  it('falls back to the default accent schedule on invalid storage', () => {
    localStorage.setItem(ACCENT_SCHEDULE_STORAGE_KEY, '{"enabled":true,"slots":{"day":"mauve"}}');

    expect(getStoredAccentSchedule()).toEqual({
      enabled: false,
      slots: {
        day: 'red',
        swing: 'yellow',
        night: 'blue',
      },
    });
    expect(applyScheduledAccent(new Date('2026-06-24T11:30:00Z'))).toBe(false);
  });
});
