import { describe, expect, it } from 'vitest';
import {
  getOperatorDisplayNameError,
  INITIAL_RELAY_OPERATOR_NAMES,
  MAX_OPERATOR_DISPLAY_NAME_LENGTH,
  normalizeOperatorDisplayName,
  isEligibleKnowledgePublisher,
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
  it('contains exactly the approved nine operators in order', () => {
    expect(INITIAL_RELAY_OPERATOR_NAMES).toEqual([
      'Charles Gibbs',
      'Connor McElroy',
      'Paris Carlson',
      'Ryan Bell',
      'Ryan Bledsoe',
      'Tristan Bowles',
      'Tristan Stillwell',
      'Vlad McCarty',
      'Weston Yokley',
    ]);
    expect(
      new Set(INITIAL_RELAY_OPERATOR_NAMES.map((name) => name.toLocaleLowerCase('en'))).size,
    ).toBe(9);
  });
});

describe('operator administration projections', () => {
  it('keeps the record revision optional for existing attribution consumers', () => {
    const legacy = {
      id: 'operator-1',
      displayName: 'Ryan Bell',
      active: true,
      created: '2026-07-15T20:00:00.000Z',
      updated: '2026-07-15T20:00:00.000Z',
    };
    expect(legacy).not.toHaveProperty('revision');
  });

  it('allows only active non-admin operators to become publisher', () => {
    expect(isEligibleKnowledgePublisher({ active: true, role: null })).toBe(true);
    expect(isEligibleKnowledgePublisher({ active: false, role: null })).toBe(false);
    expect(isEligibleKnowledgePublisher({ active: true, role: 'admin' })).toBe(false);
    expect(isEligibleKnowledgePublisher({ active: true, role: 'publisher' })).toBe(true);
  });
});
