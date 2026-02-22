import { describe, expect, it } from 'vitest';
import { isTimeWindowActive } from '../timeParsing';

describe('timeParsing - isTimeWindowActive', () => {
  const makeDate = (day: number, hour: number, minute = 0) => {
    // day: 0=Sun, 1=Mon, ..., 6=Sat
    const d = new Date(2024, 0, 7 + day); // Jan 7=Sun, 8=Mon, 9=Tue, 10=Wed, 11=Thu, 12=Fri, 13=Sat
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  const monday10am = makeDate(1, 10);
  const wednesday2pm = makeDate(3, 14);
  const saturday8pm = makeDate(6, 20);
  const sunday3am = makeDate(0, 3);
  const friday4pm = makeDate(5, 16);
  const friday6pm = makeDate(5, 18);

  describe('empty/falsy input', () => {
    it('returns false for empty string', () => {
      expect(isTimeWindowActive('')).toBe(false);
    });
  });

  describe('always-active keywords', () => {
    it('returns true for "24/7"', () => {
      expect(isTimeWindowActive('24/7')).toBe(true);
    });

    it('returns true for "always"', () => {
      expect(isTimeWindowActive('Always')).toBe(true);
    });

    it('returns true for "rotating"', () => {
      expect(isTimeWindowActive('rotating')).toBe(true);
    });
  });

  describe('business hours', () => {
    it('returns true on weekday during business hours', () => {
      expect(isTimeWindowActive('business hours', monday10am)).toBe(true);
    });

    it('returns false on weekday after business hours', () => {
      expect(isTimeWindowActive('business hours', friday6pm)).toBe(false);
    });

    it('returns false on weekend', () => {
      expect(isTimeWindowActive('business hours', saturday8pm)).toBe(false);
    });

    it('returns false on Sunday', () => {
      expect(isTimeWindowActive('business hours', sunday3am)).toBe(false);
    });
  });

  describe('time range constraints', () => {
    it('returns true when current time is within range (9am-5pm)', () => {
      expect(isTimeWindowActive('9am - 5pm', monday10am)).toBe(true);
    });

    it('returns false when current time is outside range', () => {
      expect(isTimeWindowActive('9am - 5pm', friday6pm)).toBe(false);
    });

    it('handles 24-hour time format', () => {
      expect(isTimeWindowActive('8am - 17:00', monday10am)).toBe(true);
    });

    it('handles "to" separator', () => {
      expect(isTimeWindowActive('9am to 5pm', monday10am)).toBe(true);
    });

    it('handles "through" separator', () => {
      expect(isTimeWindowActive('9am through 5pm', monday10am)).toBe(true);
    });

    it('handles overnight range (10pm - 6am)', () => {
      expect(isTimeWindowActive('10pm - 6am', makeDate(1, 23))).toBe(true);
      expect(isTimeWindowActive('10pm - 6am', makeDate(1, 2))).toBe(true);
      expect(isTimeWindowActive('10pm - 6am', monday10am)).toBe(false);
    });
  });

  describe('day constraints', () => {
    it('returns true for matching day name', () => {
      expect(isTimeWindowActive('monday', monday10am)).toBe(true);
    });

    it('returns false for non-matching day name', () => {
      expect(isTimeWindowActive('friday', monday10am)).toBe(false);
    });

    it('returns true for matching day abbreviation', () => {
      expect(isTimeWindowActive('mon', monday10am)).toBe(true);
    });

    it('returns true for day range (mon-fri) on wednesday', () => {
      expect(isTimeWindowActive('mon-fri', wednesday2pm)).toBe(true);
    });

    it('returns false for day range (mon-fri) on saturday', () => {
      expect(isTimeWindowActive('mon-fri', saturday8pm)).toBe(false);
    });

    it('handles wrap-around day range (fri-sun) on saturday', () => {
      expect(isTimeWindowActive('fri-sun', saturday8pm)).toBe(true);
    });

    it('handles wrap-around day range (fri-sun) on monday', () => {
      expect(isTimeWindowActive('fri-sun', monday10am)).toBe(false);
    });
  });

  describe('combined day and time', () => {
    it('returns true when both day and time match', () => {
      expect(isTimeWindowActive('mon-fri 9am-5pm', wednesday2pm)).toBe(true);
    });

    it('returns false when day matches but time does not', () => {
      expect(isTimeWindowActive('mon-fri 9am-5pm', friday6pm)).toBe(false);
    });

    it('returns false when time would match but day does not', () => {
      expect(isTimeWindowActive('mon-fri 9am-5pm', saturday8pm)).toBe(false);
    });
  });

  describe('no time mention — day only', () => {
    it('returns true for matching day with no time', () => {
      expect(isTimeWindowActive('friday', friday4pm)).toBe(true);
    });

    it('returns false for non-matching day with no time', () => {
      expect(isTimeWindowActive('saturday', friday4pm)).toBe(false);
    });
  });
});
