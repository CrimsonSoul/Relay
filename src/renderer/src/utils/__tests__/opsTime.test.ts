import { describe, expect, it } from 'vitest';
import { formatOpsTime } from '../opsTime';

describe('formatOpsTime', () => {
  it('uses the header clock form: 12-hour, numeric hour, two-digit minute', () => {
    expect(formatOpsTime(new Date(2026, 9, 3, 14, 1))).toBe('2:01 PM');
    expect(formatOpsTime(new Date(2026, 9, 3, 0, 5))).toBe('12:05 AM');
    expect(formatOpsTime(new Date(2026, 9, 3, 9, 30))).toBe('9:30 AM');
  });

  it('accepts epoch milliseconds and ISO strings', () => {
    const date = new Date(2026, 9, 3, 23, 59);
    expect(formatOpsTime(date.getTime())).toBe('11:59 PM');
    expect(formatOpsTime(date.toISOString())).toBe('11:59 PM');
  });
});
