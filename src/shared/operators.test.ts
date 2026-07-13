import { describe, expect, it } from 'vitest';
import {
  getOperatorDisplayNameError,
  INITIAL_RELAY_OPERATOR_NAMES,
  MAX_OPERATOR_DISPLAY_NAME_LENGTH,
  normalizeOperatorDisplayName,
} from './operators';

describe('Relay operator display names', () => {
  it('trims surrounding whitespace and collapses internal whitespace', () => {
    expect(normalizeOperatorDisplayName('  Ryan\t  Bell\n ')).toBe('Ryan Bell');
  });

  it('rejects an empty display name', () => {
    expect(getOperatorDisplayNameError(' \t\n ')).toMatch(/enter/i);
  });

  it('accepts 120 normalized characters and rejects longer names', () => {
    expect(MAX_OPERATOR_DISPLAY_NAME_LENGTH).toBe(120);
    expect(getOperatorDisplayNameError('x'.repeat(120))).toBeNull();
    expect(getOperatorDisplayNameError('x'.repeat(121))).toMatch(/120/);
  });
});

describe('initial Relay operator roster', () => {
  it('contains exactly the approved seven operators in order', () => {
    expect(INITIAL_RELAY_OPERATOR_NAMES).toEqual([
      'Ryan Bell',
      'Tristan Stillwell',
      'Vlad McCarty',
      'Paris Carlson',
      'Connor McElroy',
      'Weston Yokley',
      'Charles Gibbs',
    ]);
  });
});
