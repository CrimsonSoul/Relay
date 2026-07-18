import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeCoverService } from './KnowledgeCoverService';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHECKSUMS = ['a', 'b', 'c'].map((value) => value.repeat(64));
const roots: string[] = [];

async function dataRoot() {
  const root = await mkdtemp(join(tmpdir(), 'relay-cover-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('KnowledgeCoverService', () => {
  it('generates a missing cover once and then serves the checksum-addressed cache', async () => {
    const renderCover = vi.fn(async () => PNG);
    const getPdf = vi.fn(async () => ({
      ok: true as const,
      data: new Uint8Array([1, 2, 3]).buffer,
      checksum: CHECKSUMS[0]!,
      source: 'server' as const,
    }));
    const service = new KnowledgeCoverService({
      configDataDir: await dataRoot(),
      getConfig: () => ({ mode: 'server', secret: 'secret' }) as never,
      getPbClient: () => null,
      getPdfService: () => ({ getPdf }) as never,
      renderCover,
    });

    await expect(
      service.getCover({ documentId: 'document1', checksum: CHECKSUMS[0]! }),
    ).resolves.toMatchObject({ ok: true, source: 'generated' });
    await expect(
      service.getCover({ documentId: 'document1', checksum: CHECKSUMS[0]! }),
    ).resolves.toMatchObject({ ok: true, source: 'cache' });
    expect(renderCover).toHaveBeenCalledOnce();
    expect(getPdf).toHaveBeenCalledOnce();
  });

  it('deduplicates matching requests and runs at most two cover jobs concurrently', async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const renderCover = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          active += 1;
          maximum = Math.max(maximum, active);
          releases.push(() => {
            active -= 1;
            resolve(PNG);
          });
        }),
    );
    const service = new KnowledgeCoverService({
      configDataDir: await dataRoot(),
      getConfig: () => ({ mode: 'server', secret: 'secret' }) as never,
      getPbClient: () => null,
      getPdfService: () =>
        ({
          getPdf: vi.fn(async ({ checksum }) => ({
            ok: true as const,
            data: new Uint8Array([1]).buffer,
            checksum,
            source: 'server' as const,
          })),
        }) as never,
      renderCover,
    });

    const requests = CHECKSUMS.map((checksum, index) =>
      service.getCover({ documentId: `document${index}`, checksum }),
    );
    const duplicate = service.getCover({ documentId: 'document0', checksum: CHECKSUMS[0]! });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());

    await expect(Promise.all([...requests, duplicate])).resolves.toHaveLength(4);
    expect(maximum).toBe(2);
    expect(renderCover).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed requests before touching storage or network', async () => {
    const getPdf = vi.fn();
    const service = new KnowledgeCoverService({
      configDataDir: await dataRoot(),
      getConfig: () => ({ mode: 'server', secret: 'secret' }) as never,
      getPbClient: () => null,
      getPdfService: () => ({ getPdf }) as never,
    });

    await expect(
      service.getCover({ documentId: '../escape', checksum: CHECKSUMS[0]! }),
    ).resolves.toEqual({ ok: false, error: 'invalid-document' });
    expect(getPdf).not.toHaveBeenCalled();
  });
});
