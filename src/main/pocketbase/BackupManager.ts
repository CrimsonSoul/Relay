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

  async backup(): Promise<string | null> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${timestamp}.zip`;

    try {
      if (this.pb) {
        // Use PocketBase backup API for a consistent snapshot
        await this.pb.backups.create(backupName);
        logger.info('Backup created via PB API', { name: backupName });
      } else {
        logger.warn('No PocketBase client — skipping backup');
        return null;
      }
      this.pruneOldBackups();
      return join(this.backupsDir, backupName);
    } catch (err) {
      logger.error('Backup failed', { error: err });
      return null;
    }
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
