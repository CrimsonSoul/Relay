import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('download-pocketbase script', () => {
  it('fails closed when the checksum file cannot be downloaded', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'relay-pb-download-'));
    try {
      const zipPath = join(tmp, 'pb.zip');
      await writeFile(zipPath, 'fake zip');
      const scriptUrl = pathToFileURL(resolve('scripts/download-pocketbase.mjs')).href;
      const mod = await import(scriptUrl);

      await expect(
        mod.verifyChecksum(zipPath, 'pocketbase_0.25.9_windows_amd64.zip', async () => {
          throw new Error('checksums unavailable');
        }),
      ).rejects.toThrow(/checksums file not available/i);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
