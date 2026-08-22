import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeCoverService } from './KnowledgeCoverService';
import {
  clearRelayAppUserAuthCoordinator,
  primeRelayAppUserAuth,
} from '../pocketbase/RelayAppUserAuthCoordinator';

const coordinatorMocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  clear: vi.fn(),
  prime: vi.fn(),
}));

vi.mock('../pocketbase/RelayAppUserAuthCoordinator', () => ({
  authenticateRelayAppUserShared: coordinatorMocks.authenticate,
  clearRelayAppUserAuthCoordinator: coordinatorMocks.clear,
  primeRelayAppUserAuth: coordinatorMocks.prime,
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHECKSUMS = ['a', 'b', 'c'].map((value) => value.repeat(64));
const roots: string[] = [];

async function dataRoot() {
  const root = await mkdtemp(join(tmpdir(), 'relay-cover-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  clearRelayAppUserAuthCoordinator();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('KnowledgeCoverService', () => {
  it('serves a cached cover without loading the native renderer', async () => {
    const root = await dataRoot();
    const cacheDir = join(root, 'knowledge-cover-cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${CHECKSUMS[0]}.png`), PNG);
    const loadCoverRenderer = vi.fn();
    const service = new KnowledgeCoverService({
      configDataDir: root,
      getConfig: () => null,
      getPbClient: () => null,
      getPdfService: () => null,
      loadCoverRenderer,
    });

    await expect(
      service.getCover({ documentId: 'document1', checksum: CHECKSUMS[0]! }),
    ).resolves.toMatchObject({ ok: true, source: 'cache' });
    expect(loadCoverRenderer).not.toHaveBeenCalled();
  });

  it('loads the native renderer once across generated covers', async () => {
    const renderKnowledgeCover = vi.fn(async () => PNG);
    const loadCoverRenderer = vi.fn(async () => ({ renderKnowledgeCover }));
    const service = new KnowledgeCoverService({
      configDataDir: await dataRoot(),
      getConfig: () => ({ mode: 'server', secret: 'secret' }) as never,
      getPbClient: () => null,
      getPdfService: () =>
        ({
          getPdf: vi.fn(async ({ checksum }) => ({
            ok: true as const,
            data: new Uint8Array([1, 2, 3]).buffer,
            checksum,
            source: 'server' as const,
          })),
        }) as never,
      loadCoverRenderer,
    });

    await service.getCover({ documentId: 'document1', checksum: CHECKSUMS[0]! });
    await service.getCover({ documentId: 'document2', checksum: CHECKSUMS[1]! });

    expect(loadCoverRenderer).toHaveBeenCalledOnce();
    expect(renderKnowledgeCover).toHaveBeenCalledTimes(2);
  });

  it('hydrates its client from the shared startup authentication window', async () => {
    const relayUrl = ['http', '://relay.local'].join('');
    const checksum = CHECKSUMS[0]!;
    const record = {
      id: 'document1',
      collectionId: 'knowledgeCollection',
      collectionName: 'knowledge_documents',
      sourceKey: 'operations/document.pdf',
      category: 'Operations',
      title: 'Document',
      fileName: 'document.pdf',
      pdf: 'document.pdf',
      cover: 'document.png',
      checksum,
      byteSize: 1,
      pageCount: 1,
      outline: [],
      outlineSource: 'none',
      sourceModifiedAt: '2026-07-18T12:00:00.000Z',
      indexedAt: '2026-07-18T12:00:00.000Z',
      created: '2026-07-18T12:00:00.000Z',
      updated: '2026-07-18T12:00:00.000Z',
    };
    const authStore = {
      token: '',
      record: null as Record<string, unknown> | null,
      get isValid() {
        return Boolean(this.token);
      },
      save(token: string, authRecord?: Record<string, unknown> | null) {
        this.token = token;
        this.record = authRecord ?? null;
      },
      clear() {
        this.token = '';
        this.record = null;
      },
    };
    const authWithPassword = vi.fn(async () => {
      authStore.save('valid-token-cover', {
        id: 'relay-user',
        email: 'relay@relay.app',
        collectionId: '_pb_users_auth_',
        collectionName: 'users',
      });
      return {};
    });
    const pb = {
      authStore,
      health: { check: vi.fn(async () => ({ code: 200 })) },
      collection: vi.fn((name: string) =>
        name === '_pb_users_auth_' ? { authWithPassword } : { getOne: vi.fn(async () => record) },
      ),
      files: {
        getToken: vi.fn(async () => 'file-token'),
        getURL: vi.fn(() => `${relayUrl}/api/files/cover`),
      },
    };
    coordinatorMocks.authenticate.mockImplementationOnce(async (client: typeof pb) => {
      client.authStore.save('valid-token-bootstrap', {
        id: 'relay-user',
        email: 'relay@relay.app',
        collectionId: '_pb_users_auth_',
        collectionName: 'users',
      });
    });
    primeRelayAppUserAuth(
      {
        authStore: {
          token: 'valid-token-bootstrap',
          record: {
            id: 'relay-user',
            email: 'relay@relay.app',
            collectionId: '_pb_users_auth_',
            collectionName: 'users',
          },
          isValid: true,
          save: vi.fn(),
          clear: vi.fn(),
        },
      } as never,
      relayUrl,
      'server-secret',
    );
    const service = new KnowledgeCoverService({
      configDataDir: await dataRoot(),
      getConfig: () => ({
        mode: 'client',
        serverUrl: relayUrl,
        allowInsecureHttp: true,
        secret: 'server-secret',
      }),
      getPbClient: () => null,
      getPdfService: () => null,
      createClient: () => pb as never,
      fetch: vi.fn(async () => new Response(PNG, { status: 200 })),
    });

    await expect(service.getCover({ documentId: 'document1', checksum })).resolves.toMatchObject({
      ok: true,
      source: 'download',
    });
    expect(authWithPassword).not.toHaveBeenCalled();
    expect(authStore.isValid).toBe(true);
  });

  it('cancels a cover download as soon as a response exceeds the hard byte limit', async () => {
    const checksum = CHECKSUMS[0]!;
    let pulls = 0;
    let cancelled = false;
    const first = new Uint8Array(2 * 1024 * 1024);
    first.set(PNG);
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(first);
          else if (pulls === 2) controller.enqueue(new Uint8Array([1]));
          else if (pulls <= 10) {
            controller.enqueue(new Uint8Array([2]));
          } else {
            controller.close();
          }
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 200 },
    );
    const record = {
      id: 'document1',
      sourceKey: 'operations/document.pdf',
      category: 'Operations',
      title: 'Document',
      fileName: 'document.pdf',
      pdf: 'document.pdf',
      cover: 'document.png',
      checksum,
      byteSize: 1,
      pageCount: 1,
      outline: [],
      outlineSource: 'none',
      sourceModifiedAt: '2026-07-18T12:00:00.000Z',
      indexedAt: '2026-07-18T12:00:00.000Z',
      created: '2026-07-18T12:00:00.000Z',
      updated: '2026-07-18T12:00:00.000Z',
    };
    const pb = {
      collection: () => ({ getOne: vi.fn(async () => record) }),
      files: {
        getToken: vi.fn(async () => 'token'),
        getURL: vi.fn(() => 'https://relay.local/api/files/cover'),
      },
    };
    const service = new KnowledgeCoverService({
      configDataDir: await dataRoot(),
      getConfig: () => ({ mode: 'server', secret: 'secret' }) as never,
      getPbClient: () => pb as never,
      getPdfService: () => ({ getPdf: vi.fn(async () => ({ ok: false })) }) as never,
      fetch: vi.fn(async () => response),
    });

    await expect(service.getCover({ documentId: 'document1', checksum })).resolves.toMatchObject({
      ok: false,
    });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(3);
  });

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
