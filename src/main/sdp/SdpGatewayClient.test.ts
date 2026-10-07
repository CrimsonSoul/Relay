import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { loggers } from '../logger';
import type PocketBase from 'pocketbase';
import { WEB_RUNTIME } from '@shared/runtime';
import { RELAY_WEB_API_PREFIX } from '@shared/webApi';
import { SdpGatewayClient } from './SdpGatewayClient';
import { SDP_SERVER_UPDATE_MESSAGE, type SdpBrokerReply } from '@shared/sdpAccount';
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
  it('sends VIP flags only to clients that name the feature', async () => {
    const port = await freePort();
    const ticket = {
      id: '1',
      number: '820001',
      subject: 'VIP request',
      status: 'Open',
      priority: 'Low',
      group: 'NOC',
      technician: '',
      createdAt: 1,
      dueAt: null,
      vip: true,
    };
    const invoke = vi.fn(async () => ({
      view: {
        configured: true,
        status: 'connected' as const,
        queuePage: { queue: 'NOC', page: 0, hasMore: false, tickets: [ticket] },
      },
    }));
    const origin = `http://127.0.0.1:${port}`;
    const gateway = new RelayWebGateway({
      config: {
        mode: 'server' as const,
        port: 8090,
        bindHost: '127.0.0.1' as const,
        secret: 'fixture-passphrase',
        web: { enabled: true, port },
      },
      getSdpBroker: () => ({ invoke, disconnect: vi.fn() }) as unknown as SdpBroker,
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
    try {
      const client = new SdpGatewayClient(() => ({
        config: {
          mode: 'client' as const,
          serverUrl: 'http://127.0.0.1:8090',
          secret: 'fixture-passphrase',
        },
        pb: { collection: () => ({ getOne }) } as unknown as PocketBase,
      }));
      const reply = await client.invoke({ action: 'readQueue', queue: 'NOC', page: 0 });
      expect(reply.view.queuePage?.tickets[0]?.vip).toBe(true);
      // An older client sends no feature header and rejects unknown fields.
      const login = await fetch(`${origin}${RELAY_WEB_API_PREFIX}/session/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ passphrase: 'fixture-passphrase' }),
      });
      const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
      const { session } = (await login.json()) as { session: { csrfToken: string } };
      const older = await fetch(`${origin}${RELAY_WEB_API_PREFIX}/sdp/account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          Cookie: cookie,
          'X-Relay-CSRF': session.csrfToken,
        },
        body: JSON.stringify({ action: 'readQueue', queue: 'NOC', page: 0 }),
      });
      const body = (await older.json()) as SdpBrokerReply;
      expect(older.status).toBe(200);
      expect(body.view.queuePage?.tickets[0]).toEqual({ ...ticket, vip: undefined });
      expect(JSON.stringify(body)).not.toContain('vip');
    } finally {
      await server.stop();
      await gateway.dispose();
    }
  });
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
      // Broker errors keep the gateway session, so the server-side SDP sign-in survives.
      invoke.mockRejectedValueOnce(new Error('An SDP operation is already in progress.'));
      await expect(alice.invoke({ action: 'status' })).rejects.toThrow(
        'SDP could not complete this action.',
      );
      await alice.invoke({ action: 'status' });
      expect(invoke).toHaveBeenLastCalledWith(aliceId, { action: 'status' });
      // A server that predates a command or field rejects the body (400); that is reported as
      // the fixed update message, and the session is kept.
      const unknown = { action: 'readQueue', queue: 'NOC', page: 0, pageSize: 7 };
      await expect(alice.invoke(unknown as never)).rejects.toThrow(SDP_SERVER_UPDATE_MESSAGE);
      const sorted = {
        action: 'readQueue',
        queue: 'NOC',
        page: 0,
        sort: { field: 'priority', order: 'desc' },
      } as const;
      await alice.invoke(sorted);
      expect(invoke).toHaveBeenLastCalledWith(aliceId, sorted);
      // Newest first is the default order, so a client never sends it.
      await expect(
        alice.invoke({ ...sorted, sort: { field: 'created', order: 'desc' } } as never),
      ).rejects.toThrow(SDP_SERVER_UPDATE_MESSAGE);
      await alice.invoke({ action: 'status' });
      expect(invoke).toHaveBeenLastCalledWith(aliceId, { action: 'status' });
      // Release servers reject test controls before they reach the broker.
      const calls = invoke.mock.calls.length;
      await expect(alice.invoke({ action: 'clearCopies' })).rejects.toThrow();
      expect(invoke).toHaveBeenCalledTimes(calls);
      await alice.invoke({ action: 'status' });
      expect(invoke).toHaveBeenLastCalledWith(aliceId, { action: 'status' });
      expect(disconnect).not.toHaveBeenCalled();
      const login = await fetch(`${origin}${RELAY_WEB_API_PREFIX}/session/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
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
  it('drops a Relay sign-in the server rejects but keeps it through network failures', async () => {
    const warn = vi.spyOn(loggers.main, 'warn').mockImplementation(() => undefined);
    const clear = vi.fn();
    const getOne = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new SdpGatewayClient(
      async () => ({
        config: {
          mode: 'client' as const,
          serverUrl: 'http://127.0.0.1:8090',
          secret: 'fixture-passphrase',
        },
        pb: { collection: () => ({ getOne }), authStore: { clear } } as unknown as PocketBase,
      }),
      fetchImpl,
    );
    getOne.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
    await expect(client.invoke({ action: 'status' })).rejects.toThrow('Relay server connection');
    expect(clear).not.toHaveBeenCalled();
    getOne.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
    await expect(client.invoke({ action: 'status' })).rejects.toThrow('Relay server connection');
    // PocketBase answers a rejected token on the signed-in-only discovery record with 404.
    getOne.mockRejectedValueOnce(Object.assign(new Error('missing'), { status: 404 }));
    await expect(client.invoke({ action: 'status' })).rejects.toThrow('Relay server connection');
    expect(clear).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
    // Repeated status checks log each distinct failure once, with metadata only.
    expect(warn.mock.calls.map((call) => call[1])).toEqual([
      { stage: 'setup', error: 'Error', category: 'unavailable', status: 0 },
      { stage: 'setup', error: 'Error', category: 'unknown', status: 404 },
    ]);
    warn.mockRestore();
  });
  it('waits out a short gateway rate limit once for reads, never for changes or long waits', async () => {
    vi.spyOn(loggers.main, 'warn').mockImplementation(() => undefined);
    const getOne = vi.fn().mockResolvedValue({ enabled: true, gatewayPort: 8091 });
    const login = () =>
      new Response(JSON.stringify({ session: { csrfToken: 'fixture-csrf' } }), {
        headers: { 'set-cookie': 'relay_web_session=fixture; Path=/' },
      });
    const limited = (seconds: number) =>
      new Response('{}', { status: 429, headers: { 'Retry-After': String(seconds) } });
    const ok = () =>
      new Response(JSON.stringify({ view: { configured: true, status: 'connected' } }));
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new SdpGatewayClient(
      () => ({
        config: {
          mode: 'client' as const,
          serverUrl: 'http://127.0.0.1:8090',
          secret: 'fixture-passphrase',
        },
        pb: { collection: () => ({ getOne }) } as unknown as PocketBase,
      }),
      fetchImpl,
    );
    const accountCalls = () =>
      fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/sdp/account')).length;
    fetchImpl.mockResolvedValueOnce(login()).mockResolvedValueOnce(limited(1));
    fetchImpl.mockResolvedValueOnce(ok());
    await expect(client.invoke({ action: 'readHistory', id: '1', page: 0 })).resolves.toEqual({
      view: { configured: true, status: 'connected' },
    });
    expect(accountCalls()).toBe(2);
    // A change is never resent, a long wait is reported, and status checks repeat on their own.
    fetchImpl.mockResolvedValueOnce(limited(1));
    await expect(client.invoke({ action: 'cancelChange' })).rejects.toThrow(
      'SDP could not complete this action.',
    );
    fetchImpl.mockResolvedValueOnce(limited(30));
    await expect(client.invoke({ action: 'readDetail', id: '1', page: 0 })).rejects.toThrow(
      'SDP could not complete this action.',
    );
    fetchImpl.mockResolvedValueOnce(limited(1));
    await expect(client.invoke({ action: 'status' })).rejects.toThrow(
      'SDP could not complete this action.',
    );
    expect(accountCalls()).toBe(5);
    vi.restoreAllMocks();
  });
});
