import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureDataFilesAsync,
  copyDataFilesAsync,
  loadConfigAsync,
  saveConfigAsync,
} from './dataUtils';
import fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { atomicWriteWithLock } from './fileLock';

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn(async () => undefined),
    access: vi.fn(async () => undefined),
    copyFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => '{}'),
    writeFile: vi.fn(async () => undefined),
  },
}));

vi.mock('electron', () => ({
  app: {
    // eslint-disable-next-line sonarjs/publicly-writable-directories
    getPath: vi.fn(() => '/tmp/user-data'),
  },
}));

vi.mock('./logger', () => ({
  loggers: {
    fileManager: {
      debug: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('./fileLock', () => ({
  atomicWriteWithLock: vi.fn(async () => undefined),
}));

describe('dataUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureDataFilesAsync', () => {
    it('creates the target directory', async () => {
      await ensureDataFilesAsync('/data/relay');
      expect(fsPromises.mkdir).toHaveBeenCalledWith('/data/relay', { recursive: true });
    });

    it('handles mkdir error gracefully', async () => {
      vi.mocked(fsPromises.mkdir).mockRejectedValueOnce(new Error('permission denied'));
      await expect(ensureDataFilesAsync('/data/relay')).resolves.toBeUndefined();
    });
  });

  describe('copyDataFilesAsync', () => {
    it('creates the target directory and returns true', async () => {
      const result = await copyDataFilesAsync('/source', '/target');
      expect(result).toBe(true);
      expect(fsPromises.mkdir).toHaveBeenCalledWith('/target', { recursive: true });
    });

    it('returns false on mkdir failure', async () => {
      vi.mocked(fsPromises.mkdir).mockRejectedValueOnce(new Error('perm denied'));
      const result = await copyDataFilesAsync('/source', '/target');
      expect(result).toBe(false);
    });
  });

  describe('loadConfigAsync', () => {
    it('returns empty object when config file does not exist', async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValueOnce(new Error('ENOENT'));
      const result = await loadConfigAsync();
      expect(result).toEqual({});
    });

    it('returns parsed config with dataRoot', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce('{"dataRoot":"/custom/path"}');
      const result = await loadConfigAsync();
      expect(result).toEqual({ dataRoot: '/custom/path' });
    });

    it('returns empty object for empty config {}', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce('{}');
      const result = await loadConfigAsync();
      expect(result).toEqual({});
    });

    it('returns empty object when config is not a plain object (array)', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce('[]');
      const result = await loadConfigAsync();
      expect(result).toEqual({});
    });

    it('returns empty object when config is null', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce('null');
      const result = await loadConfigAsync();
      expect(result).toEqual({});
    });

    it('returns empty object when dataRoot is not a string', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce('{"dataRoot":123}');
      const result = await loadConfigAsync();
      expect(result).toEqual({});
    });

    it('uses app userData path', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce('{}');
      await loadConfigAsync();
      expect(app.getPath).toHaveBeenCalledWith('userData');
    });
  });

  describe('saveConfigAsync', () => {
    it('writes config to userData/config.json', async () => {
      await saveConfigAsync({ dataRoot: '/my/path' });
      expect(atomicWriteWithLock).toHaveBeenCalledWith(
        // eslint-disable-next-line sonarjs/publicly-writable-directories
        join('/tmp/user-data', 'config.json'),
        '{\n  "dataRoot": "/my/path"\n}',
      );
    });

    it('handles write error gracefully', async () => {
      vi.mocked(atomicWriteWithLock).mockRejectedValueOnce(new Error('disk full'));
      await expect(saveConfigAsync({})).resolves.toBeUndefined();
    });
  });
});
