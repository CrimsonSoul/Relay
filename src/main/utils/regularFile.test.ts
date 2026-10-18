import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openRegularFile, readRegularFile } from './regularFile';

describe('regularFile', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'relay-regular-file-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function canSymlink(target: string, link: string): boolean {
    try {
      symlinkSync(target, link);
      return true;
    } catch {
      return false;
    }
  }

  it('reads a regular file within bounds', async () => {
    const path = join(root, 'a.txt');
    writeFileSync(path, 'hello');

    await expect(readRegularFile(path, { maxBytes: 5 })).resolves.toEqual(Buffer.from('hello'));
  });

  it('refuses files outside the size bounds', async () => {
    const path = join(root, 'a.txt');
    writeFileSync(path, 'hello');

    await expect(readRegularFile(path, { maxBytes: 4 })).resolves.toBeNull();
    await expect(readRegularFile(path, { maxBytes: 10, minBytes: 6 })).resolves.toBeNull();
  });

  it('refuses directories', async () => {
    const path = join(root, 'dir');
    mkdirSync(path);

    await expect(readRegularFile(path, { maxBytes: 10 })).resolves.toBeNull();
    await expect(openRegularFile(path, { rejectSymlinks: false })).resolves.toBeNull();
  });

  it('propagates a missing file', async () => {
    await expect(readRegularFile(join(root, 'missing'), { maxBytes: 10 })).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses symlinks unless allowed', async (context) => {
    const target = join(root, 'target.txt');
    const link = join(root, 'link.txt');
    writeFileSync(target, 'data');
    if (!canSymlink(target, link)) context.skip();

    await expect(readRegularFile(link, { maxBytes: 10 })).resolves.toBeNull();
    await expect(readRegularFile(link, { maxBytes: 10, rejectSymlinks: false })).resolves.toEqual(
      Buffer.from('data'),
    );
  });

  it('returns stats from the opened handle', async () => {
    const path = join(root, 'a.bin');
    writeFileSync(path, Buffer.alloc(3));

    const opened = await openRegularFile(path);
    try {
      expect(opened?.stats.size).toBe(3n);
    } finally {
      await opened?.handle.close();
    }
  });
});
