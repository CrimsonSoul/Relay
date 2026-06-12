import { describe, it, expect } from 'vitest';
import { localToIso } from '../alertTimeUtils';

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
