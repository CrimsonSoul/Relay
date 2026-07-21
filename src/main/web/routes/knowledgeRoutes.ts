import { z } from 'zod';
import type {
  KnowledgeCoverRequest,
  KnowledgeCoverResult,
  KnowledgeIndexStatus,
  KnowledgePdfRequest,
  KnowledgePdfResult,
} from '@shared/knowledge';
import {
  normalizeKnowledgeSearchResponse,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResponse,
} from '@shared/knowledgeSearch';
import {
  RELAY_WEB_API_PREFIX,
  WebKnowledgeDocumentRequestSchema,
  WebKnowledgeSearchCancelSchema,
  WebKnowledgeSearchRequestSchema,
  WebKnowledgeUploadBatchSchema,
  WebKnowledgeUploadBeginSchema,
  WebKnowledgeUploadControlSchema,
} from '@shared/webApi';
import { WebKnowledgeStagingError } from '../WebKnowledgeUploadStaging';
import type { WebKnowledgeSession } from '../WebKnowledgeSession';
import type { WebRouter, WebRouteResponse } from '../WebRouter';

export type KnowledgeRouteServices = {
  pdf: { getPdf(request: KnowledgePdfRequest): Promise<KnowledgePdfResult> };
  cover: { getCover(request: KnowledgeCoverRequest): Promise<KnowledgeCoverResult> };
  index: { getStatus(): Promise<KnowledgeIndexStatus> };
  search: {
    search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse>;
    cancel(requestId: string): void;
  };
};

type KnowledgeRouteOptions = {
  services: KnowledgeRouteServices;
  getSession(sessionId: string): WebKnowledgeSession | null;
};

const uploadMutationLimit = {
  key: 'session' as const,
  limit: 240,
  windowMs: 60_000,
};

function query(requestUrl: string | undefined, origin: string): URLSearchParams | null {
  try {
    return new URL(requestUrl ?? '', origin).searchParams;
  } catch {
    return null;
  }
}

