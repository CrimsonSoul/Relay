import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDirectoryRedirect,
  supportsUnprivilegedFileSymlinks,
} from '../__tests__/filesystemTestUtils';
import {
  createRecoveryServerSnapshot,
  recoverySnapshotFailure,
  RecoverySnapshotError,
} from './RecoverySnapshot';

const diskOperations = vi.hoisted(() => [] as string[]);
const snapshotPathName = (path: string) =>
  path.replace(/^.*RecoverySnapshots[\\/][0-9a-f-]{36}/u, '').replaceAll('\\', '/');
vi.mock('../utils/durableFile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/durableFile')>();
  return {
    ...actual,
    flushFile: async (path: string) => {
      diskOperations.push(`flush:${snapshotPathName(path)}`);
      await actual.flushFile(path);
    },
  };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      diskOperations.push('publish');
      await actual.rename(...args);
    },
  };
});

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

  it('flushes every copied file and the manifest before publishing the snapshot', async () => {
    diskOperations.length = 0;

    await createRecoveryServerSnapshot({
      userDataRoot,
      dataDirectory,
      transactionId: '11111111-2222-4333-8444-555555555555',
      sourceBuildId: `r1-${'1'.repeat(40)}`,
      dataEpoch: 1,
      createPrivateDirectory: (path: string) => mkdir(path, { mode: 0o700 }),
      snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      statfs: async () => ({ bavail: 10_000_000, bsize: 4_096 }),
    });

    expect(diskOperations.at(-1)).toBe('publish');
    expect(diskOperations.slice(0, -1).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'flush:.staging/data/data.db',
      'flush:.staging/data/nested/unknown.collection',
      'flush:.staging/snapshot.ini',
    ]);
  });

  it('leaves out backup check folders unless a restore journal still needs them', async () => {
    const options = {
      userDataRoot,
      dataDirectory,
      transactionId: '11111111-2222-4333-8444-555555555555',
      sourceBuildId: `r1-${'1'.repeat(40)}`,
      dataEpoch: 1,
      createPrivateDirectory: (path: string) => mkdir(path, { mode: 0o700 }),
      statfs: async () => ({ bavail: 10_000_000, bsize: 4_096 }),
    };
    await mkdir(join(dataDirectory, '.relay-backup-verify-abc123'));
    await writeFile(join(dataDirectory, '.relay-backup-verify-abc123', 'data.db'), 'unpacked');
    await writeFile(join(dataDirectory, 'nested', '.relay-backup-verify-kept'), 'nested');

    const skipped = await createRecoveryServerSnapshot({
      ...options,
      snapshotId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
    expect(skipped.bytes).toBe(
      Buffer.byteLength('database bytes') +
        Buffer.byteLength('preserve me') +
        Buffer.byteLength('nested'),
    );
    await expect(
      stat(join(skipped.path, 'data', '.relay-backup-verify-abc123')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(join(skipped.path, 'data', 'nested', '.relay-backup-verify-kept'), 'utf8'),
    ).resolves.toBe('nested');

    await writeFile(join(dataDirectory, '.relay-backup-restore.json'), '{}');
    const kept = await createRecoveryServerSnapshot({
      ...options,
      snapshotId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    });
    await expect(
      readFile(join(kept.path, 'data', '.relay-backup-verify-abc123', 'data.db'), 'utf8'),
    ).resolves.toBe('unpacked');
  });

  it('names why a snapshot failed', () => {
    expect(recoverySnapshotFailure(new RecoverySnapshotError('changed', 'changed'))).toBe(
      'changed',
    );
    expect(recoverySnapshotFailure(Object.assign(new Error('full'), { code: 'ENOSPC' }))).toBe(
      'space',
    );
    for (const code of ['EBUSY', 'EPERM', 'EACCES'])
      expect(recoverySnapshotFailure(Object.assign(new Error('in use'), { code }))).toBe('locked');
    expect(recoverySnapshotFailure(Object.assign(new Error('gone'), { code: 'ENOENT' }))).toBe(
      'changed',
    );
    expect(recoverySnapshotFailure(new Error('other'))).toBe('other');
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
    ).rejects.toMatchObject({ failure: 'space', message: expect.stringMatching(/free space/i) });
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
      ).rejects.toMatchObject({
        failure: 'unsupported',
        message: expect.stringMatching(/symbolic link/i),
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
