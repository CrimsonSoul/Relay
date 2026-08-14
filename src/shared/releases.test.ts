import { describe, expect, it } from 'vitest';
import { compareRelayVersions, normalizeRelayVersionTag } from './releases';

describe('Relay release versions', () => {
  it('normalizes a canonical GitHub release tag to the packaged version', () => {
    expect(normalizeRelayVersionTag('v12.34.56')).toBe('12.34.56');
  });

  it.each([
    '1.2.3',
    'v1.2',
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    'v1.2.3-beta.1',
    'v9007199254740992.0.0',
    '',
  ])('rejects non-canonical release tag %j', (tag) => {
    expect(normalizeRelayVersionTag(tag)).toBeNull();
  });

  it.each([
    ['1.0.1', '1.0.0', 1],
    ['1.1.0', '1.0.99', 1],
    ['2.0.0', '1.99.99', 1],
    ['1.2.3', '1.2.3', 0],
    ['1.2.2', '1.2.3', -1],
  ] as const)('compares %s against %s as %i', (left, right, expected) => {
    expect(compareRelayVersions(left, right)).toBe(expected);
  });

  it('refuses to compare malformed package versions', () => {
    expect(compareRelayVersions('1.0.0-beta.1', '1.0.0')).toBeNull();
  });
});
