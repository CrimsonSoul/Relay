import { describe, it, expect } from 'vitest';
import { localToIso, toDateTimeLocalValue, withSubjectDate } from '../alertTimeUtils';

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

describe('withSubjectDate', () => {
  const now = new Date('2026-10-27T15:00:00.000Z');

  it("leads the subject with today's Central date when no event time is set", () => {
    expect(withSubjectDate('VPN outage', undefined, now)).toBe('October 27, 2026 — VPN outage');
    // 03:00 UTC on the 28th is still the 27th in Central Time.
    expect(withSubjectDate('VPN outage', '', new Date('2026-10-28T03:00:00.000Z'))).toBe(
      'October 27, 2026 — VPN outage',
    );
  });

  it("dates the subject by the event's start day", () => {
    expect(withSubjectDate('UPDATE #2 — Patching', '2026-11-03T08:00:00.000Z', now)).toBe(
      'November 3, 2026 — UPDATE #2 — Patching',
    );
  });

  it.each([
    'VPN outage Oct 27',
    'Maintenance October 27th',
    'Sept. 5 patch window',
    'Payroll 27 October',
    'Payroll 3rd Nov',
    'Patching May 5',
    'Patching 5 May',
    'Outage 10/27',
    'Outage 10/27/2026',
    'Release 2026-10-27',
  ])('keeps %j as written because it already names a date', (subject) => {
    expect(withSubjectDate(subject, '2026-11-03T08:00:00.000Z', now)).toBe(subject);
  });

  it('does not mistake ordinary words or numbers for a date', () => {
    for (const subject of [
      'Marketing 5 sites down',
      'Email may be slow',
      'Server 5 may reboot tonight',
      '24/7 helpdesk number change',
      '50/50 rollout',
      'Build 2026 failed',
    ]) {
      expect(withSubjectDate(subject, undefined, now)).toBe(`October 27, 2026 — ${subject}`);
    }
  });
});
