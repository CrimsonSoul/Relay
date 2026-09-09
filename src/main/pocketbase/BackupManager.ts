import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { statfs, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type PocketBase from 'pocketbase';
import type { BackupHealth, BackupRestorePoint } from '@shared/backupHealth';
import { verifyBackupArchive } from './BackupVerification';
import { loggers } from '../logger';

const DAY = 24 * 60 * 60 * 1000;
const RETRY = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const point = z.object({
  name: z
    .string()
    .regex(/^[\w.-]+\.zip$/)
    .refine((n) => !n.includes('..')),
  completedAt: z.iso.datetime(),
  fingerprint: z.string(),
});
const healthSchema = z.object({
  attempts: z
    .array(
      z.object({
        startedAt: z.iso.datetime(),
        completedAt: z.iso.datetime().optional(),
        outcome: z.enum(['started', 'success', 'failed']),
      }),
    )
    .max(20),
  lastSuccess: point.optional(),
  lastVerified: point.optional(),
  lastVerification: z
    .object({
      name: point.shape.name,
      completedAt: z.iso.datetime(),
      outcome: z.enum(['success', 'failed']),
    })
    .optional(),
  lastFailure: z
    .enum([
      'Backup failed. Check administrator access and available disk space, then retry.',
      'Not enough disk space. Free space outside Relay history and backups, then retry.',
      'Disposable verification failed. Retention is paused; retain the earlier verified backup.',
      'Previous backup was interrupted. Retry backup.',
    ])
    .optional(),
  retryDue: z.iso.datetime().optional(),
  failures: z.number().int().min(0).max(1_000_000),
});
type SavedHealth = z.infer<typeof healthSchema>;

export class BackupManager {
  private readonly backupsDir: string;
  private readonly healthPath: string;
  private pb: PocketBase | null = null;
  private state: SavedHealth = { attempts: [], failures: 0 };
  private queue: Promise<unknown> = Promise.resolve();
  private active = false;
  private maintenanceWakeup?: () => void;

  constructor(private readonly dataDir: string) {
    this.backupsDir = join(dataDir, 'pb_data', 'backups');
    this.healthPath = join(dataDir, 'backup-health.json');
    mkdirSync(this.backupsDir, { recursive: true });
    try {
      if (statSync(this.healthPath).size <= 64 * 1024)
        this.state = healthSchema.parse(JSON.parse(readFileSync(this.healthPath, 'utf8')));
    } catch {
      /* Invalid or absent state grants no retention permission. */
    }
    if (this.state.attempts.some((attempt) => attempt.outcome === 'started')) {
      for (const attempt of this.state.attempts)
        if (attempt.outcome === 'started') {
          attempt.outcome = 'failed';
          attempt.completedAt = new Date().toISOString();
        }
      this.fail('Previous backup was interrupted. Retry backup.');
    }
  }

  setPocketBase(pb: PocketBase): void {
    this.pb = pb;
  }

  setMaintenanceWakeup(wakeup: () => void): void {
    this.maintenanceWakeup = wakeup;
  }

  private save(): void {
    const temporary = `${this.healthPath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(this.state), { mode: 0o600, flag: 'wx' });
      const fd = openSync(temporary, 'r');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, this.healthPath);
      if (process.platform !== 'win32') {
        const directoryFd = openSync(this.dataDir, 'r');
        try {
          fsyncSync(directoryFd);
        } finally {
          closeSync(directoryFd);
        }
      }
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  private fingerprint(name: string): string {
    this.validateName(name);
    const stat = lstatSync(join(this.backupsDir, name));
    if (!stat.isFile() || stat.size === 0) throw new Error('Backup file missing or empty');
    return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
  }

  private unchanged(point?: BackupRestorePoint): boolean {
    try {
      return !!point && this.fingerprint(point.name) === point.fingerprint;
    } catch {
      return false;
    }
  }

  getHealth(now = Date.now()): BackupHealth {
    const success = this.state.lastSuccess;
    const age =
      success && this.unchanged(success)
        ? Math.max(0, now - Date.parse(success.completedAt))
        : null;
    const retentionAllowed =
      !this.state.lastFailure &&
      age !== null &&
      age < DAY &&
      this.unchanged(this.state.lastVerified) &&
      this.state.lastVerified?.name === success?.name;
    return {
      ...structuredClone(this.state),
      retentionAllowed,
      restorePointAgeMs: age,
      busy: this.active,
    };
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const job = this.queue.then(async () => {
      this.active = true;
      try {
        return await run();
      } finally {
        this.active = false;
      }
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  private fail(message: NonNullable<SavedHealth['lastFailure']>): void {
    this.state.lastFailure = message;
    this.state.failures = Math.min(this.state.failures + 1, 1_000_000);
    this.state.retryDue = new Date(
      Date.now() + RETRY[Math.min(this.state.failures - 1, 2)]!,
    ).toISOString();
    try {
      this.save();
    } catch {
      loggers.backup.warn('Backup health could not be persisted; check available disk space');
    }
  }

  private async checkSpace(): Promise<void> {
    const estimate = async (dir: string): Promise<number> => {
      let bytes = 0;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === 'backups' || entry.isSymbolicLink()) continue;
        const path = join(dir, entry.name);
        bytes += entry.isDirectory() ? await estimate(path) : (await lstat(path)).size;
      }
      return bytes;
    };
    const filesystem = await statfs(this.dataDir);
    const required = 512 * 1024 * 1024 + 2 * (await estimate(join(this.dataDir, 'pb_data')));
    if (filesystem.bavail * filesystem.bsize < required) {
      const error = new Error('Insufficient disk space');
      Object.assign(error, { code: 'ENOSPC' });
      throw error;
    }
  }

  backup(): Promise<string> {
    return this.exclusive(() => this.create()).finally(() => this.maintenanceWakeup?.());
  }

  backupIfDue(
    now = new Date(),
    minimumAgeMs = DAY,
    authenticate?: () => Promise<void>,
  ): Promise<string | null> {
    return this.exclusive(async () => {
      const health = this.getHealth(now.getTime());
      if (
        health.retentionAllowed &&
        health.restorePointAgeMs !== null &&
        health.restorePointAgeMs < minimumAgeMs
      )
        return null;
      return this.create(authenticate);
    });
  }

  private async create(authenticate?: () => Promise<void>): Promise<string> {
    const attempt: SavedHealth['attempts'][number] = {
      startedAt: new Date().toISOString(),
      outcome: 'started',
    };
    this.state.attempts = [...this.state.attempts, attempt].slice(-20);
    let verificationStarted = false;
    try {
      this.save();
      await authenticate?.();
      if (!this.pb) throw new Error('PocketBase client not ready');
      await this.checkSpace();
      const name = this.makeName('backup');
      await this.pb.backups.create(name);
      const fingerprint = this.fingerprint(name);
      const fd = openSync(join(this.backupsDir, name), 'r');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.state.lastSuccess = { name, completedAt: new Date().toISOString(), fingerprint };
      this.save();
      verificationStarted = true;
      await this.verifyInternal(name);
      attempt.outcome = 'success';
      attempt.completedAt = new Date().toISOString();
      this.state.failures = 0;
      delete this.state.lastFailure;
      this.state.retryDue = new Date(Date.now() + DAY).toISOString();
      this.save();
      this.pruneOldBackups();
      return join(this.backupsDir, name);
    } catch (error) {
      attempt.outcome = 'failed';
      attempt.completedAt = new Date().toISOString();
      let message: NonNullable<SavedHealth['lastFailure']> =
        'Backup failed. Check administrator access and available disk space, then retry.';
      if (verificationStarted)
        message =
          'Disposable verification failed. Retention is paused; retain the earlier verified backup.';
      if ((error as NodeJS.ErrnoException)?.code === 'ENOSPC')
        message =
          'Not enough disk space. Free space outside Relay history and backups, then retry.';
      this.fail(message);
      throw new Error(message);
    }
  }

  verify(name: string): Promise<void> {
    return this.exclusive(async () => {
      this.validateName(name);
      try {
        await this.checkSpace();
        await this.verifyInternal(name);
        if (!name.startsWith('pre_restore') && !this.state.lastSuccess) {
          this.state.lastSuccess = {
            name,
            fingerprint: this.fingerprint(name),
            completedAt: new Date(
              Math.min(Date.now(), statSync(join(this.backupsDir, name)).mtimeMs),
            ).toISOString(),
          };
        }
        if (this.state.lastSuccess?.name === name) {
          delete this.state.lastFailure;
          this.state.failures = 0;
        }
        this.save();
      } catch {
        this.fail(
          'Disposable verification failed. Retention is paused; retain the earlier verified backup.',
        );
        throw new Error(this.state.lastFailure);
      }
    }).finally(() => this.maintenanceWakeup?.());
  }

  private async verifyInternal(name: string): Promise<void> {
    const fingerprint = this.fingerprint(name);
    try {
      await verifyBackupArchive(join(this.backupsDir, name), this.dataDir);
      if (this.fingerprint(name) !== fingerprint)
        throw new Error('Backup changed during verification');
      const currentCertificate = this.state.lastVerified;
      const protectsCurrentBackup =
        currentCertificate?.name === this.state.lastSuccess?.name &&
        this.unchanged(currentCertificate) &&
        this.unchanged(this.state.lastSuccess);
      // Inspecting another archive must not replace the certificate used by
      // current-backup retention checks. Its result is recorded independently.
      if (name === this.state.lastSuccess?.name || !protectsCurrentBackup) {
        this.state.lastVerified = { name, completedAt: new Date().toISOString(), fingerprint };
      }
      this.state.lastVerification = {
        name,
        completedAt: new Date().toISOString(),
        outcome: 'success',
      };
    } catch (error) {
      this.state.lastVerification = {
        name,
        completedAt: new Date().toISOString(),
        outcome: 'failed',
      };
      throw error;
    } finally {
      this.save();
    }
  }

  restore(name: string, afterRestore?: () => Promise<void>): Promise<void> {
    return this.exclusive(async () => {
      this.validateName(name);
      this.fingerprint(name);
      if (!this.pb) throw new Error('No PocketBase client available');
      await this.checkSpace();
      const safetyName = this.makeName('pre_restore');
      await this.pb.backups.create(safetyName);
      this.fingerprint(safetyName);
      await verifyBackupArchive(join(this.backupsDir, safetyName), this.dataDir);
      await this.pb.backups.restore(name);
      await afterRestore?.();
      // Source remains present for the complete restore and restart transaction.
      this.pruneOldBackups(name);
    });
  }

  private makeName(prefix: string): string {
    return `${prefix}_${new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')}_${randomUUID()}.zip`;
  }
  private validateName(name: string): void {
    if (typeof name !== 'string' || !/^[\w.-]+\.zip$/.test(name) || name.includes('..'))
      throw new Error('Invalid backup name');
  }

  private pruneOldBackups(protectedName?: string): void {
    if (!this.getHealth().retentionAllowed) return;
    for (const [safety, keep] of [
      [false, 10],
      [true, 3],
    ] as const) {
      const files = this.listBackups().filter(
        (file) => file.name.startsWith('pre_restore') === safety,
      );
      const protectedFiles = new Set([
        protectedName,
        this.state.lastVerified?.name,
        this.state.lastSuccess?.name,
      ]);
      const keepNames = new Set(
        files.filter((file) => protectedFiles.has(file.name)).map((file) => file.name),
      );
      for (const file of files) if (keepNames.size < keep) keepNames.add(file.name);
      for (const file of files.filter((file) => !keepNames.has(file.name)))
        this.removeOldBackup(file.name);
    }
  }

  private removeOldBackup(name: string): void {
    try {
      rmSync(join(this.backupsDir, name));
    } catch {
      loggers.backup.warn('Could not prune old backup');
    }
  }

  listBackups(): Array<{ name: string; date: Date; size: number }> {
    if (!existsSync(this.backupsDir)) return [];
    return readdirSync(this.backupsDir)
      .filter((name) => /^[\w.-]+\.zip$/.test(name) && !name.includes('..'))
      .flatMap((name) => {
        try {
          const stat = lstatSync(join(this.backupsDir, name));
          return stat.isFile() ? [{ name, date: stat.mtime, size: stat.size }] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }
}
