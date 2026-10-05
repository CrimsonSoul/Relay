import { describe, expect, it } from 'vitest';
import {
  parseLegacyRecoveryState,
  parseRecoveryCatalog,
  type RecoveryBuildRecord,
  type RecoveryCatalog,
} from './RecoveryCatalog';
import { serializeRecoveryCatalog } from './__tests__/recoveryFileTestUtils';

const SHA512_A = 'a'.repeat(128);
const SHA512_B = 'b'.repeat(128);
const SHA512_C = 'c'.repeat(128);
const SHA512_D = 'd'.repeat(128);
const SHA256_A = '1'.repeat(64);
const SHA256_B = '2'.repeat(64);
const SHA256_C = '3'.repeat(64);
const SHA256_D = '4'.repeat(64);
const COMMIT_A = '1'.repeat(40);
const COMMIT_B = '2'.repeat(40);
const COMMIT_C = '3'.repeat(40);
const COMMIT_D = '4'.repeat(40);
const INSTALLED_AT = '2026-08-24T15:00:00.000Z';

function build(
  buildId: string,
  version: string,
  runtimeSha512: string,
  installerSha256: string,
  targetCommitish: string,
): RecoveryBuildRecord {
  return {
    buildId,
    version,
    releaseTag: `v${version}`,
    targetCommitish,
    runtimeSha512,
    installerSha256,
    recoveryProtocol: 2,
    serverDataEpoch: 1,
    clientDataEpoch: 1,
    installedAt: INSTALLED_AT,
    health: 'healthy',
    rollbackSnapshotId: null,
  };
}

function catalog(): RecoveryCatalog {
  const current = build('r1-1111111111111111', '1.6.0', SHA512_A, SHA256_A, COMMIT_A);
  const first = build('r1-2222222222222222', '1.5.0', SHA512_B, SHA256_B, COMMIT_B);
  const second = build('r1-3333333333333333', '1.4.0', SHA512_C, SHA256_C, COMMIT_C);
  const third = build('r1-4444444444444444', '1.3.0', SHA512_D, SHA256_D, COMMIT_D);
  return {
    protocol: 2,
    generation: 7,
    currentBuildId: current.buildId,
    candidateBuildId: null,
    previousBuildIds: [first.buildId, second.buildId, third.buildId],
    builds: [current, first, second, third],
    transaction: null,
    failedReleaseFingerprints: [],
  };
}

describe('RecoveryCatalog', () => {
  it('round-trips a validated current build and exactly three retained builds', () => {
    const original = catalog();

    expect(parseRecoveryCatalog(serializeRecoveryCatalog(original))).toEqual(original);
  });

  it('canonicalizes uppercase runtime hashes emitted by the native catalog', () => {
    const original = catalog();
    const nativeCatalog = serializeRecoveryCatalog(original).replace(
      `runtimeSha512=${SHA512_A}`,
      `runtimeSha512=${SHA512_A.toUpperCase()}`,
    );

    expect(parseRecoveryCatalog(nativeCatalog)?.builds[0]?.runtimeSha512).toBe(SHA512_A);
  });

  it('rejects malformed build metadata', () => {
    const malformed = catalog();
    malformed.builds[0] = {
      ...malformed.builds[0]!,
      runtimeSha512: '../untrusted-runtime',
    };

    expect(() => serializeRecoveryCatalog(malformed)).toThrow(TypeError);
  });

  it('bounds retained failed-release fingerprints', () => {
    const oversized = catalog();
    oversized.failedReleaseFingerprints = Array.from(
      { length: 17 },
      (_, index) => `v1.0.${index}@${index.toString(16).padStart(40, '0')}`,
    );

    expect(() => serializeRecoveryCatalog(oversized)).toThrow(TypeError);
  });

  it('reads the repeated failed-release history written by earlier launchers as a set', () => {
    const newest = `v1.6.1@${'5'.repeat(40)}`;
    const older = `v1.6.2@${'6'.repeat(40)}`;
    // A second automatic rollback under the pre-fix launcher appended the whole previous history
    // to itself: the newest fingerprint, then the older one repeated around runs of empty slots.
    const damagedHistory = [newest, ...Array.from({ length: 15 }, () => `${older},,,`)].join(',');
    const nativeCatalog = serializeRecoveryCatalog(catalog()).replace(
      'failedReleaseFingerprints=',
      `failedReleaseFingerprints=${damagedHistory}`,
    );

    expect(parseRecoveryCatalog(nativeCatalog)?.failedReleaseFingerprints).toEqual([newest, older]);
  });

  it.each([
    ['a path-like build ID', 'current=..\\outside'],
    ['an unknown retained build', 'previous2=r1-9999999999999999'],
    ['a fourth retained build', 'previous3=r1-4444444444444444'],
    ['a noncanonical version tag', 'releaseTag=release-1.6.0'],
    ['a truncated payload digest', `runtimeSha512=${'a'.repeat(127)}`],
  ])('rejects %s', (_label, replacement) => {
    const valid = serializeRecoveryCatalog(catalog());
    let damaged: string;
    if (replacement.startsWith('current=')) {
      damaged = valid.replace('current=r1-1111111111111111', replacement);
    } else if (replacement.startsWith('previous2=')) {
      damaged = valid.replace('previous2=r1-4444444444444444', replacement);
    } else if (replacement.startsWith('previous3=')) {
      damaged = valid.replace(
        'previous2=r1-4444444444444444',
        `previous2=r1-4444444444444444\n${replacement}`,
      );
    } else if (replacement.startsWith('releaseTag=')) {
      damaged = valid.replace('releaseTag=v1.6.0', replacement);
    } else {
      damaged = valid.replace(`runtimeSha512=${SHA512_A}`, replacement);
    }

    expect(parseRecoveryCatalog(damaged)).toBeNull();
  });

  it('rejects a build section missing its runtime digest instead of throwing', () => {
    const damaged = serializeRecoveryCatalog(catalog()).replace(
      `runtimeSha512=${SHA512_A}\r\n`,
      '',
    );

    expect(parseRecoveryCatalog(damaged)).toBeNull();
  });

  it('parses only a path-safe protocol-1 launcher state', () => {
    expect(
      parseLegacyRecoveryState(
        '[Relay]\r\nprotocol=1\r\ncurrent=r1-current\r\nprevious=r1-previous\r\n',
      ),
    ).toEqual({ currentBuildId: 'r1-current', previousBuildId: 'r1-previous' });

    expect(
      parseLegacyRecoveryState(
        '[Relay]\nprotocol=1\ncurrent=r1-current\nprevious=..\\redirected\n',
      ),
    ).toBeNull();
    expect(
      parseLegacyRecoveryState('[Relay]\nprotocol=2\ncurrent=r1-current\nprevious=\n'),
    ).toBeNull();
  });
});
