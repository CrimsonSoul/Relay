import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WEB_RUNTIME } from '@shared/runtime';
import { WebRequestSecurity } from '../WebRequestSecurity';
import { WebRouter, WEB_SESSION_COOKIE_NAME } from '../WebRouter';
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
      },
    });
    expect(body.session.csrfToken.length).toBeGreaterThanOrEqual(32);
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

    await sessions.destroy(sessionId);
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });
});
