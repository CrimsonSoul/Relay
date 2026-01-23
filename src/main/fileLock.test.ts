import { describe, it, expect, vi, beforeEach } from 'vitest';
import { atomicWriteWithLock, modifyJsonWithLock } from './fileLock';
import fs from 'fs/promises';
import { existsSync } from 'fs';

// Mock logger
vi.mock('./logger', () => ({
  loggers: {
    fileManager: {
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    readFile: vi.fn(),
  },
}));

// Mock existsSync
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

describe('fileLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('atomicWriteWithLock', () => {
    it('should write to a temp file then rename it', async () => {
      const filePath = '/data/test.json';
      const content = '{"test": true}';
      
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      await atomicWriteWithLock(filePath, content);

      expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining(filePath), content, 'utf-8');
      expect(fs.rename).toHaveBeenCalled();
    });

    it('should retry on rename failure', async () => {
      const filePath = '/data/test.json';
      const content = '{"test": true}';
      
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename)
        .mockRejectedValueOnce(new Error('Locked'))
        .mockResolvedValueOnce(undefined);

      await atomicWriteWithLock(filePath, content);

      expect(fs.rename).toHaveBeenCalledTimes(2);
    });

    it('should clean up temp file on final failure', async () => {
      const filePath = '/data/test.json';
      const content = '{"test": true}';
      
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockRejectedValue(new Error('Persistent error'));
      vi.mocked(existsSync).mockReturnValue(true);
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
      
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(initialData));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      await modifyJsonWithLock(filePath, (data: any) => {
        data.count += 1;
        return data;
      }, defaultValue);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"count": 2'),
        'utf-8'
      );
    });

    it('should use default value if file does not exist', async () => {
      const filePath = '/data/test.json';
      const defaultValue = { count: 0 };
      
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      await modifyJsonWithLock(filePath, (data: any) => {
        data.count += 1;
        return data;
      }, defaultValue);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"count": 1'),
        'utf-8'
      );
    });

    it('should fall back to default value on parse error', async () => {
      const filePath = '/data/test.json';
      const defaultValue = { count: 0 };
      
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue('invalid json');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      await modifyJsonWithLock(filePath, (data: any) => {
        data.count += 1;
        return data;
      }, defaultValue);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"count": 1'),
        'utf-8'
      );
    });
  });
});
