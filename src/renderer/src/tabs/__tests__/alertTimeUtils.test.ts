import { describe, it, expect } from 'vitest';
import { localToIso, toDateTimeLocalValue } from '../alertTimeUtils';

describe('localToIso', () => {
  it('converts EST wall time (before US spring-forward 2026-03-08)', () => {
    expect(localToIso('2026-03-07T01:30', 'America/New_York')).toBe('2026-03-07T06:30:00.000Z');
  });

  it('converts EDT wall time (after spring-forward)', () => {
    expect(localToIso('2026-03-09T01:30', 'America/New_York')).toBe('2026-03-09T05:30:00.000Z');
  });

  it('handles the fall-back day correctly (2026-11-01 08:00 EST)', () => {
    expect(localToIso('2026-11-01T08:00', 'America/New_York')).toBe('2026-11-01T13:00:00.000Z');
  });

  it('returns empty string for empty/invalid input', () => {
    expect(localToIso('', 'America/New_York')).toBe('');
    expect(localToIso('garbage', 'America/New_York')).toBe('');
  });

  it('handles UTC passthrough', () => {
    expect(localToIso('2026-06-11T12:00', 'UTC')).toBe('2026-06-11T12:00:00.000Z');
  });
});

describe('toDateTimeLocalValue', () => {
  it('formats local wall-clock time at minute precision', () => {
    expect(toDateTimeLocalValue(new Date(2026, 0, 5, 9, 7, 59, 999))).toBe('2026-01-05T09:07');
    expect(toDateTimeLocalValue(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31T23:30');
  });

  it('round-trips through localToIso in the local zone', () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = new Date(2026, 6, 2, 14, 45);
    expect(localToIso(toDateTimeLocalValue(date), zone)).toBe(date.toISOString());
  });
});
