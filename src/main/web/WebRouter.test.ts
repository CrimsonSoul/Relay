import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { WEB_RUNTIME } from '@shared/runtime';
import { WebRequestSecurity } from './WebRequestSecurity';
import { WebRateLimiter } from './WebRateLimiter';
import { WebRouter, WEB_SESSION_COOKIE_NAME } from './WebRouter';
import { WebSessionStore } from './WebSessionStore';

const LOOPBACK = ['127', '0', '0', '1'].join('.');

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

describe('WebRouter', () => {
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
      pbUrl: `${origin}/pb`,
      auth: { token: 'app-user-token', record: null },
      publicConfig: {
        mode: 'server',
        port: 8090,
        bindHost: '0.0.0.0',
        lanIp: LOOPBACK,
      },
      runtime: WEB_RUNTIME,
      refresh: async () => ({ token: 'refreshed-token', record: null }),
    });
    const router = new WebRouter({
      security: new WebRequestSecurity({
        port,
        hostname: LOOPBACK,
        getInterfaceAddresses: () => [],
      }),
      sessions,
      limiter: new WebRateLimiter(),
    });
    router.register({
      method: 'GET',
      path: '/relay-api/v1/public',
      handler: async () => ({ status: 200, body: { ok: true } }),
    });
    router.register({
      method: 'POST',
      path: '/relay-api/v1/echo',
      authenticated: true,
      csrf: true,
      bodySchema: z.object({ value: z.string().max(32) }).strict(),
      maxBodyBytes: 64,
      rateLimit: { bucket: 'echo', limit: 2, windowMs: 60_000, key: 'session' },
      handler: async ({ body }) => ({ status: 200, body }),
    });
    const server = createServer((request, response) => void router.handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(port, LOOPBACK, resolve));
    return {
      origin,
      session,
      cookie: `${WEB_SESSION_COOKIE_NAME}=${session.id}`,
    };
  }

  it('dispatches exact allowlisted routes and rejects unknown methods and paths', async () => {
    const { origin } = await fixture();

    const found = await fetch(`${origin}/relay-api/v1/public`);
    expect(found.status).toBe(200);
    await expect(found.json()).resolves.toEqual({ ok: true });
    expect((await fetch(`${origin}/relay-api/v1/missing`)).status).toBe(404);
    expect((await fetch(`${origin}/relay-api/v1/public`, { method: 'PUT' })).status).toBe(405);
  });

  it('requires an ordinary session, exact Origin, and matching CSRF for state changes', async () => {
    const { origin, cookie, session } = await fixture();
    const body = JSON.stringify({ value: 'incident' });

    expect(
      (
        await fetch(`${origin}/relay-api/v1/echo`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin },
          body,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${origin}/relay-api/v1/echo`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie,
            origin: 'http://attacker.test',
            'x-relay-csrf': session.csrfToken,
          },
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${origin}/relay-api/v1/echo`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie, origin },
          body,
        })
      ).status,
    ).toBe(403);

    const accepted = await fetch(`${origin}/relay-api/v1/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin,
        'x-relay-csrf': session.csrfToken,
      },
      body,
    });
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({ value: 'incident' });
  });

  it('bounds content type, JSON parsing, body size, and schema shape', async () => {
    const { origin, cookie, session } = await fixture();
    const request = (body: string, contentType = 'application/json') =>
      fetch(`${origin}/relay-api/v1/echo`, {
        method: 'POST',
        headers: {
          'content-type': contentType,
          cookie,
          origin,
          'x-relay-csrf': session.csrfToken,
        },
        body,
      });

    expect((await request('{}', 'text/plain')).status).toBe(415);
    expect((await request('{')).status).toBe(400);
    expect((await request(JSON.stringify({ value: 'ok', secret: 'extra' }))).status).toBe(400);
    expect((await request(JSON.stringify({ value: 'x'.repeat(100) }))).status).toBe(413);
  });

  it('enforces per-session route buckets and returns bounded retry timing', async () => {
    const { origin, cookie, session } = await fixture();
    const send = () =>
      fetch(`${origin}/relay-api/v1/echo`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin,
          'x-relay-csrf': session.csrfToken,
        },
        body: JSON.stringify({ value: 'bounded' }),
      });

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('adds restrictive no-store headers to successful and failed API responses', async () => {
    const { origin } = await fixture();
    for (const response of [
      await fetch(`${origin}/relay-api/v1/public`),
      await fetch(`${origin}/relay-api/v1/missing`),
    ]) {
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
  });
});
