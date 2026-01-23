import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performBackup } from './BackupOperations';
import fs from 'fs/promises';
import { join } from 'path';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    rm: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock logger
vi.mock('../logger', () => ({
  loggers: {
    fileManager: {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

describe('BackupOperations', () => {
  const rootDir = '/test/root';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create backup directory and copy files', async () => {
    const result = await performBackup(rootDir, 'test-reason');

    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('backups'), { recursive: true });
    expect(fs.copyFile).toHaveBeenCalled();
    expect(result).toContain('backups');
  });

  it('should handle missing source files gracefully (ENOENT)', async () => {
    const error = new Error('No such file') as any;
    error.code = 'ENOENT';
    vi.mocked(fs.copyFile).mockRejectedValue(error);

    const result = await performBackup(rootDir);

    expect(result).not.toBeNull();
    // Should NOT log error for ENOENT
  });

  it('should prune old backups', async () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const oldFolderName = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}-${String(oldDate.getDate()).padStart(2, '0')}_12-00-00`;
    
    vi.mocked(fs.readdir).mockResolvedValue([oldFolderName] as any);

    await performBackup(rootDir);

    expect(fs.rm).toHaveBeenCalledWith(
      expect.stringContaining(oldFolderName),
      expect.any(Object)
    );
  });
});
