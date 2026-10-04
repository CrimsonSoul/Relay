import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred } from '../app/deferred';
import type * as SdpRuntimeModule from './SdpRuntime';

const mocks = vi.hoisted(() => ({
  quit: [] as Array<() => void>,
  settings: null as { revision: string; cacheMinutes: number; client: unknown } | null,
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
vi.mock('./SdpGatewayClient', () => ({ SdpGatewayClient: class {} }));
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

async function start() {
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
  const config = { load: () => ({ mode: 'server', web: { enabled: true, port: 8091 } }) };
  runtime.initializeSdpRuntime({
    getConfig: () => config as never,
    getPb: () => pb as never,
  });
  return { runtime, update };
}

describe('SdpRuntime', () => {
  beforeEach(() => {
    mocks.quit.length = 0;
    mocks.settings = { revision: 'first', cacheMinutes: 60, client: {} };
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
