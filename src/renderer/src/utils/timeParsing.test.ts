import { describe, it, expect } from 'vitest';
import { isTimeWindowActive } from './timeParsing';

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
});
