import { describe, it, expect } from 'vitest';
import { formatTimeWindow, isTimeWindowActive } from './timeParsing';

describe('isTimeWindowActive', () => {
  it('handles 24/7 and always', () => {
    expect(isTimeWindowActive('24/7')).toBe(true);
    expect(isTimeWindowActive('Always')).toBe(true);
  });

  it('handles business hours', () => {
    // Wednesday at 10am
    const wed10am = new Date(2026, 0, 21, 10, 0);
    expect(isTimeWindowActive('Business Hours', wed10am)).toBe(true);

    // Saturday at 10am
    const sat10am = new Date(2026, 0, 24, 10, 0);
    expect(isTimeWindowActive('Business Hours', sat10am)).toBe(false);

    // Wednesday at 8pm
    const wed8pm = new Date(2026, 0, 21, 20, 0);
    expect(isTimeWindowActive('Business Hours', wed8pm)).toBe(false);
  });

  it('handles military time ranges', () => {
    const testTime = new Date(2026, 0, 21, 14, 30); // 2:30pm
    expect(isTimeWindowActive('0800-1700', testTime)).toBe(true);
    expect(isTimeWindowActive('1700-0800', testTime)).toBe(false);
    expect(isTimeWindowActive('1200-1400', testTime)).toBe(false);
  });

  it('handles 12-hour time ranges', () => {
    const testTime = new Date(2026, 0, 21, 14, 30); // 2:30pm
    expect(isTimeWindowActive('8am - 5pm', testTime)).toBe(true);
    expect(isTimeWindowActive('3pm - 11pm', testTime)).toBe(false);
    expect(isTimeWindowActive('1pm to 4pm', testTime)).toBe(true);
  });

  it('handles day-specific ranges', () => {
    const wed10am = new Date(2026, 0, 21, 10, 0);
    expect(isTimeWindowActive('Mon-Fri 0800-1700', wed10am)).toBe(true);
    expect(isTimeWindowActive('Sat-Sun 0800-1700', wed10am)).toBe(false);
    expect(isTimeWindowActive('Wednesday', wed10am)).toBe(true);
    expect(isTimeWindowActive('Monday', wed10am)).toBe(false);
  });

  it('handles over-midnight ranges', () => {
    const midnight30 = new Date(2026, 0, 21, 0, 30);
    expect(isTimeWindowActive('2200-0200', midnight30)).toBe(true);

    const night11 = new Date(2026, 0, 21, 23, 0);
    expect(isTimeWindowActive('2200-0200', night11)).toBe(true);

    const noon = new Date(2026, 0, 21, 12, 0);
    expect(isTimeWindowActive('2200-0200', noon)).toBe(false);
  });

  it('accepts en and em dashes between times and days', () => {
    const wed11pm = new Date(2026, 0, 21, 23, 0);
    expect(isTimeWindowActive('18:00–06:00', wed11pm)).toBe(true);
    expect(isTimeWindowActive('12:00—00:00', wed11pm)).toBe(true);
    expect(isTimeWindowActive('06:00–18:00', wed11pm)).toBe(false);
    expect(isTimeWindowActive('Mon–Fri 18:00–06:00', wed11pm)).toBe(true);
    expect(isTimeWindowActive('Sat–Sun 18:00–06:00', wed11pm)).toBe(false);
  });

  it('hands over at the boundary minute to exactly one of two back-to-back shifts', () => {
    const sixPm = new Date(2026, 0, 21, 18, 0);
    expect(isTimeWindowActive('06:00–18:00', sixPm)).toBe(false);
    expect(isTimeWindowActive('18:00–06:00', sixPm)).toBe(true);
    const sixAm = new Date(2026, 0, 21, 6, 0);
    expect(isTimeWindowActive('06:00–18:00', sixAm)).toBe(true);
    expect(isTimeWindowActive('18:00–06:00', sixAm)).toBe(false);
    expect(isTimeWindowActive('08:00–08:00', sixAm)).toBe(true);
  });

  it("judges a window that names its zone by that zone's clock", () => {
    // 04:00 UTC on Jan 21 is 23:00 on Jan 20 in New York, whatever this machine's zone.
    const elevenPmEastern = new Date(Date.UTC(2026, 0, 21, 4, 0));
    expect(isTimeWindowActive('18:00–06:00 ET', elevenPmEastern)).toBe(true);
    expect(isTimeWindowActive('06:00–18:00 ET', elevenPmEastern)).toBe(false);
    expect(isTimeWindowActive('Tue 22:00–23:30 Eastern', elevenPmEastern)).toBe(true);
    expect(isTimeWindowActive('Wed 22:00–23:30 Eastern', elevenPmEastern)).toBe(false);
  });
});

describe('formatTimeWindow', () => {
  const wed = new Date(2026, 0, 21, 12, 0);
  const localClock = (date: Date) => {
    const hour12 = date.getHours() % 12 || 12;
    const minutes = date.getMinutes();
    const meridiem = date.getHours() < 12 ? 'AM' : 'PM';
    return minutes
      ? `${hour12}:${String(minutes).padStart(2, '0')} ${meridiem}`
      : `${hour12} ${meridiem}`;
  };

  it('shows a zoneless window in 12-hour time and keeps surrounding words', () => {
    expect(formatTimeWindow('06:00–18:00', wed)).toBe('6 AM – 6 PM');
    expect(formatTimeWindow('Mon-Fri 0830-1730', wed)).toBe('Mon-Fri 8:30 AM – 5:30 PM');
    expect(formatTimeWindow('12:00–00:00', wed)).toBe('12 PM – 12 AM');
  });

  it('converts a named zone to local time and drops the zone word', () => {
    const start = new Date(Date.UTC(2026, 0, 21, 6, 0));
    const end = new Date(Date.UTC(2026, 0, 21, 18, 0));
    expect(formatTimeWindow('06:00–18:00 UTC', wed)).toBe(
      `${localClock(start)} – ${localClock(end)}`,
    );
  });

  it('leaves text without a time range unchanged', () => {
    expect(formatTimeWindow('24/7', wed)).toBe('24/7');
    expect(formatTimeWindow('Business hours', wed)).toBe('Business hours');
  });
});
