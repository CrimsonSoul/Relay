import { describe, it, expect } from 'vitest';
import { HeaderMatcher } from './HeaderMatcher';

describe('HeaderMatcher', () => {
  it('finds column by exact match', () => {
    const matcher = new HeaderMatcher(['name', 'email', 'phone']);
    expect(matcher.findColumn(['email'])).toBe(1);
  });

  it('finds column case-insensitive', () => {
    const matcher = new HeaderMatcher(['Name', 'EMAIL', 'Phone']);
    expect(matcher.findColumn(['email'])).toBe(1);
    expect(matcher.findColumn(['name'])).toBe(0);
    expect(matcher.findColumn(['phone'])).toBe(2);
  });

  it('returns first matching alias (priority order)', () => {
    const matcher = new HeaderMatcher(['full name', 'name', 'display']);
    // 'name' alias matches index 1, but 'full name' at priority 0 should match if listed first
    expect(matcher.findColumn(['full name', 'name'])).toBe(0);
    // Reversed priority: 'name' is checked first
    expect(matcher.findColumn(['name', 'full name'])).toBe(1);
  });

  it('returns -1 when no aliases match', () => {
    const matcher = new HeaderMatcher(['name', 'email']);
    expect(matcher.findColumn(['phone', 'address'])).toBe(-1);
  });

  it('handles empty headers', () => {
    const matcher = new HeaderMatcher([]);
    expect(matcher.findColumn(['name'])).toBe(-1);
  });

  it('handles empty aliases', () => {
    const matcher = new HeaderMatcher(['name', 'email']);
    expect(matcher.findColumn([])).toBe(-1);
  });
});
