import { expect, it } from 'vitest';
import { defaultTicketPreferences, quietNow } from './serviceDesk';
const now = Date.parse('2026-09-16T12:00:00Z');
it('handles overnight quiet hours and snooze without dropping inbox events', () => {
  const prefs = { ...defaultTicketPreferences(), quietStart: '22:00', quietEnd: '07:00' };
  expect(quietNow(prefs, new Date(2026, 8, 16, 23).getTime())).toBe(true);
  expect(quietNow(prefs, new Date(2026, 8, 16, 12).getTime())).toBe(false);
  expect(quietNow({ ...prefs, snoozeUntil: now + 100 }, now)).toBe(true);
});
