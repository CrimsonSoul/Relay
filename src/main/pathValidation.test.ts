import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { validateDataPath } from './pathValidation';
import fs from 'fs';
import { join } from 'path';
import os from 'os';

// Mock logger
vi.mock('./logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./logger')>();
  return {
    ...actual,
    loggers: {
      fileManager: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    }
  };
});

describe('validateDataPath', () => {
    const tmpDir = os.tmpdir();
    const testDir = join(tmpDir, 'relay-test-data');

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
         // Spy on fs.promises.writeFile to throw EACCES
         const spy = vi.spyOn(fs.promises, 'writeFile').mockImplementation(() => {
             const err: NodeJS.ErrnoException = new Error('Permission denied');
             err.code = 'EACCES';
             return Promise.reject(err);
         });

         const result = await validateDataPath(testDir);
         expect(result.success).toBe(false);
         expect(result.error).toContain('Write permission denied');

         spy.mockRestore();
    });
});
