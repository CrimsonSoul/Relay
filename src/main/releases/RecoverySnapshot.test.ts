import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDirectoryRedirect,
  supportsUnprivilegedFileSymlinks,
} from '../__tests__/filesystemTestUtils';
import { createRecoveryServerSnapshot } from './RecoverySnapshot';

describe('RecoverySnapshot', () => {
  let userDataRoot: string;
  let dataDirectory: string;

  beforeEach(async () => {
    userDataRoot = await mkdtemp(join(tmpdir(), 'relay-recovery-snapshot-'));
    dataDirectory = join(userDataRoot, 'data');
    await mkdir(join(dataDirectory, 'nested'), { recursive: true });
    await writeFile(join(dataDirectory, 'data.db'), 'database bytes');
    await writeFile(join(dataDirectory, 'nested', 'unknown.collection'), 'preserve me');
  });

  afterEach(async () => {
    await rm(userDataRoot, { recursive: true, force: true });
  });

  it('copies the complete stopped server data tree and writes readiness last', async () => {
    const createPrivateDirectory = vi.fn((path: string) => mkdir(path, { mode: 0o700 }));

    const snapshot = await createRecoveryServerSnapshot({
      userDataRoot,
      dataDirectory,
      transactionId: '11111111-2222-4333-8444-555555555555',
      sourceBuildId: `r1-${'1'.repeat(40)}`,
      dataEpoch: 1,
      createPrivateDirectory,
      snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      now: () => new Date('2026-08-24T15:10:00.000Z'),
      statfs: async () => ({ bavail: 10_000_000, bsize: 4_096 }),
    });

    expect(snapshot).toMatchObject({
      snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      bytes: Buffer.byteLength('database bytes') + Buffer.byteLength('preserve me'),
    });
    await expect(readFile(join(snapshot.path, 'data', 'data.db'), 'utf8')).resolves.toBe(
      'database bytes',
    );
    await expect(
      readFile(join(snapshot.path, 'data', 'nested', 'unknown.collection'), 'utf8'),
    ).resolves.toBe('preserve me');
    await expect(readFile(join(snapshot.path, 'snapshot.ini'), 'utf8')).resolves.toContain(
      'complete=1',
    );
    await expect(stat(`${snapshot.path}.staging`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails before copying when free space cannot hold a safe snapshot margin', async () => {
    await expect(
      createRecoveryServerSnapshot({
        userDataRoot,
        dataDirectory,
        transactionId: '11111111-2222-4333-8444-555555555555',
        sourceBuildId: `r1-${'1'.repeat(40)}`,
        dataEpoch: 1,
        createPrivateDirectory: (path) => mkdir(path, { mode: 0o700 }),
        snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        statfs: async () => ({ bavail: 1, bsize: 4_096 }),
      }),
    ).rejects.toThrow(/free space/i);
    await expect(
      stat(join(userDataRoot, 'RecoverySnapshots', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(!supportsUnprivilegedFileSymlinks)(
    'refuses a symbolic link anywhere in server data',
    async () => {
      const outside = await mkdtemp(join(tmpdir(), 'relay-recovery-linked-'));
      await writeFile(join(outside, 'secret'), 'outside');
      await symlink(join(outside, 'secret'), join(dataDirectory, 'linked'));
      try {
        await expect(
          createRecoveryServerSnapshot({
            userDataRoot,
            dataDirectory,
            transactionId: '11111111-2222-4333-8444-555555555555',
            sourceBuildId: 'r1-1111111111111111111111111111111111111111',
            dataEpoch: 1,
            createPrivateDirectory: (path) => mkdir(path, { mode: 0o700 }),
            snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            statfs: async () => ({ bavail: 10_000_000, bsize: 4_096 }),
          }),
        ).rejects.toThrow(/symbolic link/i);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    },
  );

  it('refuses a redirected directory anywhere in server data', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'relay-recovery-redirected-'));
    await writeFile(join(outside, 'secret'), 'outside');
    await createDirectoryRedirect(outside, join(dataDirectory, 'redirected'));
    try {
      await expect(
        createRecoveryServerSnapshot({
          userDataRoot,
          dataDirectory,
          transactionId: '11111111-2222-4333-8444-555555555555',
          sourceBuildId: 'r1-1111111111111111111111111111111111111111',
          dataEpoch: 1,
          createPrivateDirectory: (path) => mkdir(path, { mode: 0o700 }),
          snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          statfs: async () => ({ bavail: 10_000_000, bsize: 4_096 }),
        }),
      ).rejects.toThrow(/symbolic link/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
