import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureDataFilesAsync,
  copyDataFilesAsync,
  loadConfigAsync,
  saveConfigAsync,
} from './dataUtils';
import fsPromises from 'node:fs/promises';
import { app } from 'electron';

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

vi.mock('./operations/FileContext', () => ({
  JSON_DATA_FILES: ['contacts.json', 'servers.json', 'oncall.json'],
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
    it('returns false when all target files already exist', async () => {
      // access succeeds (file exists) → skip copy
      vi.mocked(fsPromises.access).mockResolvedValue(undefined);
      const result = await copyDataFilesAsync('/source', '/target');
      expect(result).toBe(false);
      expect(fsPromises.copyFile).not.toHaveBeenCalled();
    });

    it('copies files that do not exist in target', async () => {
      // Promise.all runs all 3 file checks concurrently.
      // Order: target-1, target-2, target-3, source-1, source-2, source-3
      vi.mocked(fsPromises.access)
        .mockRejectedValueOnce(new Error('not found')) // target-1 fails → go to catch
        .mockRejectedValueOnce(new Error('not found')) // target-2 fails → go to catch
        .mockRejectedValueOnce(new Error('not found')) // target-3 fails → go to catch
        .mockResolvedValueOnce(undefined) // source-1 exists → copy
        .mockResolvedValueOnce(undefined) // source-2 exists → copy
        .mockResolvedValueOnce(undefined); // source-3 exists → copy

      const result = await copyDataFilesAsync('/source', '/target');
      expect(result).toBe(true);
      expect(fsPromises.copyFile).toHaveBeenCalledTimes(3);
    });

    it('skips copy when source file also does not exist', async () => {
      // both target and source access fail
      vi.mocked(fsPromises.access).mockRejectedValue(new Error('not found'));
      const result = await copyDataFilesAsync('/source', '/target');
      expect(result).toBe(false);
      expect(fsPromises.copyFile).not.toHaveBeenCalled();
    });

    it('handles mkdir failure gracefully', async () => {
      vi.mocked(fsPromises.mkdir).mockRejectedValueOnce(new Error('perm denied'));
      vi.mocked(fsPromises.access).mockResolvedValue(undefined); // target exists
      // Should not throw
      const result = await copyDataFilesAsync('/source', '/target');
      expect(result).toBe(false);
    });

    it('returns true if at least one file was copied', async () => {
      // First file: target doesn't exist, source does → copy
      // Second file: target exists → skip
      // Third file: target exists → skip
      vi.mocked(fsPromises.access)
        .mockRejectedValueOnce(new Error('not found')) // target file 1
        .mockResolvedValueOnce(undefined) // source file 1
        .mockResolvedValueOnce(undefined) // target file 2 exists
        .mockResolvedValueOnce(undefined); // target file 3 exists

      const result = await copyDataFilesAsync('/source', '/target');
      expect(result).toBe(true);
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
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        // eslint-disable-next-line sonarjs/publicly-writable-directories
        '/tmp/user-data/config.json',
        '{\n  "dataRoot": "/my/path"\n}',
        'utf-8',
      );
    });

    it('handles writeFile error gracefully', async () => {
      vi.mocked(fsPromises.writeFile).mockRejectedValueOnce(new Error('disk full'));
      await expect(saveConfigAsync({})).resolves.toBeUndefined();
    });
  });
});
