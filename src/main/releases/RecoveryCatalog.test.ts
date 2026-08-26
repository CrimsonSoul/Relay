import { describe, expect, it } from 'vitest';
import {
  createRecoveryBaseline,
  parseLegacyRecoveryState,
  parseRecoveryCatalog,
  promoteRecoveryCandidate,
  serializeRecoveryCatalog,
  type RecoveryBuildRecord,
  type RecoveryCatalog,
} from './RecoveryCatalog';

const SHA512_A = 'a'.repeat(128);
const SHA512_B = 'b'.repeat(128);
const SHA512_C = 'c'.repeat(128);
const SHA512_D = 'd'.repeat(128);
const SHA512_E = 'e'.repeat(128);
const SHA256_A = '1'.repeat(64);
const SHA256_B = '2'.repeat(64);
const SHA256_C = '3'.repeat(64);
const SHA256_D = '4'.repeat(64);
const SHA256_E = '5'.repeat(64);
const COMMIT_A = '1'.repeat(40);
const COMMIT_B = '2'.repeat(40);
const COMMIT_C = '3'.repeat(40);
const COMMIT_D = '4'.repeat(40);
const COMMIT_E = '5'.repeat(40);
const INSTALLED_AT = '2026-08-24T15:00:00.000Z';

function build(
  buildId: string,
  version: string,
  runtimeSha512: string,
  installerSha256: string,
  targetCommitish: string,
  health: RecoveryBuildRecord['health'] = 'healthy',
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
    health,
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

  it('refuses to serialize malformed build metadata supplied by an in-memory caller', () => {
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

  it('promotes one candidate and retains the displaced current plus two newest predecessors', () => {
    const original = catalog();
    const candidate = build(
      'r1-5555555555555555',
      '1.7.0',
      SHA512_E,
      SHA256_E,
      COMMIT_E,
      'candidate',
    );
    const prepared: RecoveryCatalog = {
      ...original,
      candidateBuildId: candidate.buildId,
      builds: [...original.builds, candidate],
      transaction: {
        id: '11111111-2222-4333-8444-555555555555',
        kind: 'update',
        phase: 'probation',
        sourceBuildId: original.currentBuildId,
        targetBuildId: candidate.buildId,
        mode: 'server',
        snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        attempts: 1,
        requestedAt: '2026-08-24T15:05:00.000Z',
      },
    };

    const promoted = promoteRecoveryCandidate(prepared, '2026-08-24T15:07:00.000Z');

    expect(promoted.currentBuildId).toBe(candidate.buildId);
    expect(promoted.candidateBuildId).toBeNull();
    expect(promoted.previousBuildIds).toEqual([
      original.currentBuildId,
      original.previousBuildIds[0],
      original.previousBuildIds[1],
    ]);
    expect(promoted.builds.find((item) => item.buildId === original.currentBuildId)).toMatchObject({
      rollbackSnapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
    expect(promoted.builds.find((item) => item.buildId === candidate.buildId)).toMatchObject({
      health: 'healthy',
      installedAt: '2026-08-24T15:07:00.000Z',
    });
    expect(promoted.builds.map((item) => item.buildId)).not.toContain(original.previousBuildIds[2]);
    expect(promoted.transaction).toBeNull();
    expect(promoted.generation).toBe(original.generation + 1);
  });

  it('creates a protocol-2 baseline from validated protocol-1 launcher state', () => {
    const current = build('r1-1111111111111111', '1.6.0', SHA512_A, SHA256_A, COMMIT_A);
    const previous = build('r1-2222222222222222', '1.5.0', SHA512_B, SHA256_B, COMMIT_B);

    expect(
      createRecoveryBaseline(
        '[Relay]\r\nprotocol=1\r\ncurrent=r1-1111111111111111\r\nprevious=r1-2222222222222222\r\n',
        [current, previous],
      ),
    ).toEqual({
      protocol: 2,
      generation: 1,
      currentBuildId: current.buildId,
      candidateBuildId: null,
      previousBuildIds: [previous.buildId],
      builds: [current, previous],
      transaction: null,
      failedReleaseFingerprints: [],
    });
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

  it('refuses a baseline when protocol-1 state references a build without verified metadata', () => {
    const current = build('r1-1111111111111111', '1.6.0', SHA512_A, SHA256_A, COMMIT_A);

    expect(
      createRecoveryBaseline(
        '[Relay]\nprotocol=1\ncurrent=r1-1111111111111111\nprevious=r1-2222222222222222\n',
        [current],
      ),
    ).toBeNull();
  });
});
