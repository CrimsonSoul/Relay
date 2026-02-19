import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'path';

// Mock dependencies
vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    readFile: vi.fn(),
  },
}));

vi.mock('./fileLock', () => ({
  atomicWriteWithLock: vi.fn(),
}));

vi.mock('./utils/pathSafety', () => ({
  validatePath: vi.fn(),
}));

vi.mock('./logger', () => ({
  loggers: {
    main: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    fileManager: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    security: { error: vi.fn() },
  },
}));

import fs from 'fs/promises';
import { atomicWriteWithLock } from './fileLock';
import { validatePath } from './utils/pathSafety';
import { FileSystemService } from './FileSystemService';

const ROOT = '/data/root';
const BUNDLED = '/data/bundled';

describe('FileSystemService', () => {
  let service: FileSystemService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FileSystemService(ROOT, BUNDLED);
  });

  describe('constructor', () => {
    it('sets rootDir and bundledDataPath', () => {
      expect(service.rootDir).toBe(ROOT);
      expect(service.bundledDataPath).toBe(BUNDLED);
    });
  });

  describe('readFile', () => {
    it('returns content', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);
      vi.mocked(fs.readFile).mockResolvedValue('file content');

      const result = await service.readFile('test.csv');
      expect(result).toBe('file content');
      expect(fs.readFile).toHaveBeenCalledWith(join(ROOT, 'test.csv'), 'utf-8');
    });

    it('returns null for ENOENT', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);
      const err = new Error('not found') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      vi.mocked(fs.readFile).mockRejectedValue(err);

      const result = await service.readFile('missing.csv');
      expect(result).toBeNull();
    });

    it('throws for other errors', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);
      const err = new Error('permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      vi.mocked(fs.readFile).mockRejectedValue(err);

      await expect(service.readFile('secret.csv')).rejects.toThrow('permission denied');
    });
  });

  describe('atomicWrite', () => {
    it('prepends BOM and calls atomicWriteWithLock', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);
      vi.mocked(atomicWriteWithLock).mockResolvedValue(undefined);

      await service.atomicWrite('out.csv', 'data');
      expect(atomicWriteWithLock).toHaveBeenCalledWith(join(ROOT, 'out.csv'), '\uFEFFdata');
    });

    it('does not double-add BOM', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);
      vi.mocked(atomicWriteWithLock).mockResolvedValue(undefined);

      await service.atomicWrite('out.csv', '\uFEFFdata');
      expect(atomicWriteWithLock).toHaveBeenCalledWith(join(ROOT, 'out.csv'), '\uFEFFdata');
    });

    it('throws on path traversal', async () => {
      vi.mocked(validatePath).mockResolvedValue(false);

      await expect(service.atomicWrite('../etc/passwd', 'evil')).rejects.toThrow(
        'Path validation failed',
      );
    });
  });
});
