import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_UPLOAD_CHUNK_BYTES,
  KNOWLEDGE_UPLOAD_MAX_FILES,
  type KnowledgePdfResult,
} from '@shared/knowledge';
import { WEB_RUNTIME } from '@shared/runtime';
import { WebRequestSecurity } from '../WebRequestSecurity';
import {
  WebRouter,
  WEB_SESSION_COOKIE_NAME,
  type WebRoute,
  type WebRouteContext,
  type WebRouteResponse,
} from '../WebRouter';
import { WebSessionStore, type WebSessionRecord } from '../WebSessionStore';
import {
  MAX_ACCOUNTED_PDF_BUFFER_BYTES,
  MAX_CONCURRENT_PDF_READS_GLOBAL,
  PDF_FULL_SIZE_BUFFER_COPIES_PER_READ,
  registerKnowledgeRoutes,
  type KnowledgeRouteServices,
} from './knowledgeRoutes';

const LOOPBACK = '127.0.0.1';

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

function knowledgePdfUrl(origin: string): string {
  return `${origin}/relay-api/v1/knowledge/pdf?documentId=doc-1&checksum=${'a'.repeat(64)}`;
}

function knowledgeRoute(router: WebRouter, suffix: string): WebRoute {
  const route = (
    router as unknown as {
      routes: WebRoute[];
    }
  ).routes.find((candidate) => candidate.path.endsWith(suffix));
  if (!route) throw new Error(`Expected Knowledge route ${suffix}`);
  return route;
}

function knowledgePdfRoute(router: WebRouter): WebRoute {
  return knowledgeRoute(router, '/knowledge/pdf');
}

function pdfRouteContext(
  origin: string,
  session: WebSessionRecord,
  range = 'bytes=0-0',
): WebRouteContext {
  return {
    request: {
      url: knowledgePdfUrl(origin).slice(origin.length),
      headers: { range },
    } as unknown as IncomingMessage,
    body: undefined,
    session,
    sessionId: session.id,
    remoteAddress: LOOPBACK,
    origin,
  };
}

function pendingResponse(): ServerResponse {
  return Object.assign(new EventEmitter(), {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn(),
  }) as unknown as ServerResponse;
}

