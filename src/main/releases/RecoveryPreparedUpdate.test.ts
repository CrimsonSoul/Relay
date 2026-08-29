import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDirectoryRedirect,
  supportsUnprivilegedFileSymlinks,
} from '../__tests__/filesystemTestUtils';
import {
  parseRecoveryPreparedUpdate,
  readRecoveryPreparedUpdate,
  type RecoveryPreparedUpdate,
} from './RecoveryPreparedUpdate';

const PREPARED: RecoveryPreparedUpdate = {
  protocol: 2,
  transactionId: '12345678-1234-4123-8123-123456789abc',
  buildId: `r2-${'2'.repeat(40)}`,
  version: '1.1.0',
  releaseTag: 'v1.1.0',
  targetCommitish: '2'.repeat(40),
  runtimeSha512: 'a'.repeat(128),
  installerSha256: 'b'.repeat(64),
  recoveryProtocol: 2,
  serverDataEpoch: 1,
  clientDataEpoch: 1,
  preparedAt: '2026-08-27T12:00:00.000Z',
  health: 'candidate',
};

function serializePrepared(overrides: Partial<Record<keyof RecoveryPreparedUpdate, string>> = {}) {
  const values = { ...PREPARED, ...overrides };
  return `[Prepared]\nprotocol=${values.protocol}\ntransactionId=${values.transactionId}\nbuildId=${values.buildId}\nversion=${values.version}\nreleaseTag=${values.releaseTag}\ntargetCommitish=${values.targetCommitish}\nruntimeSha512=${values.runtimeSha512}\ninstallerSha256=${values.installerSha256}\nrecoveryProtocol=${values.recoveryProtocol}\nserverDataEpoch=${values.serverDataEpoch}\nclientDataEpoch=${values.clientDataEpoch}\npreparedAt=${values.preparedAt}\nhealth=${values.health}\n`;
}

describe('RecoveryPreparedUpdate', () => {
  let relayRoot: string;
  const outsideDirectories: string[] = [];

  beforeEach(async () => {
    relayRoot = await mkdtemp(join(tmpdir(), 'relay-prepared-update-'));
  });

  afterEach(async () => {
    await rm(relayRoot, { recursive: true, force: true });
    await Promise.all(
      outsideDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('parses only the exact prepared receipt schema', () => {
    const serialized = serializePrepared();

    expect(parseRecoveryPreparedUpdate(serialized)).toEqual(PREPARED);
    expect(parseRecoveryPreparedUpdate(`${serialized}unexpected=value\n`)).toBeNull();
    expect(parseRecoveryPreparedUpdate(serializePrepared({ health: 'healthy' }))).toBeNull();
    expect(parseRecoveryPreparedUpdate(serializePrepared({ releaseTag: 'v1.2.0' }))).toBeNull();
  });

  it('reads a bounded regular receipt from the fixed recovery directory', async () => {
    const recoveryRoot = join(relayRoot, 'Recovery');
    await mkdir(recoveryRoot);
    await writeFile(join(recoveryRoot, 'prepared.ini'), serializePrepared());

    await expect(readRecoveryPreparedUpdate(relayRoot)).resolves.toEqual(PREPARED);
  });

  it('rejects oversized prepared receipts', async () => {
    const recoveryRoot = join(relayRoot, 'Recovery');
    await mkdir(recoveryRoot);
    const preparedPath = join(recoveryRoot, 'prepared.ini');
    await writeFile(preparedPath, 'x'.repeat(32 * 1_024 + 1));
    await expect(readRecoveryPreparedUpdate(relayRoot)).rejects.toThrow(/prepared receipt/i);
  });

  it.skipIf(!supportsUnprivilegedFileSymlinks)(
    'rejects a symbolic-link prepared receipt',
    async () => {
      const recoveryRoot = join(relayRoot, 'Recovery');
      await mkdir(recoveryRoot);
      const preparedPath = join(recoveryRoot, 'prepared.ini');
      const outsideFile = join(relayRoot, 'outside.ini');
      await writeFile(outsideFile, serializePrepared());
      await symlink(outsideFile, preparedPath);
      await expect(readRecoveryPreparedUpdate(relayRoot)).rejects.toThrow(/prepared receipt/i);
    },
  );

  it('rejects a redirected recovery directory', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'relay-prepared-outside-'));
    outsideDirectories.push(outside);
    await writeFile(join(outside, 'prepared.ini'), serializePrepared());
    await createDirectoryRedirect(outside, join(relayRoot, 'Recovery'));

    await expect(readRecoveryPreparedUpdate(relayRoot)).rejects.toThrow(/recovery directory/i);
  });
});