function binaryResponse(
  bytes: Uint8Array,
  contentType: string,
  requestRange?: string,
  metadata: Readonly<Record<string, string>> = {},
): WebRouteResponse {
  let start = 0;
  let end = bytes.byteLength - 1;
  let status = 200;
  if (requestRange) {
    const match = /^bytes=(\d+)-(\d*)$/u.exec(requestRange);
    const parsedStart = match ? Number(match[1]) : Number.NaN;
    const parsedEnd = match?.[2] ? Number(match[2]) : bytes.byteLength - 1;
    if (
      !match ||
      !Number.isSafeInteger(parsedStart) ||
      !Number.isSafeInteger(parsedEnd) ||
      parsedStart < 0 ||
      parsedStart > parsedEnd ||
      parsedEnd >= bytes.byteLength
    ) {
      return {
        status: 416,
        headers: { 'Content-Range': `bytes */${bytes.byteLength}` },
        body: { ok: false, error: 'invalid-request' },
      };
    }
    start = parsedStart;
    end = parsedEnd;
    status = 206;
  }
  const selected = bytes.subarray(start, end + 1);
  return {
    status,
    headers: {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Type': contentType,
      'Content-Length': String(selected.byteLength),
      ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}` } : {}),
      ...metadata,
    },
    stream: (response) => response.end(selected),
  };
}

function stagingFailure(error: unknown): WebRouteResponse {
  if (!(error instanceof WebKnowledgeStagingError)) {
    return { status: 500, body: { ok: false, error: 'upload-failed' } };
  }
  return {
    status: error.code === 'conflict' ? 409 : 400,
    body: { ok: false, error: error.code },
  };
}

function uploadSession(
  options: KnowledgeRouteOptions,
  sessionId: string | null,
): WebKnowledgeSession | null {
  return sessionId ? options.getSession(sessionId) : null;
}

export function registerKnowledgeRoutes(router: WebRouter, options: KnowledgeRouteOptions): void {
  router.register({
    method: 'GET',
    path: `${RELAY_WEB_API_PREFIX}/knowledge/pdf`,
    authenticated: true,
    rateLimit: { bucket: 'knowledge-pdf', key: 'session', limit: 120, windowMs: 60_000 },
    handler: async ({ request, origin }) => {
      const parameters = query(request.url, origin);
      const parsed = WebKnowledgeDocumentRequestSchema.safeParse({
        documentId: parameters?.get('documentId'),
        checksum: parameters?.get('checksum'),
      });
      if (!parsed.success) return { status: 400, body: { ok: false, error: 'invalid-document' } };
      const result = await options.services.pdf.getPdf(parsed.data);
      if (!result.ok) return { status: 404, body: result };
      return binaryResponse(
        new Uint8Array(result.data),
        'application/pdf',
        typeof request.headers.range === 'string' ? request.headers.range : undefined,
        { 'X-Relay-Checksum': result.checksum, 'X-Relay-Source': result.source },
      );
    },
  });

  router.register({
    method: 'GET',
    path: `${RELAY_WEB_API_PREFIX}/knowledge/cover`,
    authenticated: true,
    rateLimit: { bucket: 'knowledge-cover', key: 'session', limit: 120, windowMs: 60_000 },
    handler: async ({ request, origin }) => {
      const parameters = query(request.url, origin);
      const parsed = WebKnowledgeDocumentRequestSchema.safeParse({
        documentId: parameters?.get('documentId'),
        checksum: parameters?.get('checksum'),
      });
      if (!parsed.success) return { status: 400, body: { ok: false, error: 'invalid-document' } };
      const result = await options.services.cover.getCover(parsed.data);
      if (!result.ok) return { status: 404, body: result };
      return binaryResponse(new Uint8Array(result.data), 'image/png', undefined, {
        'X-Relay-Checksum': result.checksum,
        'X-Relay-Source': result.source,
      });
    },
  });

  router.register({
    method: 'GET',
    path: `${RELAY_WEB_API_PREFIX}/knowledge/index-status`,
    authenticated: true,
    handler: async () => ({ status: 200, body: await options.services.index.getStatus() }),
  });

  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/knowledge/search`,
    authenticated: true,
    csrf: true,
    bodySchema: WebKnowledgeSearchRequestSchema,
    maxBodyBytes: 8_192,
    rateLimit: { bucket: 'knowledge-search', key: 'session', limit: 120, windowMs: 60_000 },
    handler: async ({ body }) => ({
      status: 200,
      body:
        normalizeKnowledgeSearchResponse(await options.services.search.search(body)) ??
        ({ ok: false, requestId: body.requestId, error: 'unavailable' } as const),
    }),
  });

  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/knowledge/search/cancel`,
    authenticated: true,
    csrf: true,
    bodySchema: WebKnowledgeSearchCancelSchema,
    maxBodyBytes: 1_024,
    rateLimit: { bucket: 'knowledge-search-cancel', key: 'session', limit: 120, windowMs: 60_000 },
    handler: async ({ body }) => {
      options.services.search.cancel(body.requestId);
      return { status: 200, body: { ok: true } };
    },
  });

  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/knowledge/upload/begin`,
    authenticated: true,
    csrf: true,
    capability: 'knowledge.manage',
    bodySchema: WebKnowledgeUploadBeginSchema,
    maxBodyBytes: 32_768,
    rateLimit: { bucket: 'knowledge-upload-begin', key: 'session', limit: 10, windowMs: 60_000 },
    handler: async ({ body, sessionId }) => {
      try {
        const session = uploadSession(options, sessionId);
        return session
          ? { status: 200, body: await session.begin(body.files) }
          : { status: 403, body: { ok: false, error: 'unauthorized' } };
      } catch (error) {
        return stagingFailure(error);
      }
    },
  });

  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/knowledge/upload/chunk`,
    authenticated: true,
    csrf: true,
    capability: 'knowledge.manage',
    rateLimit: { bucket: 'knowledge-upload-chunk', ...uploadMutationLimit },
    handler: async ({ request, origin, sessionId }) => {
      const parameters = query(request.url, origin);
      const parsed = z
        .object({
          fileId: z.string().min(1).max(128),
          offset: z.coerce.number().int().nonnegative(),
        })
        .strict()
        .safeParse({ fileId: parameters?.get('fileId'), offset: parameters?.get('offset') });
      const session = uploadSession(options, sessionId);
      if (!parsed.success || !session) {
        request.resume();
        return { status: 400, body: { ok: false, error: 'invalid-request' } };
      }
      try {
        const declared = Number(request.headers['content-length']);
        await session.append({
          fileId: parsed.data.fileId,
          offset: parsed.data.offset,
          contentType: request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase(),
          contentLength: Number.isSafeInteger(declared) ? declared : undefined,
          body: request as AsyncIterable<Uint8Array>,
        });
        return { status: 200, body: { ok: true } };
      } catch (error) {
        return stagingFailure(error);
      }
    },
  });

  for (const [action, schema, invoke] of [
    [
      'commit',
      WebKnowledgeUploadBatchSchema,
      (session: WebKnowledgeSession, id: string) => session.commit(id),
    ],
    [
      'abort',
      WebKnowledgeUploadBatchSchema,
      async (session: WebKnowledgeSession, id: string) => {
        await session.abort(id);
        return { ok: true };
      },
    ],
  ] as const) {
    router.register({
      method: 'POST',
      path: `${RELAY_WEB_API_PREFIX}/knowledge/upload/${action}`,
      authenticated: true,
      csrf: true,
      capability: 'knowledge.manage',
      bodySchema: schema,
      maxBodyBytes: 1_024,
      rateLimit: {
        bucket: `knowledge-upload-${action}`,
        key: 'session',
        limit: 30,
        windowMs: 60_000,
      },
      handler: async ({ body, sessionId }) => {
        try {
          const session = uploadSession(options, sessionId);
          return session
            ? { status: 200, body: await invoke(session, body.batchId) }
            : { status: 403, body: { ok: false, error: 'unauthorized' } };
        } catch (error) {
          return stagingFailure(error);
        }
      },
    });
  }

  router.register({
    method: 'GET',
    path: `${RELAY_WEB_API_PREFIX}/knowledge/upload/queue`,
    authenticated: true,
    capability: 'knowledge.manage',
    handler: async ({ sessionId }) => {
      const session = uploadSession(options, sessionId);
      return session
        ? { status: 200, body: await session.getQueue() }
        : { status: 403, body: { ok: false, error: 'unauthorized' } };
    },
  });

  for (const [action, invoke] of [
    ['pause-batch', (session: WebKnowledgeSession, id: string) => session.pauseBatch(id)],
    ['resume-batch', (session: WebKnowledgeSession, id: string) => session.resumeBatch(id)],
    ['retry-upload', (session: WebKnowledgeSession, id: string) => session.retryUpload(id)],
    ['reselect-source', (session: WebKnowledgeSession, id: string) => session.reselectSource(id)],
    ['cancel-upload', (session: WebKnowledgeSession, id: string) => session.cancelUpload(id)],
    ['cancel-batch', (session: WebKnowledgeSession, id: string) => session.cancelBatch(id)],
  ] as const) {
    router.register({
      method: 'POST',
      path: `${RELAY_WEB_API_PREFIX}/knowledge/upload/${action}`,
      authenticated: true,
      csrf: true,
      capability: 'knowledge.manage',
      bodySchema: WebKnowledgeUploadControlSchema,
      maxBodyBytes: 1_024,
      rateLimit: {
        bucket: `knowledge-upload-${action}`,
        key: 'session',
        limit: 60,
        windowMs: 60_000,
      },
      handler: async ({ body, sessionId }) => {
        const session = uploadSession(options, sessionId);
        if (!session) return { status: 403, body: false };
        const result = await invoke(session, body.id);
        return { status: 200, body: typeof result === 'boolean' ? result : true };
      },
    });
  }
}
