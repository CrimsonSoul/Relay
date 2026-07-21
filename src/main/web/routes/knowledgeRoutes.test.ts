import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WEB_RUNTIME } from '@shared/runtime';
import { WebRequestSecurity } from '../WebRequestSecurity';
import { WebRouter, WEB_SESSION_COOKIE_NAME } from '../WebRouter';
import { WebSessionStore } from '../WebSessionStore';
import { registerKnowledgeRoutes } from './knowledgeRoutes';

const LOOPBACK = '127.0.0.1';

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

describe('Relay Web Knowledge routes', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections?.();
            server.close(() => resolve());
          }),
      ),
    );
  });

  async function fixture() {
    const port = await freePort();
    const origin = `http://${LOOPBACK}:${port}`;
    const sessions = new WebSessionStore();
    const session = sessions.create({
      pbUrl: `${origin}/pocketbase`,
      auth: { token: 'ordinary-token', record: null },
      publicConfig: { mode: 'server', port: 8090 },
      runtime: WEB_RUNTIME,
      refresh: async () => ({ token: 'fresh', record: null }),
    });
    const stagedBytes: Uint8Array[] = [];
    const knowledgeSession = {
      begin: vi.fn(async () => ({
        batchId: 'batch-1',
        files: [{ id: 'file-1', name: 'Runbook.pdf', size: 12 }],
      })),
      append: vi.fn(async ({ body }) => {
        for await (const bytes of body) stagedBytes.push(Uint8Array.from(bytes));
      }),
      commit: vi.fn(async () => ({ ok: true, uploads: [] }) as const),
      abort: vi.fn(async () => undefined),
      getQueue: vi.fn(async () => ({
        restartRecovery: false,
        activeBatchId: null,
        totalBytes: 0,
        acknowledgedBytes: 0,
        items: [],
      })),
      pauseBatch: vi.fn(async () => undefined),
      resumeBatch: vi.fn(async () => undefined),
      retryUpload: vi.fn(async () => undefined),
      reselectSource: vi.fn(async () => false),
      cancelUpload: vi.fn(async () => undefined),
      cancelBatch: vi.fn(async () => undefined),
    };
    const services = {
      pdf: {
        getPdf: vi.fn(
          async () =>
            ({
              ok: true,
              data: new TextEncoder().encode('%PDF-first!!').buffer,
              checksum: 'a'.repeat(64),
              source: 'server',
            }) as const,
        ),
      },
      cover: { getCover: vi.fn(async () => ({ ok: false, error: 'not-found' }) as const) },
      index: {
        getStatus: vi.fn(
          async () =>
            ({ state: 'idle', documentCount: 1, categoryCount: 1, lastIndexedAt: null }) as const,
        ),
      },
      search: {
        search: vi.fn(
          async ({ requestId }) => ({ ok: false, requestId, error: 'unavailable' }) as const,
        ),
        cancel: vi.fn(),
      },
    };
    const router = new WebRouter({
      security: new WebRequestSecurity({
        port,
        hostname: LOOPBACK,
        getInterfaceAddresses: () => [],
        connectOrigins: [],
      }),
      sessions,
      authorizeCapability: () => true,
    });
    registerKnowledgeRoutes(router, {
      services,
      getSession: () => knowledgeSession as never,
    });
    const server = createServer((request, response) => void router.handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(port, LOOPBACK, resolve));
    const headers = {
      cookie: `${WEB_SESSION_COOKIE_NAME}=${session.id}`,
      origin,
      'x-relay-csrf': session.csrfToken,
    };
    return { origin, headers, services, knowledgeSession, stagedBytes };
  }

  it('streams authenticated PDF ranges and preserves service normalization', async () => {
    const { origin, headers, services } = await fixture();
    const response = await fetch(
      `${origin}/relay-api/v1/knowledge/pdf?documentId=doc-1&checksum=${'a'.repeat(64)}`,
      { headers: { cookie: headers.cookie, range: 'bytes=0-4' } },
    );

    expect(response.status).toBe(206);
    expect(await response.text()).toBe('%PDF-');
    expect(response.headers.get('content-range')).toBe('bytes 0-4/12');
    expect(services.pdf.getPdf).toHaveBeenCalledWith({
      documentId: 'doc-1',
      checksum: 'a'.repeat(64),
    });
  });

  it('validates browser upload declarations and streams raw chunks to the session', async () => {
    const { origin, headers, knowledgeSession, stagedBytes } = await fixture();
    const begin = await fetch(`${origin}/relay-api/v1/knowledge/upload/begin`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ name: 'Runbook.pdf', size: 12 }] }),
    });
    expect(begin.status).toBe(200);

    const chunk = await fetch(
      `${origin}/relay-api/v1/knowledge/upload/chunk?fileId=file-1&offset=0`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/octet-stream' },
        body: '%PDF-first!!',
      },
    );

    expect(chunk.status).toBe(200);
    expect(knowledgeSession.append).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(stagedBytes[0])).toBe('%PDF-first!!');
  });
});
