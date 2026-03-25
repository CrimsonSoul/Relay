import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import type PocketBase from 'pocketbase';
import { loggers } from '../logger';

const logger = loggers.backup;

export class BackupManager {
  private backupsDir: string;
  private maxBackups = 10;
  private pb: PocketBase | null = null;

  constructor(dataDir: string) {
    // PocketBase API stores backups in pb_data/backups/, so prune from the same location
    this.backupsDir = join(dataDir, 'pb_data', 'backups');
    mkdirSync(this.backupsDir, { recursive: true });
  }

  /** Set the authenticated PocketBase client for API-based backups. */
  setPocketBase(pb: PocketBase): void {
    this.pb = pb;
  }

  async backup(): Promise<string> {
    if (!this.pb) {
      throw new Error('PocketBase client not ready — try again in a moment');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${timestamp}.zip`;

    await this.pb.backups.create(backupName);
    logger.info('Backup created via PB API', { name: backupName });
    this.pruneOldBackups();
    return join(this.backupsDir, backupName);
  }

  /**
   * Restore from a named backup.
   * Creates a safety backup first, then delegates to PB's restore API.
   * Caller is responsible for restarting PocketBase after this returns.
   */
  async restore(name: string): Promise<void> {
    if (!this.pb) throw new Error('No PocketBase client available');

    // Safety backup before overwriting
    const safetyName = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    try {
      await this.pb.backups.create(safetyName);
      logger.info('Pre-restore safety backup created', { name: safetyName });
    } catch (err) {
      logger.error('Failed to create pre-restore safety backup', { error: err });
      throw new Error('Could not create safety backup before restore');
    }

    // Restore the requested backup
    await this.pb.backups.restore(name);
    logger.info('Backup restored', { name });
  }

  private pruneOldBackups(): void {
    const files = readdirSync(this.backupsDir)
      .filter((f) => f.endsWith('.db') || f.endsWith('.zip'))
      .map((f) => ({
        name: f,
        path: join(this.backupsDir, f),
        mtime: statSync(join(this.backupsDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const file of files.slice(this.maxBackups)) {
      rmSync(file.path);
      logger.info('Pruned old backup', { path: file.path });
    }
  }

  listBackups(): Array<{ name: string; date: Date; size: number }> {
    if (!existsSync(this.backupsDir)) return [];
    return readdirSync(this.backupsDir)
      .filter((f) => f.endsWith('.db') || f.endsWith('.zip'))
      .map((f) => {
        const stat = statSync(join(this.backupsDir, f));
        return { name: f, date: stat.mtime, size: stat.size };
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }
}
