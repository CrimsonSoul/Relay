import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { z } from 'zod';
import type { PrivilegedCapability } from '@shared/privilegedAccess';
import { RELAY_WEB_API_PREFIX } from '@shared/webApi';
import { WebRateLimiter, type WebRateLimit } from './WebRateLimiter';
import { WebRequestSecurity } from './WebRequestSecurity';
import { WebSessionStore, type WebSessionRecord } from './WebSessionStore';

export const WEB_SESSION_COOKIE_NAME = 'relay_web_session';
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type WebRouteResponse = {
  status: number;
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  stream?: (response: ServerResponse) => void;
};

export type WebRouteContext<TBody = unknown> = {
  request: IncomingMessage;
  body: TBody;
  session: WebSessionRecord | null;
  sessionId: string | null;
  remoteAddress: string;
  origin: string;
};

export type WebRoute<TBody = unknown> = {
  method: string;
  path: `${typeof RELAY_WEB_API_PREFIX}/${string}`;
  authenticated?: boolean;
  csrf?: boolean;
  capability?: PrivilegedCapability;
  bodySchema?: z.ZodType<TBody>;
  maxBodyBytes?: number;
  rateLimit?: WebRateLimit & {
    bucket: string;
    key: 'ip' | 'session';
  };
  handler: (context: WebRouteContext<TBody>) => Promise<WebRouteResponse>;
};

type WebRouterOptions = {
  security: WebRequestSecurity;
  sessions: WebSessionStore;
  limiter?: WebRateLimiter;
  authorizeCapability?: (sessionId: string, capability: PrivilegedCapability) => boolean;
};

type ResolvedWebRequest = {
  route: WebRoute;
  method: string;
  origin: string;
  remoteAddress: string | undefined;
};

type AuthorizedWebRequest = {
  sessionId: string | null;
  session: WebSessionRecord | null;
};

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header || header.length > 4096) return null;
  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) return rawValue.join('=') || null;
  }
  return null;
}

function safeEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function headerBytes(request: IncomingMessage): number {
  return request.rawHeaders.reduce((total, value) => total + Buffer.byteLength(value, 'utf8'), 0);
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 }> {
  const declaredLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    request.resume();
    return { ok: false, status: 413 };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) {
      request.resume();
      return { ok: false, status: 413 };
    }
    chunks.push(bytes);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, status: 400 };
  }
}

export class WebRouter {
  private readonly routes: WebRoute[] = [];
  private readonly limiter: WebRateLimiter;

  constructor(private readonly options: WebRouterOptions) {
    this.limiter = options.limiter ?? new WebRateLimiter();
  }

  register<TBody>(route: WebRoute<TBody>): void {
    if (
      this.routes.some(
        (candidate) => candidate.method === route.method && candidate.path === route.path,
      )
    ) {
      throw new Error(`Duplicate Relay Web route: ${route.method} ${route.path}`);
    }
    this.routes.push(route as WebRoute);
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      await this.dispatch(request, response);
    } catch {
      this.send(response, { status: 500, body: { ok: false, error: 'unavailable' } });
    }
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const resolved = this.resolveRequest(request, response);
    if (!resolved) return;
    const authorized = this.authorizeRequest(request, response, resolved);
    if (!authorized) return;
    const parsedBody = await this.parseBody(request, response, resolved.route);
    if (!parsedBody.ok) return;
    if (!this.allowRateLimit(response, resolved, authorized)) return;

