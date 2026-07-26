import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WEB_RUNTIME } from '@shared/runtime';
import { WebRequestSecurity } from '../WebRequestSecurity';
import {
  WebRouter,
  WEB_SESSION_COOKIE_NAME,
  type WebRoute,
  type WebRouteContext,
  type WebRouteResponse,
} from '../WebRouter';
import { WebSessionStore } from '../WebSessionStore';
import { registerWebSessionRoutes } from './sessionRoutes';

const LOOPBACK = ['127', '0', '0', '1'].join('.');
const PASSPHRASE = ['fixture', 'passphrase', '123'].join('-');

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

describe('Relay Web session routes', () => {
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
    const dispose = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => ({ token: 'refreshed-token', record: { id: 'relay-user' } }));
    const authenticate = vi.fn(async (passphrase: string) => {
      if (passphrase !== PASSPHRASE) return null;
      return {
        pbUrl: `${origin}/pocketbase`,
        auth: { token: 'app-user-token', record: { id: 'relay-user' } },
        publicConfig: {
          mode: 'server' as const,
          port: 8090,
          bindHost: '0.0.0.0' as const,
          lanIp: LOOPBACK,
          web: { enabled: true, port },
        },
        runtime: WEB_RUNTIME,
        refresh,
        dispose,
      };
    });
    const router = new WebRouter({
      security: new WebRequestSecurity({
        port,
        hostname: LOOPBACK,
        getInterfaceAddresses: () => [],
        connectOrigins: [`${origin}/pocketbase`],
      }),
      sessions,
    });
    registerWebSessionRoutes(router, { sessions, authenticate });
    const server = createServer((request, response) => void router.handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(port, LOOPBACK, resolve));
    return { origin, sessions, authenticate, dispose, refresh };
  }

  async function login(origin: string, passphrase = PASSPHRASE) {
    return fetch(`${origin}/relay-api/v1/session/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ passphrase }),
    });
  }

  it('creates a nonpersistent path-scoped strict HttpOnly cookie and bounded bootstrap', async () => {
    const { origin, authenticate } = await fixture();
    const response = await login(origin);
    const body = await response.json();
    const setCookie = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(setCookie).toContain(`${WEB_SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/relay-api');
    expect(setCookie).not.toMatch(/(?:^|;\s*)Secure(?:;|$)/u);
    expect(setCookie).not.toContain('Expires=');
    expect(setCookie).not.toContain('Max-Age=');
    expect(body).toMatchObject({
      ok: true,
      session: {
        pbUrl: `${origin}/pocketbase`,
        auth: { token: 'app-user-token' },
        runtime: WEB_RUNTIME,
        presenceLabel: 'Web · Other · 127.0.0.1',
      },
    });
    expect(body.session.csrfToken.length).toBeGreaterThanOrEqual(32);
    expect(body.session).not.toHaveProperty('rateLimitId');
    expect(authenticate).toHaveBeenCalledWith(PASSPHRASE);
    expect(JSON.stringify(body)).not.toContain(PASSPHRASE);
  });

  it('uses the same generic failure for invalid credentials and authenticator errors', async () => {
    const { origin, authenticate } = await fixture();
    const invalid = await login(origin, 'wrong-passphrase');
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toEqual({ ok: false, error: 'unauthenticated' });

    authenticate.mockRejectedValueOnce(new Error(`Do not expose ${PASSPHRASE}`));
    const unavailable = await login(origin);
    expect(unavailable.status).toBe(401);
    const body = await unavailable.json();
    expect(body).toEqual({ ok: false, error: 'unauthenticated' });
    expect(JSON.stringify(body)).not.toContain(PASSPHRASE);
  });

  it('bootstraps from the opaque cookie without retaining the submitted passphrase', async () => {
    const { origin, sessions } = await fixture();
    const loginResponse = await login(origin);
    const cookie = loginResponse.headers.get('set-cookie')!.split(';', 1)[0];

    const response = await fetch(`${origin}/relay-api/v1/session/bootstrap`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      session: { auth: { token: 'app-user-token' } },
    });
    expect(JSON.stringify([...Array.from({ length: sessions.size })])).not.toContain(PASSPHRASE);
  });

  it('replaces the prior ordinary session after signing in again', async () => {
    const { origin, sessions, dispose } = await fixture();
    const first = await login(origin);
    const firstCookie = first.headers.get('set-cookie')!.split(';', 1)[0];

    const replacement = await fetch(`${origin}/relay-api/v1/session/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, cookie: firstCookie },
      body: JSON.stringify({ passphrase: PASSPHRASE }),
    });
    const replacementCookie = replacement.headers.get('set-cookie')!.split(';', 1)[0];

    expect(replacement.status).toBe(200);
    expect(replacementCookie).not.toBe(firstCookie);
    expect(sessions.size).toBe(1);
    expect(dispose).toHaveBeenCalledOnce();
    const oldBootstrap = await fetch(`${origin}/relay-api/v1/session/bootstrap`, {
      headers: { cookie: firstCookie },
    });
    expect(oldBootstrap.status).toBe(401);
  });

  it('rotates the cookie, CSRF value, and PocketBase token on refresh', async () => {
    const { origin, refresh } = await fixture();
    const loginResponse = await login(origin);
    const loginBody = await loginResponse.json();
    const oldCookie = loginResponse.headers.get('set-cookie')!.split(';', 1)[0];
    const oldId = oldCookie.split('=', 2)[1];

    const response = await fetch(`${origin}/relay-api/v1/session/refresh`, {
      method: 'POST',
      headers: {
        cookie: oldCookie,
        origin,
        'x-relay-csrf': loginBody.session.csrfToken,
      },
    });
    const body = await response.json();
    const newCookie = response.headers.get('set-cookie')!.split(';', 1)[0];

    expect(response.status).toBe(200);
    expect(refresh).toHaveBeenCalledOnce();
    expect(newCookie).not.toContain(oldId);
    expect(body.session.csrfToken).not.toBe(loginBody.session.csrfToken);
    expect(body.session.auth.token).toBe('refreshed-token');
  });

  it('keeps one refresh budget across cookie and CSRF rotation', async () => {
    const { origin, refresh } = await fixture();
    const loginResponse = await login(origin);
    let body = await loginResponse.json();
    let cookie = loginResponse.headers.get('set-cookie')!.split(';', 1)[0];

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(`${origin}/relay-api/v1/session/refresh`, {
        method: 'POST',
        headers: { cookie, origin, 'x-relay-csrf': body.session.csrfToken },
      });
      expect(response.status).toBe(200);
      body = await response.json();
      cookie = response.headers.get('set-cookie')!.split(';', 1)[0];
    }

    const limited = await fetch(`${origin}/relay-api/v1/session/refresh`, {
      method: 'POST',
      headers: { cookie, origin, 'x-relay-csrf': body.session.csrfToken },
    });
    expect(limited.status).toBe(429);
    expect(refresh).toHaveBeenCalledTimes(30);
  });

  it('logs out, clears the cookie, and disposes all session children', async () => {
    const { origin, dispose, sessions } = await fixture();
    const loginResponse = await login(origin);
    const loginBody = await loginResponse.json();
    const cookie = loginResponse.headers.get('set-cookie')!.split(';', 1)[0];

    const response = await fetch(`${origin}/relay-api/v1/session/logout`, {
      method: 'POST',
      headers: { cookie, origin, 'x-relay-csrf': loginBody.session.csrfToken },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(sessions.size).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('revokes the rotated session when an already-authorized old-cookie logout commits later', async () => {
    const sessions = new WebSessionStore();
    const input = {
      pbUrl: ['http', '://', 'relay-server', ':8090'].join(''),
      auth: { token: 'ordinary-token', record: null },
      publicConfig: { mode: 'server' as const, port: 8090 },
      runtime: WEB_RUNTIME,
      refresh: async () => ({ token: 'fresh-token', record: null }),
      dispose: vi.fn(async () => undefined),
    };
    const session = sessions.create(input);
    const routes: WebRoute[] = [];
    registerWebSessionRoutes(
      {
        register: (route: WebRoute) => routes.push(route),
      } as WebRouter,
      { sessions, authenticate: async () => null },
    );
    const logoutRoute = routes.find((route) => route.path.endsWith('/session/logout'))!;

    const refreshed = await sessions.refresh(session.id);
    expect(refreshed).not.toBeNull();
    const result = await logoutRoute.handler({
      request: new EventEmitter() as IncomingMessage,
      body: undefined,
      session: null,
      sessionId: session.id,
      logicalSessionId: session.rateLimitId,
      remoteAddress: LOOPBACK,
      origin: ['http', '://', 'relay-server', ':8091'].join(''),
    });

    expect(result.status).toBe(200);
    expect(sessions.size).toBe(0);
    expect(sessions.get(refreshed!.id, { touch: false })).toBeNull();
    expect(input.dispose).toHaveBeenCalledOnce();
  });

  it('makes logout win when refresh rotates first after both HTTP requests were authorized', async () => {
    let resolveRefresh!: (value: { token: string; record: { id: string } }) => void;
    const { origin, sessions, refresh, dispose } = await fixture();
    refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const loginResponse = await login(origin);
    const loginBody = await loginResponse.json();
    const oldCookie = loginResponse.headers.get('set-cookie')!.split(';', 1)[0];
    const requestHeaders = {
      cookie: oldCookie,
      origin,
      'x-relay-csrf': loginBody.session.csrfToken,
    };

    let signalDestroyStarted!: () => void;
    const destroyStarted = new Promise<void>((resolve) => {
      signalDestroyStarted = resolve;
    });
    let releaseDestroy!: () => void;
    const destroyGate = new Promise<void>((resolve) => {
      releaseDestroy = resolve;
    });
    const destroyLogical = sessions.destroyByRateLimitId.bind(sessions);
    vi.spyOn(sessions, 'destroyByRateLimitId').mockImplementation(async (rateLimitId) => {
      signalDestroyStarted();
      await destroyGate;
      await destroyLogical(rateLimitId);
    });

    const refreshRequest = fetch(`${origin}/relay-api/v1/session/refresh`, {
      method: 'POST',
      headers: requestHeaders,
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const logoutRequest = fetch(`${origin}/relay-api/v1/session/logout`, {
      method: 'POST',
      headers: requestHeaders,
    });
    await destroyStarted;

    resolveRefresh({ token: 'rotated-token', record: { id: 'relay-user' } });
    const refreshResponse = await refreshRequest;
    expect(refreshResponse.status).toBe(200);
    const rotatedCookie = refreshResponse.headers.get('set-cookie')!.split(';', 1)[0];
    releaseDestroy();

    const logoutResponse = await logoutRequest;
    expect(logoutResponse.status).toBe(200);
    expect(sessions.size).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();
    const rotatedBootstrap = await fetch(`${origin}/relay-api/v1/session/bootstrap`, {
      headers: { cookie: rotatedCookie },
    });
    expect(rotatedBootstrap.status).toBe(401);
  });

  it('streams a heartbeat endpoint and closes it with the owning session', async () => {
    const { origin, sessions } = await fixture();
    const loginResponse = await login(origin);
    const cookie = loginResponse.headers.get('set-cookie')!.split(';', 1)[0];
    const sessionId = cookie.split('=', 2)[1]!;

    const response = await fetch(`${origin}/relay-api/v1/session/events`, { headers: { cookie } });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(': connected');

    sessions.publish(sessionId, 'dynatrace-dashboards-changed', [{ id: 'dashboard-1' }]);
    const event = await reader.read();
    expect(new TextDecoder().decode(event.value)).toContain(
      'event: dynatrace-dashboards-changed\ndata: [{"id":"dashboard-1"}]',
    );

    await sessions.destroy(sessionId);
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });

  it('bounds live event streams per session and reuses a permit after close', async () => {
    const sessions = new WebSessionStore();
    const session = sessions.create({
      pbUrl: ['http', '://', 'relay-server', ':8090'].join(''),
      auth: { token: 'ordinary-token', record: null },
      publicConfig: { mode: 'server', port: 8090 },
      runtime: WEB_RUNTIME,
      refresh: async () => ({ token: 'fresh-token', record: null }),
    });
    const routes: WebRoute[] = [];
    registerWebSessionRoutes(
      {
        register: (route: WebRoute) => routes.push(route),
      } as WebRouter,
      { sessions, authenticate: async () => null },
    );
    const eventRoute = routes.find((route) => route.path.endsWith('/session/events'))!;
    const open = async () => {
      const request = new EventEmitter() as IncomingMessage;
      const response = Object.assign(new EventEmitter(), {
        writableEnded: false,
        statusCode: 0,
        setHeader: vi.fn(),
        write: vi.fn(() => true),
        end: vi.fn(function (this: { writableEnded: boolean }) {
          this.writableEnded = true;
        }),
      }) as unknown as ServerResponse;
      const context: WebRouteContext = {
        request,
        body: undefined,
        session,
        sessionId: session.id,
        remoteAddress: LOOPBACK,
        origin: ['http', '://', 'relay-server', ':8091'].join(''),
      };
      const result = (await eventRoute.handler(context)) as WebRouteResponse;
      result.stream?.(response);
      return { request, response, result };
    };

    const first = await open();
    const second = await open();
    const rejected = await open();
    expect(first.result.status).toBe(200);
    expect(second.result.status).toBe(200);
    expect(rejected.result).toMatchObject({
      status: 429,
      body: { ok: false, error: 'stream-limit' },
    });
    expect(rejected.result.stream).toBeUndefined();

    first.request.emit('close');
    const replacement = await open();
    expect(replacement.result.status).toBe(200);

    await sessions.destroy(session.id);
  });
});
