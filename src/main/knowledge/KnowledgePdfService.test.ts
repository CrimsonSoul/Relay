import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { RELAY_APP_USER_EMAIL } from '@shared/ipc';
import { KNOWLEDGE_MAX_PDF_BYTES } from '@shared/knowledge';
import { KnowledgePdfService } from './KnowledgePdfService';

const roots: string[] = [];
const pdf = Buffer.from('%PDF-1.4\nknowledge document\n%%EOF');
const pdfChecksum = createHash('sha256').update(pdf).digest('hex');
const relayUrl = ['http', '://relay.local'].join('');

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'relay-knowledge-cache-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('KnowledgePdfService', () => {
  const authWithPassword = vi.fn(async () => ({}));
  const getOne = vi.fn();
  const getToken = vi.fn(async () => 'protected-file-token');
  const getURL = vi.fn(() => `${relayUrl}/api/files/knowledge/document123/runbook.pdf`);
  const healthCheck = vi.fn(async () => ({ code: 200 }));
  const authStore = { isValid: false };
  const pb = {
    authStore,
    collection: vi.fn((name: string) =>
      name === '_pb_users_auth_' ? { authWithPassword } : { getOne },
    ),
    files: { getToken, getURL },
    health: { check: healthCheck },
  };
  const createClient = vi.fn(() => pb as never);
  const fetchPdf = vi.fn(async () => new Response(pdf, { status: 200 }));
  let configDataDir: string;

  function rawRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'document123',
      collectionId: 'knowledgeCollection',
      collectionName: 'knowledge_documents',
      sourceKey: 'Monitoring/Runbook.pdf',
      category: 'Monitoring',
      title: 'Runbook',
      fileName: 'Runbook.pdf',
      pdf: 'runbook.pdf',
      checksum: pdfChecksum,
      byteSize: pdf.byteLength,
      pageCount: 1,
      outline: [],
      outlineSource: 'none',
      sourceModifiedAt: '2026-07-14T12:00:00.000Z',
      indexedAt: '2026-07-14T12:01:00.000Z',
      created: '2026-07-14T12:01:00.000Z',
      updated: '2026-07-14T12:01:00.000Z',
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    authStore.isValid = false;
    configDataDir = await temporaryRoot();
    getOne.mockResolvedValue(rawRecord());
  });

  it('reads server PDFs only from the protected PocketBase file', async () => {
    const resolveServerSource = vi.fn(async () => {
      throw new Error('server folders must not be consulted');
    });
    const options = {
      configDataDir,
      getConfig: () =>
        ({ mode: 'server', port: 8090, bindHost: '0.0.0.0', secret: 'secret' }) as const,
      getPbClient: () => pb as never,
      resolveServerSource,
      createClient,
      fetch: fetchPdf,
    };
    const service = new KnowledgePdfService(options);

    const result = await service.getPdf({ documentId: 'document123', checksum: pdfChecksum });

    expect(result).toMatchObject({ ok: true, checksum: pdfChecksum, source: 'download' });
    expect(Buffer.from(result.ok ? result.data : new ArrayBuffer(0))).toEqual(pdf);
    expect(resolveServerSource).not.toHaveBeenCalled();
    expect(getToken).toHaveBeenCalledWith({ requestKey: null });
    expect(fetchPdf).toHaveBeenCalledOnce();
  });

  it('reuses a matching client cache entry without authenticating', async () => {
    const cacheDir = join(configDataDir, 'knowledge-cache');
    await mkdir(cacheDir);
    await writeFile(join(cacheDir, `${pdfChecksum}.pdf`), pdf);
    const service = new KnowledgePdfService({
      configDataDir,
      getConfig: () => ({
        mode: 'client',
        serverUrl: relayUrl,
        allowInsecureHttp: true,
        secret: 'secret',
      }),
      getPbClient: () => null,
      createClient,
      fetch: fetchPdf,
    });

    const result = await service.getPdf({ documentId: 'document123', checksum: pdfChecksum });

    expect(result).toMatchObject({ ok: true, source: 'cache' });
    expect(createClient).not.toHaveBeenCalled();
    expect(authWithPassword).not.toHaveBeenCalled();
  });

  it('authenticates, downloads, verifies, and atomically caches a protected client PDF', async () => {
    const service = new KnowledgePdfService({
      configDataDir,
      getConfig: () => ({
        mode: 'client',
        serverUrl: relayUrl,
        allowInsecureHttp: true,
        secret: 'server-secret',
      }),
      getPbClient: () => null,
      createClient,
      fetch: fetchPdf,
    });

    const result = await service.getPdf({ documentId: 'document123', checksum: pdfChecksum });

    expect(result).toMatchObject({ ok: true, source: 'download' });
    expect(authWithPassword).toHaveBeenCalledWith(RELAY_APP_USER_EMAIL, 'server-secret', {
      requestKey: null,
    });
    expect(getToken).toHaveBeenCalledWith({ requestKey: null });
    expect(fetchPdf).toHaveBeenCalledWith(
      expect.stringContaining(`${relayUrl}/`),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchPdf.mock.calls[0]?.[1]).not.toHaveProperty('headers');
    await expect(
      readFile(join(configDataDir, 'knowledge-cache', `${pdfChecksum}.pdf`)),
    ).resolves.toEqual(pdf);
  });

  it('deletes a bad download and retries once before promotion', async () => {
    fetchPdf
      .mockResolvedValueOnce(new Response(Buffer.from('%PDF-1.4 bad'), { status: 200 }))
      .mockResolvedValueOnce(new Response(pdf, { status: 200 }));
    const service = new KnowledgePdfService({
      configDataDir,
      getConfig: () => ({
        mode: 'client',
        serverUrl: relayUrl,
        allowInsecureHttp: true,
        secret: 'secret',
      }),
      getPbClient: () => null,
      createClient,
      fetch: fetchPdf,
    });

    const result = await service.getPdf({ documentId: 'document123', checksum: pdfChecksum });

    expect(result).toMatchObject({ ok: true, source: 'download' });
    expect(fetchPdf).toHaveBeenCalledTimes(2);
  });

  it('rejects an oversized response before buffering its body', async () => {
    const response = new Response(pdf, {
      status: 200,
      headers: { 'content-length': String(KNOWLEDGE_MAX_PDF_BYTES + 1) },
    });
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
    fetchPdf.mockResolvedValue(response);
    const service = new KnowledgePdfService({
      configDataDir,
      getConfig: () => ({
        mode: 'client',
        serverUrl: relayUrl,
        allowInsecureHttp: true,
        secret: 'secret',
      }),
      getPbClient: () => null,
      createClient,
      fetch: fetchPdf,
    });

    await expect(
      service.getPdf({ documentId: 'document123', checksum: pdfChecksum }),
    ).resolves.toEqual({ ok: false, error: 'download-failed' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('returns not-available-offline without attempting auth for an uncached client PDF', async () => {
    healthCheck.mockRejectedValueOnce(Object.assign(new Error('Relay unavailable'), { status: 0 }));
    const service = new KnowledgePdfService({
      configDataDir,
      getConfig: () => ({
        mode: 'client',
        serverUrl: relayUrl,
        allowInsecureHttp: true,
        secret: 'secret',
      }),
      getPbClient: () => null,
      createClient,
      fetch: fetchPdf,
    });

    await expect(
      service.getPdf({ documentId: 'document123', checksum: pdfChecksum }),
    ).resolves.toEqual({ ok: false, error: 'not-available-offline' });
    expect(createClient).toHaveBeenCalledOnce();
    expect(healthCheck).toHaveBeenCalledWith({ requestKey: null });
    expect(authWithPassword).not.toHaveBeenCalled();
  });

  it('removes old orphans and evicts least-recently-used files without deleting active content', async () => {
    const cacheDir = join(configDataDir, 'knowledge-cache');
    await mkdir(cacheDir);
    const active = 'a'.repeat(64);
    const referenced = 'b'.repeat(64);
    const orphan = 'c'.repeat(64);
    await Promise.all([
      writeFile(join(cacheDir, `${active}.pdf`), Buffer.alloc(10)),
      writeFile(join(cacheDir, `${referenced}.pdf`), Buffer.alloc(10)),
      writeFile(join(cacheDir, `${orphan}.pdf`), Buffer.alloc(10)),
    ]);
    await utimes(join(cacheDir, `${referenced}.pdf`), new Date(1_000), new Date(1_000));
    await utimes(join(cacheDir, `${orphan}.pdf`), new Date(500), new Date(500));
    const service = new KnowledgePdfService({
      configDataDir,
      getConfig: () => null,
      getPbClient: () => null,
      createClient,
      fetch: fetchPdf,
      cacheBudgetBytes: 15,
      orphanMaxAgeMs: 1_000,
      now: () => 10_000,
    });
    service.setActiveChecksum(active);

    await service.cleanup(new Set([active, referenced]));

    await expect(access(join(cacheDir, `${active}.pdf`))).resolves.toBeUndefined();
    await expect(access(join(cacheDir, `${referenced}.pdf`))).rejects.toThrow();
    await expect(access(join(cacheDir, `${orphan}.pdf`))).rejects.toThrow();
  });
});