    const session =
      authorized.sessionId && authorized.session
        ? this.options.sessions.get(authorized.sessionId)
        : authorized.session;
    const result = await resolved.route.handler({
      request,
      body: parsedBody.value,
      session,
      sessionId: authorized.sessionId,
      remoteAddress: resolved.remoteAddress ?? '',
      origin: resolved.origin,
    });
    this.send(response, result, resolved.method === 'HEAD');
  }

  private resolveRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): ResolvedWebRequest | null {
    if (headerBytes(request) > MAX_HEADER_BYTES) {
      this.send(response, { status: 431, body: { ok: false, error: 'invalid-request' } });
      return null;
    }
    const remoteAddress = request.socket.remoteAddress;
    const network = this.options.security.validateNetwork(remoteAddress, request.headers.host);
    if (!network.ok) {
      this.send(response, { status: 403, body: { ok: false, error: 'forbidden' } });
      return null;
    }
    const rawUrl = request.url ?? '';
    if (!rawUrl.startsWith('/') || rawUrl.length > 2048) {
      this.send(response, { status: 400, body: { ok: false, error: 'invalid-request' } });
      return null;
    }
    const url = new URL(rawUrl, network.origin);
    const method = (request.method ?? 'GET').toUpperCase();
    const route = this.routes.find(
      (candidate) => candidate.path === url.pathname && candidate.method === method,
    );
    if (!route) {
      const pathExists = this.routes.some((candidate) => candidate.path === url.pathname);
      this.send(response, {
        status: pathExists ? 405 : 404,
        body: { ok: false, error: pathExists ? 'method-not-allowed' : 'not-found' },
      });
      return null;
    }
    return { route, method, origin: network.origin, remoteAddress };
  }

  private authorizeRequest(
    request: IncomingMessage,
    response: ServerResponse,
    resolved: ResolvedWebRequest,
  ): AuthorizedWebRequest | null {
    const sessionId = cookieValue(request.headers.cookie, WEB_SESSION_COOKIE_NAME);
    const session = sessionId ? this.options.sessions.get(sessionId, { touch: false }) : null;
    if (resolved.route.authenticated && !session) {
      this.send(response, { status: 401, body: { ok: false, error: 'unauthenticated' } });
      return null;
    }
    if (
      !this.options.security.validateOrigin(
        resolved.method,
        request.headers.origin,
        resolved.origin,
        session !== null,
      )
    ) {
      this.send(response, { status: 403, body: { ok: false, error: 'forbidden' } });
      return null;
    }
    const csrfHeader = request.headers['x-relay-csrf'];
    if (
      resolved.route.csrf &&
      (!session ||
        !safeEqual(typeof csrfHeader === 'string' ? csrfHeader : undefined, session.csrfToken))
    ) {
      this.send(response, { status: 403, body: { ok: false, error: 'forbidden' } });
      return null;
    }
    if (
      resolved.route.capability &&
      (!sessionId || !this.options.authorizeCapability?.(sessionId, resolved.route.capability))
    ) {
      this.send(response, { status: 403, body: { ok: false, error: 'forbidden' } });
      return null;
    }
    return { sessionId, session };
  }

  private async parseBody(
    request: IncomingMessage,
    response: ServerResponse,
    route: WebRoute,
  ): Promise<{ ok: true; value: unknown } | { ok: false }> {
    if (route.bodySchema) {
      const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
      if (contentType !== 'application/json') {
        request.resume();
        this.send(response, { status: 415, body: { ok: false, error: 'invalid-request' } });
        return { ok: false };
      }
      const parsedBody = await readJsonBody(request, route.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
      if (!parsedBody.ok) {
        this.send(response, {
          status: parsedBody.status,
          body: { ok: false, error: 'invalid-request' },
        });
        return { ok: false };
      }
      const validated = route.bodySchema.safeParse(parsedBody.value);
      if (!validated.success) {
        this.send(response, { status: 400, body: { ok: false, error: 'invalid-request' } });
        return { ok: false };
      }
      return { ok: true, value: validated.data };
    }
    return { ok: true, value: undefined };
  }

  private allowRateLimit(
    response: ServerResponse,
    resolved: ResolvedWebRequest,
    authorized: AuthorizedWebRequest,
  ): boolean {
    const rateLimit = resolved.route.rateLimit;
    if (rateLimit) {
      const key = rateLimit.key === 'session' ? authorized.sessionId : resolved.remoteAddress;
      if (!key) {
        this.send(response, { status: 401, body: { ok: false, error: 'unauthenticated' } });
        return false;
      }
      const limit = this.limiter.consume(rateLimit.bucket, key, rateLimit);
      if (!limit.allowed) {
        this.send(response, {
          status: 429,
          headers: { 'Retry-After': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1_000))) },
          body: { ok: false, error: 'rate-limited' },
        });
        return false;
      }
    }
    return true;
  }

  private send(response: ServerResponse, result: WebRouteResponse, headOnly = false): void {
    if (response.headersSent || response.writableEnded) return;
    for (const [name, value] of Object.entries(this.options.security.responseHeaders())) {
      response.setHeader(name, value);
    }
    for (const [name, value] of Object.entries(result.headers ?? {})) {
      response.setHeader(name, value);
    }
    response.statusCode = result.status;
    if (result.stream) {
      result.stream(response);
      return;
    }
    const json = result.body === undefined ? '' : JSON.stringify(result.body);
    if (Buffer.byteLength(json, 'utf8') > MAX_RESPONSE_BYTES) {
      response.statusCode = 500;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: false, error: 'unavailable' }));
      return;
    }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Length', String(Buffer.byteLength(json, 'utf8')));
    response.end(headOnly ? undefined : json);
  }
}
