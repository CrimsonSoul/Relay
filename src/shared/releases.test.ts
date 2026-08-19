import { describe, expect, it } from 'vitest';
import {
  compareRelayVersions,
  normalizeRelaySha256Digest,
  normalizeRelayVersionTag,
  relayReleaseAssetNames,
} from './releases';

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

  it('derives the exact updater asset names for a canonical release', () => {
    expect(relayReleaseAssetNames('12.34.56')).toEqual({
      archive: 'Relay-v12.34.56-windows-x64.zip',
      checksum: 'Relay-v12.34.56-windows-x64.zip.sha256',
    });
  });

  it.each(['1.2', '01.2.3', '1.2.3-beta.1', '../1.2.3', ''])(
    'refuses updater asset names for malformed version %j',
    (version) => {
      expect(relayReleaseAssetNames(version)).toBeNull();
    },
  );

  it('normalizes the lowercase digest from GitHub release metadata', () => {
    expect(
      normalizeRelaySha256Digest(
        'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ),
    ).toBe('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  });

  it.each([
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'sha512:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'sha256:ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    'sha256:1234',
    '',
  ])('rejects malformed GitHub asset digest %j', (digest) => {
    expect(normalizeRelaySha256Digest(digest)).toBeNull();
  });
});
