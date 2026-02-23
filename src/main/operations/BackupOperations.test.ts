import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performBackup } from './BackupOperations';
import fs from 'node:fs/promises';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
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
    // Should attempt to copy JSON data files + additional files
    expect(fs.copyFile).toHaveBeenCalled();
    expect(result).toContain('backups');
  });

  it('should handle missing source files gracefully (ENOENT)', async () => {
    const error = Object.assign(new Error('No such file'), { code: 'ENOENT' });
    vi.mocked(fs.copyFile).mockRejectedValue(error);

    const result = await performBackup(rootDir);

    // Should still return a backup path even if files are missing
    expect(result).not.toBeNull();
  });

  it('should prune old backups', async () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const oldFolderName = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}-${String(oldDate.getDate()).padStart(2, '0')}_12-00-00`;

    vi.mocked(fs.readdir).mockResolvedValue([oldFolderName] as unknown as Awaited<
      ReturnType<typeof fs.readdir>
    >);

    await performBackup(rootDir);

    expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining(oldFolderName), expect.any(Object));
  });
});
