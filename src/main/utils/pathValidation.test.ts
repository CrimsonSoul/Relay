import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { validateDataPath } from './pathValidation';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return join(os.homedir(), 'Library', 'Application Support', 'Relay');
      if (name === 'home') return os.homedir();
      return os.tmpdir();
    }),
  },
}));

// Mock logger
vi.mock('../logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logger')>();
  return {
    ...actual,
    loggers: {
      fileManager: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    },
  };
});

describe('validateDataPath', () => {
  // Use a path within home dir since validation now requires it
  const testDir = join(os.homedir(), '.relay-test-data');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should return success for a valid writeable directory', async () => {
    fs.mkdirSync(testDir);
    const result = await validateDataPath(testDir);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should create directory if it does not exist', async () => {
    const result = await validateDataPath(testDir);
    expect(result.success).toBe(true);
    expect(fs.existsSync(testDir)).toBe(true);
  });

  it('should return error for invalid path (mocked failure)', async () => {
    // Spy on fsPromises.writeFile to throw EACCES
    const spy = vi
      .spyOn(fsPromises, 'writeFile')
      .mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));

    const result = await validateDataPath(testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Write permission denied');

    spy.mockRestore();
  });

  it('should reject sibling prefix paths outside home directory', async () => {
    const outsideHomeWithPrefix = `${os.homedir()}-malicious`;
    const result = await validateDataPath(outsideHomeWithPrefix);
    expect(result.success).toBe(false);
    expect(result.error).toContain('within user home directory');
  });

  it('should return error for empty path', async () => {
    const result = await validateDataPath('');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Path is empty.');
  });

  it('should reject path traversal attempts', async () => {
    // normalize resolves /Users/../etc/passwd to /etc/passwd which no longer
    // contains ".." — but it's still rejected because it's outside home dir
    const result = await validateDataPath('/Users/../etc/passwd');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should reject relative paths', async () => {
    const result = await validateDataPath('relative/path');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Path must be absolute.');
  });

  it('should reject paths outside home and userData directories', async () => {
    // eslint-disable-next-line sonarjs/publicly-writable-directories
    const result = await validateDataPath('/var/tmp/some-path');
    expect(result.success).toBe(false);
    expect(result.error).toContain('within user home directory');
  });

  it('should handle EPERM error during write check', async () => {
    const spy = vi
      .spyOn(fsPromises, 'writeFile')
      .mockRejectedValue(Object.assign(new Error('Operation not permitted'), { code: 'EPERM' }));

    const result = await validateDataPath(testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Write permission denied');

    spy.mockRestore();
  });

  it('should handle EROFS error (read-only filesystem)', async () => {
    const spy = vi
      .spyOn(fsPromises, 'writeFile')
      .mockRejectedValue(Object.assign(new Error('Read-only filesystem'), { code: 'EROFS' }));

    const result = await validateDataPath(testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('read-only file system');

    spy.mockRestore();
  });

  it('should handle generic errors during filesystem access', async () => {
    const spy = vi.spyOn(fsPromises, 'writeFile').mockRejectedValue(new Error('Unknown error'));

    const result = await validateDataPath(testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid folder');

    spy.mockRestore();
  });

  it('should handle non-Error objects thrown during filesystem access', async () => {
    const spy = vi.spyOn(fsPromises, 'writeFile').mockRejectedValue('string error');

    const result = await validateDataPath(testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid folder');

    spy.mockRestore();
  });

  it('should accept paths within userData directory', async () => {
    const userDataPath = join(os.homedir(), 'Library', 'Application Support', 'Relay', 'test-data');
    const result = await validateDataPath(userDataPath);
    expect(result.success).toBe(true);

    // Clean up
    if (fs.existsSync(userDataPath)) {
      fs.rmSync(userDataPath, { recursive: true, force: true });
    }
  });
});
