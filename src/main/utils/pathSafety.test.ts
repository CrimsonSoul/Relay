import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isUncPath, validatePath } from './pathSafety';
import fsPromises from 'fs/promises';
import { normalize, resolve } from 'path';

// Mock logger
vi.mock('../logger', () => ({
  loggers: {
    security: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    realpath: vi.fn(),
  },
}));

describe('pathSafety', () => {
  describe('isUncPath', () => {
    it('should identify Windows UNC paths', () => {
      expect(isUncPath('\\\\server\\share')).toBe(true);
      expect(isUncPath('//server/share')).toBe(true);
      expect(isUncPath('\\\\?\\C:\\')).toBe(true);
    });

    it('should identify non-UNC paths', () => {
      expect(isUncPath('C:\\Windows')).toBe(false);
      expect(isUncPath('/usr/local/bin')).toBe(false);
      expect(isUncPath('./relative')).toBe(false);
      expect(isUncPath('relative/path')).toBe(false);
    });
  });

  describe('validatePath', () => {
    const root = '/apps/Relay/data';

    beforeEach(() => {
      vi.clearAllMocks();
      // Default behavior: realpath returns the path itself
      vi.mocked(fsPromises.realpath).mockImplementation(async (p) => p.toString());
    });

    it('should allow valid paths within root', async () => {
      expect(await validatePath('contacts.json', root)).toBe(true);
      expect(await validatePath('subdir/file.json', root)).toBe(true);
    });

    it('should block path traversal', async () => {
      expect(await validatePath('../../../etc/passwd', root)).toBe(false);
      expect(await validatePath('subdir/../../etc/passwd', root)).toBe(false);
    });

    it('should block absolute paths', async () => {
      expect(await validatePath('/etc/passwd', root)).toBe(false);
    });

    it('should block UNC paths', async () => {
      expect(await validatePath('\\\\server\\share', root)).toBe(false);
    });

    it('should block symlink escapes', async () => {
      const symlinkPath = 'uploads/link';
      const resolvedSymlink = '/etc/passwd';
      
      const absSymlinkPath = resolve(root, symlinkPath);
      
      vi.mocked(fsPromises.realpath).mockImplementation(async (p) => {
        if (p === root) return root;
        if (p === absSymlinkPath) return resolvedSymlink;
        return p.toString();
      });

      expect(await validatePath(symlinkPath, root)).toBe(false);
    });

    it('should block if root cannot be resolved', async () => {
      vi.mocked(fsPromises.realpath).mockImplementation(async (p) => {
        if (p === root) throw new Error('Not found');
        return p.toString();
      });

      expect(await validatePath('file.json', root)).toBe(false);
    });
  });
});
