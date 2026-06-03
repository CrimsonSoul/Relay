import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

describe('download-pocketbase script', () => {
  it('downloads the checksum file from the PocketBase release asset name', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'relay-pb-download-'));
    try {
      const zipPath = join(tmp, 'pb.zip');
      await writeFile(zipPath, 'fake zip');
      const scriptUrl = pathToFileURL(resolve('scripts/download-pocketbase.mjs')).href;
      const mod = await import(scriptUrl);
      let checksumUrl = '';

      await expect(
        mod.verifyChecksum(zipPath, 'pocketbase_0.25.9_windows_amd64.zip', async (url) => {
          checksumUrl = url;
          throw new Error('stop after url capture');
        }),
      ).rejects.toThrow(/checksums file not available/i);

      expect(checksumUrl).toBe(
        'https://github.com/pocketbase/pocketbase/releases/download/v0.25.9/checksums.txt',
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

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

  it('does not skip verification when a PocketBase binary already exists', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'relay-pb-existing-'));
    const scriptUrl = pathToFileURL(resolve('scripts/download-pocketbase.mjs')).href;
    const mod = await import(scriptUrl);
    const calls: string[] = [];

    try {
      await mod.downloadPocketBase({
        platform: 'linux',
        arch: 'x64',
        resourcesDir: tmp,
        exists: () => true,
        mkdir: () => calls.push('mkdir'),
        download: async () => calls.push('download'),
        verify: async () => calls.push('verify'),
        extract: () => calls.push('extract'),
        chmod: () => calls.push('chmod'),
        remove: () => calls.push('remove'),
        log: vi.fn(),
      });

      expect(calls).toContain('download');
      expect(calls).toContain('verify');
      expect(calls).toContain('extract');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
