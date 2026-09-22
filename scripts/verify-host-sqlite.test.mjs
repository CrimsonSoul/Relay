import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { clearElectronRebuildMetadata } from './verify-host-sqlite.mjs';

it('invalidates stale Electron ABI markers without changing restored native binaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-sqlite-metadata-'));
  try {
    for (const buildType of ['Release', 'Debug']) {
      const directory = join(root, 'build', buildType);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, '.forge-meta'), 'x64--145');
      await writeFile(join(directory, 'better_sqlite3.node'), 'restored host binding');
    }
    clearElectronRebuildMetadata(root);
    for (const buildType of ['Release', 'Debug']) {
      const directory = join(root, 'build', buildType);
      await expect(readFile(join(directory, '.forge-meta'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await readFile(join(directory, 'better_sqlite3.node'), 'utf8')).toBe(
        'restored host binding',
      );
    }
    expect(() => clearElectronRebuildMetadata(root)).not.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
