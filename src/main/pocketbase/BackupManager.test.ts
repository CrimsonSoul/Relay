import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as fsPromises from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import { BackupManager } from './BackupManager';
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, statfs: vi.fn(actual.statfs) };
});
vi.mock('../logger', () => ({
  loggers: { backup: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));
vi.mock('./BackupVerification', () => ({
  verifyBackupArchive: vi.fn().mockResolvedValue(undefined),
}));
import { verifyBackupArchive } from './BackupVerification';
let dir: string;
let manager: BackupManager;
let names: string[];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyBackupArchive).mockResolvedValue(undefined);
  dir = mkdtempSync(join(tmpdir(), 'relay-backup-test-'));
  manager = new BackupManager(dir);
  names = [];
  manager.setPocketBase({
    backups: {
      create: async (name: string) => {
        names.push(name);
        writeFileSync(join(dir, 'pb_data/backups', name), 'archive');
      },
      restore: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as PocketBase);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});
describe('backup recovery safety', () => {
  it('records an authentication failure before calling backup and preserves it across restart', async () => {
    await expect(
      manager.backupIfDue(new Date(), 86400000, async () => {
        throw new Error('secret password');
      }),
    ).rejects.toThrow();
    expect(names).toHaveLength(0);
    const status = new BackupManager(dir).getHealth();
    expect(status.attempts.at(-1)?.outcome).toBe('failed');
    expect(status.lastFailure).not.toContain('secret');
    expect(Date.parse(status.retryDue!) - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(status.retentionAllowed).toBe(false);
  });
  it('requires a durable verified fresh regular archive for retention', async () => {
    const path = await manager.backup();
    expect(manager.getHealth().retentionAllowed).toBe(true);
    expect(manager.getHealth().lastVerified?.name).toBe(basename(path));
    await expect(manager.backupIfDue()).resolves.toBeNull();
    rmSync(path);
    expect(manager.getHealth().retentionAllowed).toBe(false);
  });
  it('fails closed on verification failure without losing the earlier verified archive', async () => {
    const first = await manager.backup();
    vi.mocked(verifyBackupArchive).mockRejectedValueOnce(new Error('corrupt'));
    await expect(manager.backup()).rejects.toThrow();
    expect(manager.getHealth().retentionAllowed).toBe(false);
    expect(manager.getHealth().lastVerified?.name).toBe(basename(first));
    expect(existsSync(first)).toBe(true);
  });
  it('does not trust pre-existing filenames or modification times', () => {
    writeFileSync(join(dir, 'pb_data/backups/backup_recent.zip'), 'not verified');
    expect(manager.getHealth().retentionAllowed).toBe(false);
  });
  it('bounds backoff at 15 minutes, 1 hour, and 6 hours', async () => {
    for (const minutes of [15, 60, 360, 360]) {
      await expect(
        manager.backupIfDue(new Date(), 0, async () => {
          throw new Error('auth');
        }),
      ).rejects.toThrow();
      expect(Math.round((Date.parse(manager.getHealth().retryDue!) - Date.now()) / 60_000)).toBe(
        minutes,
      );
    }
  });
  it('keeps independent regular and safety budgets after verified replacement', async () => {
    for (let i = 0; i < 12; i++) writeFileSync(join(dir, `pb_data/backups/old${i}.zip`), 'old');
    for (let i = 0; i < 5; i++)
      writeFileSync(join(dir, `pb_data/backups/pre_restore_${i}.zip`), 'old');
    await manager.backup();
    const files = readdirSync(join(dir, 'pb_data/backups'));
    expect(files.filter((n) => !n.startsWith('pre_restore'))).toHaveLength(10);
    expect(files.filter((n) => n.startsWith('pre_restore'))).toHaveLength(3);
  });
  it('serializes creates and makes collision-resistant names', async () => {
    await Promise.all([manager.backup(), manager.backup()]);
    expect(new Set(names).size).toBe(2);
  });
  it('rejects unsafe names in the manager boundary', async () => {
    await expect(manager.verify('../data.db')).rejects.toThrow('Invalid backup name');
    await expect(manager.restore('../data.db')).rejects.toThrow('Invalid backup name');
  });
});

it('pauses deletion on disk pressure without calling the backup API', async () => {
  vi.mocked(fsPromises.statfs).mockResolvedValueOnce({ bavail: 1, bsize: 4096 } as Awaited<
    ReturnType<typeof fsPromises.statfs>
  >);
  await expect(manager.backup()).rejects.toThrow('Not enough disk space');
  expect(names).toHaveLength(0);
  expect(manager.getHealth().retentionAllowed).toBe(false);
});
it('requires the completed archive to exist even after API success', async () => {
  manager.setPocketBase({ backups: { create: async () => undefined } } as unknown as PocketBase);
  await expect(manager.backup()).rejects.toThrow();
  expect(manager.getHealth().lastSuccess).toBeUndefined();
});
it('makes stale and changed archives ineligible', async () => {
  const archive = await manager.backup();
  expect(manager.getHealth(Date.now() + 86400001).retentionAllowed).toBe(false);
  writeFileSync(archive, 'changed bytes');
  expect(manager.getHealth().retentionAllowed).toBe(false);
});
it('keeps the manager locked through restore restart', async () => {
  const archive = await manager.backup();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const restore = manager.restore(basename(archive), async () => {
    entered();
    await gate;
  });
  await started;
  const count = names.length;
  const create = manager.backup();
  await Promise.resolve();
  expect(names).toHaveLength(count);
  release();
  await restore;
  await create;
  expect(names).toHaveLength(count + 1);
});
it('converts interrupted persisted attempts to failures', () => {
  writeFileSync(
    join(dir, 'backup-health.json'),
    JSON.stringify({
      attempts: [{ startedAt: new Date().toISOString(), outcome: 'started' }],
      failures: 0,
    }),
  );
  const status = new BackupManager(dir).getHealth();
  expect(status.attempts[0]?.outcome).toBe('failed');
  expect(status.lastFailure).toContain('interrupted');
});

it('lists only safe regular ZIP files, sorted by date, excluding legacy databases', () => {
  writeFileSync(join(dir, 'pb_data/backups/valid.zip'), 'archive');
  writeFileSync(join(dir, 'pb_data/backups/legacy.db'), 'legacy');
  writeFileSync(join(dir, 'pb_data/backups/invalid..zip'), 'invalid');
  expect(manager.listBackups().map((item) => ({ name: item.name, size: item.size }))).toEqual([
    { name: 'valid.zip', size: 7 },
  ]);
});
it('preserves the selected restore source even when it falls beyond the safety budget', async () => {
  await manager.backup();
  const source = join(dir, 'pb_data/backups/pre_restore_selected.zip');
  writeFileSync(source, 'source');
  for (let i = 0; i < 5; i++)
    writeFileSync(join(dir, `pb_data/backups/pre_restore_extra${i}.zip`), 'extra');
  await manager.restore(basename(source));
  expect(existsSync(source)).toBe(true);
});
it('does not restore or prune if the required safety backup fails', async () => {
  const source = await manager.backup();
  const restore = vi.fn();
  manager.setPocketBase({
    backups: {
      create: async () => {
        throw new Error('ENOSPC');
      },
      restore,
    },
  } as unknown as PocketBase);
  await expect(manager.restore(basename(source))).rejects.toThrow();
  expect(restore).not.toHaveBeenCalled();
  expect(existsSync(source)).toBe(true);
});

it('records backend ENOSPC and never evicts earlier recovery points to retry', async () => {
  const source = await manager.backup();
  manager.setPocketBase({
    backups: {
      create: async () => {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      },
    },
  } as unknown as PocketBase);
  await expect(manager.backup()).rejects.toThrow('Not enough disk space');
  expect(existsSync(source)).toBe(true);
  expect(manager.getHealth().lastVerified?.name).toBe(basename(source));
  expect(manager.getHealth().retentionAllowed).toBe(false);
});
it('bounds the persisted attempt history', async () => {
  for (let i = 0; i < 22; i++) await manager.backup();
  expect(new BackupManager(dir).getHealth().attempts).toHaveLength(20);
});

it.each(['older regular', 'safety'])(
  'preserves current protection when verifying an %s archive, then advances on replacement',
  async (kind) => {
    const older =
      kind === 'safety'
        ? join(dir, 'pb_data/backups/pre_restore_older.zip')
        : await manager.backup();
    if (kind === 'safety') writeFileSync(older, 'safety archive');
    const current = await manager.backup();
    const certificate = manager.getHealth().lastVerified;
    await manager.verify(basename(older));
    expect(manager.getHealth().lastVerification?.name).toBe(basename(older));
    expect(manager.getHealth().lastVerified).toEqual(certificate);
    expect(manager.getHealth().lastSuccess?.name).toBe(basename(current));
    expect(manager.getHealth().retentionAllowed).toBe(true);
    expect(new BackupManager(dir).getHealth().retentionAllowed).toBe(true);
    expect(manager.getHealth(Date.now() + 86400001).retentionAllowed).toBe(false);

    const replacement = await manager.backup();
    expect(manager.getHealth().lastVerified?.name).toBe(basename(replacement));
    expect(manager.getHealth().retentionAllowed).toBe(true);
    vi.mocked(verifyBackupArchive).mockRejectedValueOnce(new Error('corrupt'));
    await expect(manager.verify(basename(older))).rejects.toThrow();
    expect(manager.getHealth().lastVerification).toMatchObject({
      name: basename(older),
      outcome: 'failed',
    });
    expect(manager.getHealth().lastVerified?.name).toBe(basename(replacement));
    expect(manager.getHealth().retentionAllowed).toBe(false);
  },
);

it('does not preserve a missing current certificate or grant retention for the wrong archive', async () => {
  const older = await manager.backup();
  const current = await manager.backup();
  rmSync(current);
  await manager.verify(basename(older));
  expect(manager.getHealth().lastVerified?.name).toBe(basename(older));
  expect(manager.getHealth().lastSuccess?.name).toBe(basename(current));
  expect(manager.getHealth().retentionAllowed).toBe(false);
});

it('establishes a certificate when an existing archive has never been verified', async () => {
  writeFileSync(join(dir, 'pb_data/backups/existing.zip'), 'archive');
  await manager.verify('existing.zip');
  expect(manager.getHealth().lastVerified?.name).toBe('existing.zip');
  expect(manager.getHealth().lastSuccess?.name).toBe('existing.zip');
  expect(manager.getHealth().retentionAllowed).toBe(true);
});
