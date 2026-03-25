import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { BackupEntry, IpcResult } from '@shared/ipc';
import type { BackupManager } from '../pocketbase/BackupManager';
import { loggers } from '../logger';

const logger = loggers.backup;

export function setupBackupHandlers(
  getBackupManager: () => BackupManager | null,
  restartPb: () => Promise<boolean>,
): void {
  ipcMain.handle(IPC_CHANNELS.BACKUP_LIST, async (): Promise<BackupEntry[]> => {
    const mgr = getBackupManager();
    if (!mgr) return [];

    return mgr.listBackups().map((b) => ({
      name: b.name,
      date: b.date.toISOString(),
      size: b.size,
    }));
  });

  ipcMain.handle(IPC_CHANNELS.BACKUP_CREATE, async (): Promise<IpcResult<string>> => {
    const mgr = getBackupManager();
    if (!mgr) return { success: false, error: 'Backup manager not available' };

    try {
      const path = await mgr.backup();
      if (!path) return { success: false, error: 'Backup creation failed' };
      return { success: true, data: path };
    } catch (err) {
      logger.error('Manual backup failed', { error: err });
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BACKUP_RESTORE, async (_event, name: string): Promise<IpcResult> => {
    const mgr = getBackupManager();
    if (!mgr) return { success: false, error: 'Backup manager not available' };

    try {
      await mgr.restore(name);
      logger.info('Backup restored, restarting PocketBase...');
      const restarted = await restartPb();
      if (!restarted) {
        return { success: false, error: 'Backup restored but PocketBase failed to restart' };
      }
      return { success: true };
    } catch (err) {
      logger.error('Backup restore failed', { error: err });
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
