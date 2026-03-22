import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { loggers } from '../logger';

const logger = loggers.backup;

export class BackupManager {
  private backupsDir: string;
  private dbPath: string;
  private maxBackups = 10;

  constructor(dataDir: string) {
    this.backupsDir = join(dataDir, 'backups');
    this.dbPath = join(dataDir, 'pb_data', 'data.db');
    mkdirSync(this.backupsDir, { recursive: true });
  }

  backup(): string | null {
    if (!existsSync(this.dbPath)) {
      logger.warn('No database file to back up');
      return null;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(this.backupsDir, `${timestamp}.db`);
    try {
      copyFileSync(this.dbPath, backupPath);
      logger.info('Backup created', { path: backupPath });
      this.pruneOldBackups();
      return backupPath;
    } catch (err) {
      logger.error('Backup failed', { error: err });
      return null;
    }
  }

  private pruneOldBackups(): void {
    const files = readdirSync(this.backupsDir)
      .filter((f) => f.endsWith('.db'))
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
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const stat = statSync(join(this.backupsDir, f));
        return { name: f, date: stat.mtime, size: stat.size };
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }
}
