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

const SESSION_COOKIE_PATH = '/relay-api';
const SSE_HEARTBEAT_MS = 25_000;

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
  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/session/login`,
    bodySchema: WebSessionLoginInputSchema,
    maxBodyBytes: 1024,
    rateLimit: { bucket: 'session-login', key: 'ip', limit: 5, windowMs: 60_000 },
    handler: async ({ body, request, remoteAddress, sessionId }) => {
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
        if (sessionId && sessionId !== session.id) await sessions.destroy(sessionId);
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
    handler: async ({ sessionId }) => {
      if (sessionId) await sessions.destroy(sessionId);
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
    handler: async ({ request, sessionId }) => ({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
      },
      stream: (response: ServerResponse) => {
        if (!sessionId) {
          response.end();
          return;
        }
        let closed = false;
        const heartbeat = setInterval(() => {
          if (!response.writableEnded) response.write(': heartbeat\n\n');
        }, SSE_HEARTBEAT_MS);
        heartbeat.unref();
        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          sessions.unregisterCleanup(sessionId, close);
          stopEvents();
          if (!response.writableEnded) response.end();
        };
        const stopEvents = sessions.subscribeEvents(sessionId, (event, data) => {
          if (!response.writableEnded) {
            response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          }
        });
        sessions.registerCleanup(sessionId, close);
        request.once('close', close);
        response.write(': connected\n\n');
      },
    }),
  });
}
