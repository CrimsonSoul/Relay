import { describe, it, expect, vi, beforeEach } from 'vitest';
import { atomicWriteWithLock, modifyJsonWithLock } from './fileLock';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';

// Mock logger
vi.mock('./logger', () => ({
  loggers: {
    fileManager: {
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

// Mock file handle returned by fs.open()
const mockFileHandle = {
  writeFile: vi.fn().mockResolvedValue(undefined),
  datasync: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    readFile: vi.fn(),
    access: vi.fn(),
    open: vi.fn(),
    stat: vi.fn(),
  },
}));

describe('fileLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileHandle.writeFile.mockResolvedValue(undefined);
    mockFileHandle.datasync.mockResolvedValue(undefined);
    mockFileHandle.close.mockResolvedValue(undefined);
  });

  describe('atomicWriteWithLock', () => {
    it('should write to a temp file then rename it', async () => {
      const filePath = '/data/test.json';
      const content = '{"test": true}';

      vi.mocked(fs.open).mockResolvedValue(mockFileHandle as unknown as FileHandle);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      await atomicWriteWithLock(filePath, content);

      expect(fs.open).toHaveBeenCalledWith(expect.stringContaining(filePath), 'w', 0o600);
      expect(mockFileHandle.writeFile).toHaveBeenCalledWith(content, 'utf-8');
      expect(mockFileHandle.datasync).toHaveBeenCalled();
      expect(mockFileHandle.close).toHaveBeenCalled();
      expect(fs.rename).toHaveBeenCalled();
    });

    it('should retry on rename failure', async () => {
      const filePath = '/data/test.json';
      const content = '{"test": true}';

      vi.mocked(fs.open).mockResolvedValue(mockFileHandle as unknown as FileHandle);
      vi.mocked(fs.rename)
        .mockRejectedValueOnce(new Error('Locked'))
        .mockResolvedValueOnce(undefined);

      await atomicWriteWithLock(filePath, content);

      expect(fs.rename).toHaveBeenCalledTimes(2);
    });

    it('should clean up temp file on final failure', async () => {
      const filePath = '/data/test.json';
      const content = '{"test": true}';

      vi.mocked(fs.open).mockResolvedValue(mockFileHandle as unknown as FileHandle);
      vi.mocked(fs.rename).mockRejectedValue(new Error('Persistent error'));
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      await expect(atomicWriteWithLock(filePath, content)).rejects.toThrow('Persistent error');
      expect(fs.unlink).toHaveBeenCalled();
    });
  });

  describe('modifyJsonWithLock', () => {
    it('should read, modify, and write JSON', async () => {
      const filePath = '/data/test.json';
      const initialData = { count: 1 };
      const defaultValue = { count: 0 };

      vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as unknown as Stats);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(initialData));
      vi.mocked(fs.open).mockResolvedValue(mockFileHandle as unknown as FileHandle);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      await modifyJsonWithLock(
        filePath,
        (data: Record<string, number>) => {
          data.count += 1;
          return data;
        },
        defaultValue,
      );

      expect(mockFileHandle.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('"count": 2'),
        'utf-8',
      );
    });

    it('should use default value if file does not exist', async () => {
      const filePath = '/data/test.json';
      const defaultValue = { count: 0 };

      const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      vi.mocked(fs.readFile).mockRejectedValue(enoentError);
      vi.mocked(fs.open).mockResolvedValue(mockFileHandle as unknown as FileHandle);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      await modifyJsonWithLock(
        filePath,
        (data: Record<string, number>) => {
          data.count += 1;
          return data;
        },
        defaultValue,
      );

      expect(mockFileHandle.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('"count": 1'),
        'utf-8',
      );
    });

    it('should throw on parse error instead of falling back', async () => {
      const filePath = '/data/test.json';
      const defaultValue = { count: 0 };

      vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as unknown as Stats);
      vi.mocked(fs.readFile).mockResolvedValue('invalid json');

      // Suppress the unhandled rejection from the internal pathLock cleanup chain
      const suppress = () => {
        /* swallow */
      };
      process.on('unhandledRejection', suppress);

      await expect(
        modifyJsonWithLock(
          filePath,
          (data: Record<string, number>) => {
            data.count += 1;
            return data;
          },
          defaultValue,
        ),
      ).rejects.toThrow('Corrupt JSON');

      // Allow the pathLock cleanup to settle before removing the handler
      await new Promise((r) => setTimeout(r, 0));
      process.removeListener('unhandledRejection', suppress);
    });
  });
});
