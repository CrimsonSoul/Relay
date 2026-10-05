import { beforeEach, describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import { createDeferred } from '../app/deferred';
import type * as SdpRuntimeModule from './SdpRuntime';

const mocks = vi.hoisted(() => ({
  quit: [] as Array<() => void>,
  settings: null as { revision: string; cacheMinutes: number; client: unknown } | null,
  authenticate: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    once: (event: string, listener: () => void) => {
      if (event === 'before-quit') mocks.quit.push(listener);
    },
    getPath: () => '/mock/userData',
  },
  safeStorage: {},
}));
vi.mock('./SdpServerStore', () => ({ SdpServerStore: class {} }));
vi.mock('./SdpGatewayClient', () => ({
  SdpGatewayClient: class {
    constructor(private readonly context: () => Promise<unknown>) {}
    async invoke() {
      return { view: { configured: true, status: 'connected' }, context: await this.context() };
    }
  },
}));
vi.mock('../pocketbase/RelayAppUserAuthCoordinator', () => ({
  authenticateRelayAppUserShared: mocks.authenticate,
}));
vi.mock('./SdpBroker', () => ({
  SdpBroker: class {
    store = {
      settings: () => mocks.settings,
      save: (client: unknown, cacheMinutes: number) => {
        mocks.settings = client ? { revision: 'next', cacheMinutes, client } : null;
      },
    };
    reset() {}
    dispose() {}
    invoke() {
      return Promise.resolve({ view: { configured: true, status: 'connected' } });
    }
  },
}));

async function start(mode: 'server' | 'client' = 'server') {
  vi.resetModules();
  // Fresh module per test: SdpRuntime keeps its broker, publish and quit state at module scope.
  const runtime: typeof SdpRuntimeModule = await import('./SdpRuntime');
  const update =
    vi.fn<(id: string, body: { revision: string; enabled: boolean }) => Promise<void>>();
  const pb = {
    baseURL: 'http://127.0.0.1:8090',
    authStore: { isValid: true, record: { collectionName: '_superusers' } },
    collection: () => ({ update, create: vi.fn() }),
  };
  const settings = {
    mode,
    serverUrl: 'http://127.0.0.1:8090',
    secret: 'fixture-passphrase',
    web: { enabled: true, port: 8091 },
  };
  const config = { load: () => settings };
  runtime.initializeSdpRuntime({
    getConfig: () => config as never,
    // Only the server bootstrap sets the main-process PocketBase client.
    getPb: () => (mode === 'server' ? (pb as never) : null),
  });
  return { runtime, update, settings };
}

function signedIn(client: PocketBase): void {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
  client.authStore.save(`e30.${payload.toString('base64url')}.signature`, null);
}

describe('SdpRuntime', () => {
  beforeEach(() => {
    mocks.quit.length = 0;
    mocks.settings = { revision: 'first', cacheMinutes: 60, client: {} };
    mocks.authenticate.mockReset().mockImplementation(async (client: PocketBase) => {
      signedIn(client);
    });
  });

  it('signs client desktops in to the Relay server for SDP without a main-process connection', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { runtime, settings } = await start('client');
    const status = { action: 'status' } as never;
    const first = (await runtime.sdpBackend.invoke(status)) as unknown as {
      context: { config: unknown; pb: PocketBase };
    };
    const { pb } = first.context;
    expect(first.context.config).toBe(settings);
    expect(pb.baseURL).toBe('http://127.0.0.1:8090');
    expect(mocks.authenticate).toHaveBeenCalledExactlyOnceWith(
      pb,
      'http://127.0.0.1:8090',
      'fixture-passphrase',
    );
    // A valid sign-in is reused; a token the gateway client dropped is replaced at most once a minute.
    await runtime.sdpBackend.invoke(status);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    pb.authStore.clear();
    await expect(runtime.sdpBackend.invoke(status)).rejects.toThrow(
      'Relay connection unavailable.',
    );
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    vi.setSystemTime(Date.now() + 60_000);
    await runtime.sdpBackend.invoke(status);
    expect(mocks.authenticate).toHaveBeenCalledTimes(2);
    expect(mocks.authenticate.mock.calls[1]?.[0]).toBe(pb);
    // Another server gets its own connection.
    settings.serverUrl = 'http://localhost:8090';
    const moved = (await runtime.sdpBackend.invoke(status)) as unknown as {
      context: { pb: PocketBase };
    };
    expect(moved.context.pb).not.toBe(pb);
    expect(moved.context.pb.baseURL).toBe('http://localhost:8090');
    for (const listener of mocks.quit) listener();
    vi.useRealTimers();
  });

  it('publishes a settings change saved while an earlier discovery publish is in flight', async () => {
    const { runtime, update } = await start();
    const firstWrite = createDeferred<void>();
    update.mockImplementationOnce(() => firstWrite.promise).mockResolvedValue(undefined);
    const status = runtime.sdpServerCommand({ action: 'status' });
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    const cleared = runtime.sdpServerCommand({ action: 'clear', expectedRevision: 'first' });
    firstWrite.resolve();
    await Promise.all([status, cleared]);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]?.[1]).toMatchObject({ enabled: false, revision: '' });
    for (const listener of mocks.quit) listener();
  });

  it('reports SDP as unavailable instead of crashing after quit begins', async () => {
    const { runtime } = await start();
    for (const listener of mocks.quit) listener();
    await expect(runtime.sdpBackend.invoke({ action: 'status' } as never)).resolves.toEqual({
      view: { configured: false, status: 'disconnected' },
    });
    await expect(runtime.sdpServerCommand({ action: 'status' })).rejects.not.toBeInstanceOf(
      TypeError,
    );
  });
});