function sendRouteResponse(
  router: WebRouter,
  response: ServerResponse,
  result: WebRouteResponse,
): void {
  (
    router as unknown as {
      send(response: ServerResponse, result: WebRouteResponse): void;
    }
  ).send(response, result);
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

  async function fixture(
    getPdf: KnowledgeRouteServices['pdf']['getPdf'] = async () =>
      ({
        ok: true,
        data: new TextEncoder().encode('%PDF-first!!').buffer,
        checksum: 'a'.repeat(64),
        source: 'server',
      }) as const,
  ) {
    const port = await freePort();
    const origin = `http://${LOOPBACK}:${port}`;
    const sessions = new WebSessionStore();
    const createSession = () =>
      sessions.create({
        pbUrl: `${origin}/pocketbase`,
        auth: { token: 'ordinary-token', record: null },
        publicConfig: { mode: 'server', port: 8090 },
        runtime: WEB_RUNTIME,
        refresh: async () => ({ token: 'fresh', record: null }),
      });
    const session = createSession();
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
        getPdf: vi.fn(getPdf),
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
    const sessionHeaders = (value: WebSessionRecord) => ({
      cookie: `${WEB_SESSION_COOKIE_NAME}=${value.id}`,
      origin,
      'x-relay-csrf': value.csrfToken,
    });
    const headers = sessionHeaders(session);
    return {
      origin,
      headers,
      services,
      knowledgeSession,
      stagedBytes,
      router,
      session,
      createSessionHeaders: () => sessionHeaders(createSession()),
    };
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

  it('rejects malformed PDF ranges before fetching the protected file', async () => {
    const { origin, headers, services } = await fixture();

    const response = await fetch(
      `${origin}/relay-api/v1/knowledge/pdf?documentId=doc-1&checksum=${'a'.repeat(64)}`,
      { headers: { cookie: headers.cookie, range: 'bytes=not-a-range' } },
    );

    expect(response.status).toBe(416);
    expect(services.pdf.getPdf).not.toHaveBeenCalled();
  });

  it('bounds concurrent PDF materialization and releases capacity after responses finish', async () => {
    let callCount = 0;
    let releaseFetches!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetches = resolve;
    });
    const getPdf = vi.fn(async () => {
      callCount += 1;
      if (callCount <= 2) await fetchGate;
      return {
        ok: true,
        data: new TextEncoder().encode('%PDF-first!!').buffer,
        checksum: 'a'.repeat(64),
        source: 'server',
      } as const;
    });
    const { origin, headers } = await fixture(getPdf);
    const url = `${origin}/relay-api/v1/knowledge/pdf?documentId=doc-1&checksum=${'a'.repeat(64)}`;
    const request = () => fetch(url, { headers: { cookie: headers.cookie, range: 'bytes=0-0' } });
    const first = request();
    const second = request();

    try {
      await vi.waitFor(() => expect(getPdf).toHaveBeenCalledTimes(2));
      const rejected = await request();
      expect(rejected.status).toBe(503);
      expect(await rejected.json()).toEqual({ ok: false, error: 'pdf-busy' });
      expect(getPdf).toHaveBeenCalledTimes(2);

      releaseFetches();
      const completed = await Promise.all([first, second]);
      expect(completed.map((response) => response.status)).toEqual([206, 206]);
      await Promise.all(completed.map((response) => response.arrayBuffer()));

      const replacement = await request();
      expect(replacement.status).toBe(206);
      expect(getPdf).toHaveBeenCalledTimes(3);
    } finally {
      releaseFetches();
      await Promise.allSettled([first, second]);
    }
  });

  it('enforces the worst-case PDF work budget process-wide across independent sessions', async () => {
    let releaseFetches!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetches = resolve;
    });
    const getPdf = vi.fn(async () => {
      await fetchGate;
      return {
        ok: true,
        data: new TextEncoder().encode('%PDF-first!!').buffer,
        checksum: 'a'.repeat(64),
        source: 'server',
      } as const;
    });
    const { origin, headers, createSessionHeaders } = await fixture(getPdf);
    const secondHeaders = createSessionHeaders();
    const thirdHeaders = createSessionHeaders();
    const request = (requestHeaders: typeof headers) =>
      fetch(knowledgePdfUrl(origin), {
        headers: { cookie: requestHeaders.cookie, range: 'bytes=0-0' },
      });
    const first = request(headers);
    const second = request(secondHeaders);

    try {
      await vi.waitFor(() => expect(getPdf).toHaveBeenCalledTimes(MAX_CONCURRENT_PDF_READS_GLOBAL));
      const rejected = await request(thirdHeaders);
      expect(rejected.status).toBe(503);
      expect(getPdf).toHaveBeenCalledTimes(MAX_CONCURRENT_PDF_READS_GLOBAL);
      expect(MAX_ACCOUNTED_PDF_BUFFER_BYTES).toBe(
        MAX_CONCURRENT_PDF_READS_GLOBAL *
          PDF_FULL_SIZE_BUFFER_COPIES_PER_READ *
          KNOWLEDGE_MAX_PDF_BYTES,
      );
      expect(MAX_ACCOUNTED_PDF_BUFFER_BYTES).toBe(300 * 1024 * 1024);
    } finally {
      releaseFetches();
      await Promise.allSettled([first, second]);
    }
  });

  it('releases PDF work after upstream failure, exception, and out-of-bounds range', async () => {
    const success = (): KnowledgePdfResult => ({
      ok: true,
      data: new TextEncoder().encode('%PDF-first!!').buffer,
      checksum: 'a'.repeat(64),
      source: 'server',
    });
    const cases: {
      first: () => Promise<KnowledgePdfResult>;
      range: string;
      status: number;
    }[] = [
      {
        first: async () => ({ ok: false, error: 'not-found' }),
        range: 'bytes=0-0',
        status: 404,
      },
      {
        first: async () => {
          throw new Error('synthetic PDF failure');
        },
        range: 'bytes=0-0',
        status: 500,
      },
      {
        first: async () => success(),
        range: 'bytes=99-99',
        status: 416,
      },
    ];

    for (const scenario of cases) {
      let callCount = 0;
      let releaseFetches!: () => void;
      const fetchGate = new Promise<void>((resolve) => {
        releaseFetches = resolve;
      });
      const getPdf = vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) return scenario.first();
        await fetchGate;
        return success();
      });
      const { origin, headers } = await fixture(getPdf);
      const first = await fetch(knowledgePdfUrl(origin), {
        headers: { cookie: headers.cookie, range: scenario.range },
      });
      expect(first.status).toBe(scenario.status);

      const replacementOne = fetch(knowledgePdfUrl(origin), {
        headers: { cookie: headers.cookie, range: 'bytes=0-0' },
      });
      const replacementTwo = fetch(knowledgePdfUrl(origin), {
        headers: { cookie: headers.cookie, range: 'bytes=0-0' },
      });
      try {
        await vi.waitFor(() => expect(getPdf).toHaveBeenCalledTimes(3));
      } finally {
        releaseFetches();
      }
      const replacements = await Promise.all([replacementOne, replacementTwo]);
      expect(replacements.map((response) => response.status)).toEqual([206, 206]);
    }
  });

  it('releases PDF work exactly once when responses close or error', async () => {
    const { router, origin, session } = await fixture();
    const route = knowledgePdfRoute(router);
    const context = pdfRouteContext(origin, session);
    const first = await route.handler(context);
    const second = await route.handler(context);
    expect(first.status).toBe(206);
    expect(second.status).toBe(206);
    expect((await route.handler(context)).status).toBe(503);

    const closedResponse = pendingResponse();
    sendRouteResponse(router, closedResponse, first);
    closedResponse.emit('close');
    closedResponse.emit('close');

    const erroredResponse = pendingResponse();
    sendRouteResponse(router, erroredResponse, second);
    erroredResponse.emit('error', new Error('synthetic response error'));
    erroredResponse.emit('close');

    const replacementOne = await route.handler(context);
    const replacementTwo = await route.handler(context);
    expect(replacementOne.status).toBe(206);
    expect(replacementTwo.status).toBe(206);
    replacementOne.onComplete?.();
    replacementTwo.onComplete?.();
  });

  it('validates browser upload declarations and streams raw chunks to the session', async () => {
    const { origin, headers, knowledgeSession, stagedBytes } = await fixture();
    const begin = await fetch(`${origin}/relay-api/v1/knowledge/upload/begin`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        files: [{ name: 'Runbook.pdf', size: 12 }],
        replacementDocumentId: 'document-target',
      }),
    });
    expect(begin.status).toBe(200);
    expect(knowledgeSession.begin).toHaveBeenCalledWith(
      [{ name: 'Runbook.pdf', size: 12 }],
      'document-target',
    );

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

  it('budgets chunk uploads for a full advertised batch instead of stalling mid-transfer', async () => {
    const { router } = await fixture();
    const chunkedRequestsForMaximumBatch =
      KNOWLEDGE_UPLOAD_MAX_FILES *
      Math.ceil(KNOWLEDGE_MAX_PDF_BYTES / KNOWLEDGE_UPLOAD_CHUNK_BYTES);

    const limit = knowledgeRoute(router, '/knowledge/upload/chunk').rateLimit;

    expect(chunkedRequestsForMaximumBatch).toBe(1_300);
    expect(limit?.windowMs).toBe(60_000);
    expect(limit?.limit).toBeGreaterThanOrEqual(chunkedRequestsForMaximumBatch);
  });
});
