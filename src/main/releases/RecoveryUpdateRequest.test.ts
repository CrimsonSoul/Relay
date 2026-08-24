import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveryBuildRecord } from './RecoveryCatalog';
import {
  completeRecoveryUpdateRequest,
  parseRecoveryUpdateRequest,
  readRecoveryUpdateRequest,
  serializeRecoveryUpdateRequest,
  writeRecoveryUpdateRequest,
  type RecoveryUpdateRequest,
} from './RecoveryUpdateRequest';

const SOURCE: RecoveryBuildRecord = {
  buildId: 'r1-1111111111111111111111111111111111111111',
  version: '1.6.0',
  releaseTag: 'v1.6.0',
  targetCommitish: '1'.repeat(40),
  runtimeSha512: 'a'.repeat(128),
  installerSha256: null,
  recoveryProtocol: 1,
  serverDataEpoch: 1,
  clientDataEpoch: 1,
  installedAt: '2026-08-24T15:00:00.000Z',
  health: 'healthy',
  rollbackSnapshotId: null,
};

function request(): RecoveryUpdateRequest {
  return {
    protocol: 2,
    transactionId: '11111111-2222-4333-8444-555555555555',
    source: SOURCE,
    targetVersion: '1.7.0',
    targetCommitish: '2'.repeat(40),
    targetInstallerSha256: 'b'.repeat(64),
    mode: 'server',
    checkpoint: 'pending',
    snapshotId: null,
    requestedAt: '2026-08-24T15:05:00.000Z',
  };
}

describe('RecoveryUpdateRequest', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'relay-recovery-request-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('round-trips the source build and verified candidate identity', () => {
    const original = request();

    expect(parseRecoveryUpdateRequest(serializeRecoveryUpdateRequest(original))).toEqual(original);
  });

  it.each([
    ['a path-like source build', 'buildId=..\\outside'],
    ['an injected target version', 'targetVersion=1.7.0\r\nphase=healthy'],
    ['a shortened installer digest', `targetInstallerSha256=${'b'.repeat(63)}`],
    ['a noncanonical transaction', 'transactionId=transaction-one'],
  ])('rejects %s', (_label, replacement) => {
    const valid = serializeRecoveryUpdateRequest(request());
    const key = replacement.slice(0, replacement.indexOf('='));
    const damaged = valid.replace(new RegExp(`${key}=[^\\r\\n]*`, 'u'), replacement);

    expect(parseRecoveryUpdateRequest(damaged)).toBeNull();
  });

  it('atomically writes the one pending request inside a private recovery directory', async () => {
    const createPrivateDirectory = vi.fn((path: string) => mkdir(path, { mode: 0o700 }));

    const requestPath = await writeRecoveryUpdateRequest(
      directory,
      request(),
      createPrivateDirectory,
    );

    expect(requestPath).toBe(join(directory, 'Recovery', 'update-request.ini'));
    expect(createPrivateDirectory).toHaveBeenCalledWith(join(directory, 'Recovery'));
    expect(parseRecoveryUpdateRequest(await readFile(requestPath, 'utf8'))).toEqual(request());
    await expect(readRecoveryUpdateRequest(directory)).resolves.toEqual(request());
  });

  it('completes a server checkpoint only when its transaction and snapshot IDs match', async () => {
    await writeRecoveryUpdateRequest(directory, request(), (path) => mkdir(path, { mode: 0o700 }));

    await expect(
      completeRecoveryUpdateRequest(
        directory,
        '11111111-2222-4333-8444-555555555555',
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      ),
    ).resolves.toMatchObject({ checkpoint: 'complete' });
    await expect(
      completeRecoveryUpdateRequest(
        directory,
        '99999999-2222-4333-8444-555555555555',
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      ),
    ).rejects.toThrow(/transaction/i);
  });

  it('refuses to write through a redirected recovery directory', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'relay-recovery-outside-'));
    await symlink(outside, join(directory, 'Recovery'));
    try {
      await expect(
        writeRecoveryUpdateRequest(directory, request(), (path) => mkdir(path)),
      ).rejects.toThrow(/redirected/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
