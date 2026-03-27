import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupBackupHandlers } from './backupHandlers';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../logger', () => ({
  loggers: { backup: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } },
}));

describe('backupHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};

  const mockBackupManager = {
    listBackups: vi.fn(),
    backup: vi.fn(),
    restore: vi.fn(),
  };

  const mockOfflineCache = {
    clear: vi.fn(),
  };

  const restartPb = vi.fn();
  const getBackupManager = vi.fn(() => mockBackupManager as never);
  const getOfflineCache = vi.fn(() => mockOfflineCache as never);

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers[channel] = handler;
        return ipcMain;
      },
    );

    setupBackupHandlers(getBackupManager, restartPb, getOfflineCache);
  });

  it('registers three IPC handlers', () => {
    const calls = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(calls).toContain('backup:list');
    expect(calls).toContain('backup:create');
    expect(calls).toContain('backup:restore');
  });

  describe('BACKUP_LIST', () => {
    it('returns formatted backup list', async () => {
      const date = new Date('2026-01-15T10:00:00Z');
      mockBackupManager.listBackups.mockReturnValue([
        { name: 'backup-001.zip', date, size: 1024 },
        { name: 'backup-002.zip', date, size: 2048 },
      ]);

      const result = await handlers[IPC_CHANNELS.BACKUP_LIST]();

      expect(result).toEqual([
        { name: 'backup-001.zip', date: date.toISOString(), size: 1024 },
        { name: 'backup-002.zip', date: date.toISOString(), size: 2048 },
      ]);
    });

    it('returns empty array when backup manager is null', async () => {
      getBackupManager.mockReturnValueOnce(null as never);

      const result = await handlers[IPC_CHANNELS.BACKUP_LIST]();

      expect(result).toEqual([]);
    });

    it('returns empty array when no backups exist', async () => {
      mockBackupManager.listBackups.mockReturnValue([]);

      const result = await handlers[IPC_CHANNELS.BACKUP_LIST]();

      expect(result).toEqual([]);
    });
  });

  describe('BACKUP_CREATE', () => {
    it('creates a backup and returns success with path', async () => {
      mockBackupManager.backup.mockResolvedValue('/path/to/backup.zip');

      const result = await handlers[IPC_CHANNELS.BACKUP_CREATE]();

      expect(result).toEqual({ success: true, data: '/path/to/backup.zip' });
    });

    it('returns failure when backup manager is null', async () => {
      getBackupManager.mockReturnValueOnce(null as never);

      const result = await handlers[IPC_CHANNELS.BACKUP_CREATE]();

      expect(result).toEqual({ success: false, error: 'Backup manager not available' });
    });

    it('returns failure when backup throws an Error', async () => {
      mockBackupManager.backup.mockRejectedValue(new Error('Disk full'));

      const result = await handlers[IPC_CHANNELS.BACKUP_CREATE]();

      expect(result).toEqual({ success: false, error: 'Disk full' });
    });

    it('returns failure with stringified error for non-Error throws', async () => {
      mockBackupManager.backup.mockRejectedValue('string error');

      const result = await handlers[IPC_CHANNELS.BACKUP_CREATE]();

      expect(result).toEqual({ success: false, error: 'string error' });
    });
  });

  describe('BACKUP_RESTORE', () => {
    it('restores a valid backup, clears cache, and restarts PB', async () => {
      mockBackupManager.restore.mockResolvedValue(undefined);
      restartPb.mockResolvedValue(true);

      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, 'backup-001.zip');

      expect(mockBackupManager.restore).toHaveBeenCalledWith('backup-001.zip');
      expect(mockOfflineCache.clear).toHaveBeenCalled();
      expect(restartPb).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('rejects names with path traversal (..)', async () => {
      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, '../etc/passwd.zip');

      expect(mockBackupManager.restore).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'Invalid backup name' });
    });

    it('rejects names without .zip extension', async () => {
      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, 'backup.tar.gz');

      expect(mockBackupManager.restore).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'Invalid backup name' });
    });

    it('rejects names with special characters', async () => {
      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, 'back up!.zip');

      expect(mockBackupManager.restore).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'Invalid backup name' });
    });

    it('rejects non-string name', async () => {
      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, 42);

      expect(mockBackupManager.restore).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'Invalid backup name' });
    });

    it('rejects names with path separators', async () => {
      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, 'sub/dir/backup.zip');

      expect(mockBackupManager.restore).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, error: 'Invalid backup name' });
    });

    it('returns failure when backup manager is null', async () => {
      getBackupManager.mockReturnValueOnce(null as never);

      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, 'backup.zip');

      expect(result).toEqual({ success: false, error: 'Backup manager not available' });
    });

    it('returns failure when restore throws an Error', async () => {
      mockBackupManager.restore.mockRejectedValue(new Error('Corrupted archive'));

      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, 'backup.zip');

      expect(result).toEqual({ success: false, error: 'Corrupted archive' });
    });

    it('returns failure with stringified error for non-Error throws', async () => {
      mockBackupManager.restore.mockRejectedValue('unknown error');

      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, 'backup.zip');

      expect(result).toEqual({ success: false, error: 'unknown error' });
    });

    it('returns failure when PocketBase fails to restart after restore', async () => {
      mockBackupManager.restore.mockResolvedValue(undefined);
      restartPb.mockResolvedValue(false);

      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, 'backup.zip');

      expect(result).toEqual({
        success: false,
        error: 'Backup restored but PocketBase failed to restart',
      });
    });

    it('handles offline cache clear failure gracefully during restore', async () => {
      mockBackupManager.restore.mockResolvedValue(undefined);
      mockOfflineCache.clear.mockImplementation(() => {
        throw new Error('cache error');
      });
      restartPb.mockResolvedValue(true);

      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, 'backup.zip');

      expect(result).toEqual({ success: true });
    });

    it('handles null offline cache during restore', async () => {
      getOfflineCache.mockReturnValueOnce(null as never);
      mockBackupManager.restore.mockResolvedValue(undefined);
      restartPb.mockResolvedValue(true);

      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, 'backup.zip');

      expect(result).toEqual({ success: true });
    });

    it('accepts valid names with dots, dashes, and underscores', async () => {
      mockBackupManager.restore.mockResolvedValue(undefined);
      restartPb.mockResolvedValue(true);

      const result = await handlers[IPC_CHANNELS.BACKUP_RESTORE]({}, 'relay_backup-2026.03.27.zip');

      expect(mockBackupManager.restore).toHaveBeenCalledWith('relay_backup-2026.03.27.zip');
      expect(result).toEqual({ success: true });
    });
  });
});
