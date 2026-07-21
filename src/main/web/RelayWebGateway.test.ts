import { createServer as createNetServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { WEB_RUNTIME } from '@shared/runtime';
import { RelayWebGateway } from './RelayWebGateway';
import { RelayWebServer } from './RelayWebServer';

const LOOPBACK = '127.0.0.1';

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

describe('RelayWebGateway', () => {
  it('protects static content and provides live authenticated session routes on one origin', async () => {
    const port = await freePort();
    const authenticate = vi.fn(async () => ({
      pbUrl: `http://${LOOPBACK}:8090`,
      auth: { token: 'app-user-token', record: null },
      publicConfig: {
        mode: 'server' as const,
        port: 8090,
        bindHost: '0.0.0.0' as const,
        lanIp: LOOPBACK,
        web: { enabled: true, port },
      },
      runtime: WEB_RUNTIME,
      refresh: async () => ({ token: 'refreshed-token', record: null }),
    }));
    const gateway = new RelayWebGateway({
      config: {
        mode: 'server',
        port: 8090,
        bindHost: '0.0.0.0',
        secret: 'never-public',
        web: { enabled: true, port },
      },
      authenticate,
      hostname: LOOPBACK,
      getInterfaceAddresses: () => [],
    });
    const server = new RelayWebServer({
      host: LOOPBACK,
      port,
      staticRoot: '/missing-static-root',
      gateway,
    });
    await server.start();

    const origin = `http://${LOOPBACK}:${port}`;
    const staticResponse = await fetch(`${origin}/`);
    expect(staticResponse.status).toBe(404);
    expect(staticResponse.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );
    const rejectedMethod = await fetch(`${origin}/not-an-api`, { method: 'POST' });
    expect(rejectedMethod.status).toBe(405);
    expect(rejectedMethod.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );

    const loginResponse = await fetch(`${origin}/relay-api/v1/session/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ passphrase: 'fixture-passphrase' }),
    });
    expect(loginResponse.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith('fixture-passphrase');
    expect(gateway.sessionCount).toBe(1);

    await server.stop();
    await gateway.dispose();
    expect(gateway.sessionCount).toBe(0);
  });
});
