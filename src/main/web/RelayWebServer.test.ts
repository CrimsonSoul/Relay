import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RelayWebServer } from './RelayWebServer';

const LOOPBACK = ['127', '0', '0', '1'].join('.');
const loopbackUrl = (port: number, pathname = '/') =>
  ['http', '://', LOOPBACK, ':', String(port), pathname].join('');

async function listen(server: NetServer, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return address.port;
}

async function close(server: NetServer): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function rawRequestStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: LOOPBACK, port, path }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
}

const OUTSIDE_SECRET = 'relay-outside-the-static-root';

describe('RelayWebServer', () => {
  let staticRoot: string;
  const openServers: NetServer[] = [];
  const outsideRoots: string[] = [];

  beforeEach(() => {
    staticRoot = mkdtempSync(join(tmpdir(), 'relay-web-static-'));
    mkdirSync(join(staticRoot, 'assets'));
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>Relay Web</title>');
    writeFileSync(join(staticRoot, 'assets', 'app.js'), 'globalThis.relayLoaded = true;');
  });

  afterEach(async () => {
    await Promise.all(openServers.map((server) => close(server)));
    rmSync(staticRoot, { recursive: true, force: true });
    for (const outsideRoot of outsideRoots.splice(0)) {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  async function freePort(): Promise<number> {
    const probe = createNetServer();
    const port = await listen(probe);
    await close(probe);
    return port;
  }

  it('serves the shared app shell and hashed assets from the configured exact port', async () => {
    const port = await freePort();
    const server = new RelayWebServer({ host: LOOPBACK, port, staticRoot });

    await expect(server.start()).resolves.toMatchObject({ status: 'available', port });
    await expect(fetch(loopbackUrl(port)).then((response) => response.text())).resolves.toContain(
      '<title>Relay Web</title>',
    );
    const asset = await fetch(loopbackUrl(port, '/assets/app.js'));
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    await expect(asset.text()).resolves.toContain('relayLoaded');
    await server.stop();
  });

  it('falls back to the app shell for navigation but never for API routes', async () => {
    const port = await freePort();
    const server = new RelayWebServer({ host: LOOPBACK, port, staticRoot });
    await server.start();

    expect(await fetch(loopbackUrl(port, '/settings')).then((response) => response.status)).toBe(
      200,
    );
    expect(
      await fetch(loopbackUrl(port, '/relay-api/v1/not-real')).then((response) => response.status),
    ).toBe(404);
    await server.stop();
  });

  it('routes API requests through the gateway and guards static responses', async () => {
    const port = await freePort();
    const gateway = {
      authorizeStatic: (
        _request: import('node:http').IncomingMessage,
        response: import('node:http').ServerResponse,
      ) => {
        response.setHeader('X-Relay-Static-Guard', 'active');
        return true;
      },
      handleApi: async (
        _request: import('node:http').IncomingMessage,
        response: import('node:http').ServerResponse,
      ) => {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ ok: true }));
      },
    };
    const server = new RelayWebServer({ host: LOOPBACK, port, staticRoot, gateway });
    await server.start();

    const page = await fetch(loopbackUrl(port));
    expect(page.headers.get('x-relay-static-guard')).toBe('active');
    const api = await fetch(loopbackUrl(port, '/relay-api/v1/session/bootstrap'));
    expect(api.headers.get('x-relay-static-guard')).toBeNull();
    await expect(api.json()).resolves.toEqual({ ok: true });
    await server.stop();
  });

  it('rejects encoded traversal rather than serving an app fallback', async () => {
    const port = await freePort();
    const server = new RelayWebServer({ host: LOOPBACK, port, staticRoot });
    await server.start();

    expect(await rawRequestStatus(port, '/%2e%2e/%2e%2e/secret.txt')).toBe(400);
    await server.stop();
  });

  it('never serves a symlink that escapes the static root', async (context) => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'relay-web-outside-'));
    outsideRoots.push(outsideRoot);
    writeFileSync(join(outsideRoot, 'secret.txt'), OUTSIDE_SECRET);
    try {
      symlinkSync(join(outsideRoot, 'secret.txt'), join(staticRoot, 'secret.txt'));
      symlinkSync(outsideRoot, join(staticRoot, 'outside'));
    } catch {
      // Windows only allows unprivileged symlink creation under developer mode.
      context.skip();
    }
    const port = await freePort();
    const server = new RelayWebServer({ host: LOOPBACK, port, staticRoot });
    await server.start();

    const linkedFile = await fetch(loopbackUrl(port, '/secret.txt')).then((response) =>
      response.text(),
    );
    const linkedDirectory = await fetch(loopbackUrl(port, '/outside/secret.txt')).then((response) =>
      response.text(),
    );
    expect(linkedFile).not.toContain(OUTSIDE_SECRET);
    expect(linkedDirectory).not.toContain(OUTSIDE_SECRET);
    expect(linkedFile).toContain('<title>Relay Web</title>');
    expect(linkedDirectory).toContain('<title>Relay Web</title>');
    await server.stop();
  });

  it('returns a completed 404 response when the packaged app shell is missing', async () => {
    unlinkSync(join(staticRoot, 'index.html'));
    const port = await freePort();
    const server = new RelayWebServer({ host: LOOPBACK, port, staticRoot });
    await server.start();

    expect(
      await fetch(loopbackUrl(port, '/settings'), { signal: AbortSignal.timeout(500) }).then(
        (response) => response.status,
      ),
    ).toBe(404);
    await server.stop();
  });

  it('reports a port conflict without selecting another port', async () => {
    const occupied = createNetServer();
    openServers.push(occupied);
    const port = await listen(occupied);
    const server = new RelayWebServer({ host: LOOPBACK, port, staticRoot });

    await expect(server.start()).resolves.toMatchObject({
      status: 'conflict',
      port,
      error: 'port-conflict',
    });
    expect(server.getState().port).toBe(port);
    await server.stop();
  });

  it('retries the same exact port after a startup conflict clears', async () => {
    const occupied = createNetServer();
    const port = await listen(occupied);
    const server = new RelayWebServer({ host: LOOPBACK, port, staticRoot });
    await expect(server.start()).resolves.toMatchObject({ status: 'conflict', port });
    await close(occupied);

    await expect(server.retry()).resolves.toMatchObject({ status: 'available', port });
    await server.stop();
  });

  it('makes repeated start and stop calls idempotent', async () => {
    const port = await freePort();
    const server = new RelayWebServer({ host: LOOPBACK, port, staticRoot });

    const first = await server.start();
    const second = await server.start();
    expect(second).toEqual(first);

    await server.stop();
    await server.stop();
    expect(server.getState()).toMatchObject({ status: 'disabled', port });
  });
});
