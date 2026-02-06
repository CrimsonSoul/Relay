import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join, resolve } from 'path';

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
import { loggers } from './logger';
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

  describe('resolveExistingFile', () => {
    it('returns first existing file path', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);
      vi.mocked(fs.access)
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce(undefined);

      const result = await service.resolveExistingFile(['a.csv', 'b.csv']);
      expect(result).toBe(join(ROOT, 'b.csv'));
    });

    it('returns null when no files exist', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await service.resolveExistingFile(['a.csv', 'b.csv']);
      expect(result).toBeNull();
    });

    it('skips files that fail path validation', async () => {
      vi.mocked(validatePath)
        .mockResolvedValueOnce(false) // first file fails validation
        .mockResolvedValueOnce(true); // second file passes
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);

      const result = await service.resolveExistingFile(['../evil.csv', 'good.csv']);
      expect(result).toBe(join(ROOT, 'good.csv'));
      expect(loggers.fileManager.warn).toHaveBeenCalledWith(expect.stringContaining('../evil.csv'));
    });
  });

  describe('isDummyData', () => {
    it('returns true when files match', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce('hello\r\nworld')
        .mockResolvedValueOnce('hello\nworld');

      const result = await service.isDummyData('file.csv');
      expect(result).toBe(true);
    });

    it('returns false when files differ', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);
      vi.mocked(fs.readFile).mockResolvedValueOnce('content A').mockResolvedValueOnce('content B');

      const result = await service.isDummyData('file.csv');
      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('read fail'));

      const result = await service.isDummyData('file.csv');
      expect(result).toBe(false);
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

  describe('atomicWriteFullPath', () => {
    it('rejects paths outside rootDir', async () => {
      await expect(service.atomicWriteFullPath('/other/location/file.csv', 'data')).rejects.toThrow(
        'Path validation failed',
      );
      expect(loggers.security.error).toHaveBeenCalledWith(
        expect.stringContaining('outside data root'),
      );
    });

    it('writes to valid paths inside rootDir', async () => {
      vi.mocked(atomicWriteWithLock).mockResolvedValue(undefined);
      const fullPath = resolve(ROOT, 'sub/file.csv');

      await service.atomicWriteFullPath(fullPath, 'content');
      expect(atomicWriteWithLock).toHaveBeenCalledWith(fullPath, '\uFEFFcontent');
    });
  });
});
