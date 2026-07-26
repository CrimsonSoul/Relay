import type { ServerResponse } from 'node:http';
import { WEB_RUNTIME } from '@shared/runtime';
import {
  RELAY_WEB_API_PREFIX,
  WebSessionLoginInputSchema,
  type WebSessionBootstrap,
} from '@shared/webApi';
import type { WebSessionCreateInput, WebSessionRecord, WebSessionStore } from '../WebSessionStore';
import { WEB_SESSION_COOKIE_NAME, type WebRouter } from '../WebRouter';
import { WebPrivilegedSession } from '../WebPrivilegedSession';
import { WebResourceBudget } from '../WebResourceBudget';

const SESSION_COOKIE_PATH = '/relay-api';
const SSE_HEARTBEAT_MS = 25_000;
export const MAX_EVENT_STREAMS_PER_SESSION = 2;
export const MAX_EVENT_STREAMS_GLOBAL = 128;

type WebSessionRouteOptions = {
  sessions: WebSessionStore;
  authenticate: (passphrase: string) => Promise<WebSessionCreateInput | null>;
};

function sessionCookie(id: string): string {
  return `${WEB_SESSION_COOKIE_NAME}=${id}; HttpOnly; SameSite=Strict; Path=${SESSION_COOKIE_PATH}`;
}

function clearedSessionCookie(): string {
  return `${WEB_SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=${SESSION_COOKIE_PATH}; Max-Age=0`;
}

function bootstrap(session: WebSessionRecord): WebSessionBootstrap {
  return {
    csrfToken: session.csrfToken,
    pbUrl: session.pbUrl,
    auth: session.auth,
    publicConfig: session.publicConfig,
    runtime: WEB_RUNTIME,
    presenceLabel: session.presenceLabel,
  };
}

export function registerWebSessionRoutes(
  router: WebRouter,
  { sessions, authenticate }: WebSessionRouteOptions,
): void {
  const eventStreams = new WebResourceBudget(
    MAX_EVENT_STREAMS_PER_SESSION,
    MAX_EVENT_STREAMS_GLOBAL,
  );
  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/session/login`,
    bodySchema: WebSessionLoginInputSchema,
    maxBodyBytes: 1024,
    rateLimit: { bucket: 'session-login', key: 'ip', limit: 5, windowMs: 60_000 },
    handler: async ({ body, request, remoteAddress, sessionId, logicalSessionId }) => {
      try {
        const authenticated = await authenticate(body.passphrase);
        if (!authenticated) {
          return { status: 401, body: { ok: false, error: 'unauthenticated' } };
        }
        const source = WebPrivilegedSession.safeSource(
          typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '',
          remoteAddress,
        );
        const session = sessions.create({
          ...authenticated,
          presenceLabel: `Web · ${source.browserFamily} · ${source.addressLabel}`,
        });
        if (logicalSessionId && logicalSessionId !== session.rateLimitId) {
          await sessions.destroyByRateLimitId(logicalSessionId);
        } else if (sessionId && sessionId !== session.id) {
          await sessions.destroy(sessionId);
        }
        return {
          status: 200,
          headers: { 'Set-Cookie': sessionCookie(session.id) },
          body: { ok: true, session: bootstrap(session) },
        };
      } catch {
        return { status: 401, body: { ok: false, error: 'unauthenticated' } };
      }
    },
  });

  router.register({
    method: 'GET',
    path: `${RELAY_WEB_API_PREFIX}/session/bootstrap`,
    authenticated: true,
    handler: async ({ session }) => ({
      status: 200,
      body: { ok: true, session: bootstrap(session!) },
    }),
  });

  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/session/refresh`,
    authenticated: true,
    csrf: true,
    rateLimit: { bucket: 'session-refresh', key: 'session', limit: 30, windowMs: 60_000 },
    handler: async ({ sessionId }) => {
      const refreshed = sessionId ? await sessions.refresh(sessionId) : null;
      if (!refreshed) {
        return {
          status: 401,
          headers: { 'Set-Cookie': clearedSessionCookie() },
          body: { ok: false, error: 'unauthenticated' },
        };
      }
      return {
        status: 200,
        headers: { 'Set-Cookie': sessionCookie(refreshed.id) },
        body: { ok: true, session: bootstrap(refreshed) },
      };
    },
  });

  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/session/logout`,
    authenticated: true,
    csrf: true,
    handler: async ({ sessionId, logicalSessionId }) => {
      if (logicalSessionId) await sessions.destroyByRateLimitId(logicalSessionId);
      else if (sessionId) await sessions.destroy(sessionId);
      return {
        status: 200,
        headers: { 'Set-Cookie': clearedSessionCookie() },
        body: { ok: true },
      };
    },
  });

  router.register({
    method: 'GET',
    path: `${RELAY_WEB_API_PREFIX}/session/events`,
    authenticated: true,
    handler: async ({ request, session, sessionId }) => {
      if (!sessionId || !session) {
        return { status: 401, body: { ok: false, error: 'unauthenticated' } };
      }
      const releasePermit = eventStreams.tryAcquire(session.rateLimitId);
      if (!releasePermit) {
        return {
          status: 429,
          headers: { 'Retry-After': '1' },
          body: { ok: false, error: 'stream-limit' },
        };
      }
      return {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          Connection: 'keep-alive',
        },
        onComplete: releasePermit,
        stream: (response: ServerResponse) => {
          const logicalSessionId = session.rateLimitId;
          let closed = false;
          let heartbeat: NodeJS.Timeout | null = null;
          let stopEvents = () => undefined;
          const close = () => {
            if (closed) return;
            closed = true;
            if (heartbeat) clearInterval(heartbeat);
            sessions.unregisterCleanupByRateLimitId(logicalSessionId, close);
            stopEvents();
            releasePermit();
            if (!response.writableEnded) response.end();
          };
          try {
            if (!sessions.registerCleanup(sessionId, close)) {
              close();
              return;
            }
            stopEvents = sessions.subscribeEvents(sessionId, (event, data) => {
              if (!response.writableEnded) {
                response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
              }
            });
            heartbeat = setInterval(() => {
              if (!response.writableEnded) response.write(': heartbeat\n\n');
            }, SSE_HEARTBEAT_MS);
            heartbeat.unref();
            request.once('close', close);
            response.once('close', close);
            response.once('error', close);
            response.write(': connected\n\n');
          } catch (error) {
            close();
            throw error;
          }
        },
      };
    },
  });
}
