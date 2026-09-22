import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import { WEB_RUNTIME } from '@shared/runtime';
import { RELAY_WEB_API_PREFIX } from '@shared/webApi';
import { SdpGatewayClient } from './SdpGatewayClient';
import type { SdpBroker } from './SdpBroker';
import { RelayWebGateway } from '../web/RelayWebGateway';
import { RelayWebServer } from '../web/RelayWebServer';
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
describe('SDP native client through authenticated private Relay gateway', () => {
  it('isolates logical sessions, enforces CSRF and hides saved results when Relay is unavailable', async () => {
    const port = await freePort();
    const invoke = vi.fn(async (_id: string, _command: unknown) => ({
      view: { configured: true, status: 'disconnected' as const },
    }));
    const disconnect = vi.fn();
    const origin = `http://127.0.0.1:${port}`;
    const config = {
      mode: 'server' as const,
      port: 8090,
      bindHost: '127.0.0.1' as const,
      secret: 'fixture-passphrase',
      web: { enabled: true, port },
    };
    const gateway = new RelayWebGateway({
      config,
      getSdpBroker: () => ({ invoke, disconnect }) as unknown as SdpBroker,
      hostname: '127.0.0.1',
      getInterfaceAddresses: () => [],
      authenticate: async (passphrase) =>
        passphrase === 'fixture-passphrase'
          ? {
              pbUrl: 'http://127.0.0.1:8090',
              auth: { token: 'fixture-passphrase', record: null },
              publicConfig: {
                mode: 'server',
                port: 8090,
                bindHost: '127.0.0.1',
                lanIp: '127.0.0.1',
              },
              runtime: WEB_RUNTIME,
              refresh: async () => ({ token: 'fixture-passphrase', record: null }),
            }
          : null,
    });
    const server = new RelayWebServer({ host: '127.0.0.1', port, staticRoot: '/missing', gateway });
    await server.start();
    const getOne = vi.fn().mockResolvedValue({ enabled: true, gatewayPort: port });
    const context = () => ({
      config: {
        mode: 'client' as const,
        serverUrl: 'http://127.0.0.1:8090',
        secret: 'fixture-passphrase',
      },
      pb: { collection: () => ({ getOne }) } as unknown as PocketBase,
    });
    try {
      const alice = new SdpGatewayClient(context);
      const bob = new SdpGatewayClient(context);
      expect((await alice.invoke({ action: 'status' })).view.configured).toBe(true);
      const aliceId = invoke.mock.calls[0]![0];
      await bob.invoke({ action: 'status' });
      const bobId = invoke.mock.calls[1]![0];
      expect(aliceId).not.toBe(bobId);
      await alice.invoke({ action: 'status' });
      expect(invoke.mock.calls[2]![0]).toBe(aliceId);
      const draft = {
        action: 'prepareChange',
        mutation: {
          kind: 'create',
          fields: { subject: 'Synthetic request', description: 'x'.repeat(12000) },
          majorIncident: false,
        },
      } as const;
      await alice.invoke(draft);
      expect(invoke).toHaveBeenLastCalledWith(aliceId, draft);
      const confirmation = {
        action: 'confirmChange',
        confirmationId: 'f6d1a214-87d9-45ef-9bce-b1a850e5d301',
      } as const;
      await alice.invoke(confirmation);
      expect(invoke).toHaveBeenLastCalledWith(aliceId, confirmation);
      const login = await fetch(`${origin}${RELAY_WEB_API_PREFIX}/session/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Synthetic gateway login.
        body: JSON.stringify({ passphrase: 'fixture-passphrase' }),
      });
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
      await login.json();
      const rejected = await fetch(`${origin}${RELAY_WEB_API_PREFIX}/sdp/account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
        body: JSON.stringify(confirmation),
      });
      expect(rejected.status).toBe(403);
      await rejected.text();
      const anonymous = await fetch(`${origin}${RELAY_WEB_API_PREFIX}/sdp/account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ action: 'status' }),
      });
      expect(anonymous.status).toBe(401);
      await anonymous.text();
      await server.stop();
      await expect(alice.invoke({ action: 'status' })).rejects.toThrow('Relay server connection');
    } finally {
      await server.stop();
      await gateway.dispose();
    }
    expect(disconnect).toHaveBeenCalled();
  });
});
