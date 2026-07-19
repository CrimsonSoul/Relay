import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RELAY_APP_USER_EMAIL } from '@shared/ipc';

const mocks = vi.hoisted(() => ({
  serviceInstances: [] as Array<{
    start: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  KnowledgeSearchService: vi.fn(),
  PocketBase: vi.fn(),
  collection: vi.fn(),
  authWithPassword: vi.fn(),
  getAppConfig: vi.fn(),
  getOfflineCache: vi.fn(),
  getPbClient: vi.fn(),
  getKnowledgeSearchService: vi.fn(),
  setKnowledgeSearchService: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('./KnowledgeSearchService', () => ({
  KnowledgeSearchService: mocks.KnowledgeSearchService,
}));
vi.mock('pocketbase', () => ({ default: mocks.PocketBase }));
vi.mock('../app/appState', () => ({
  getAppConfig: mocks.getAppConfig,
  getOfflineCache: mocks.getOfflineCache,
  getPbClient: mocks.getPbClient,
  getKnowledgeSearchService: mocks.getKnowledgeSearchService,
  setKnowledgeSearchService: mocks.setKnowledgeSearchService,
}));
vi.mock('../logger', () => ({
  loggers: { knowledge: { warn: mocks.warn } },
}));

function createService() {
  const service = {
    start: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  mocks.serviceInstances.push(service);
  return service;
}

describe('knowledge search runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.serviceInstances.length = 0;
    mocks.KnowledgeSearchService.mockImplementation(createService);
    mocks.getKnowledgeSearchService.mockReturnValue(null);
    mocks.getOfflineCache.mockReturnValue({ kind: 'cache' });
    mocks.getPbClient.mockReturnValue({ kind: 'server-client' });
    mocks.authWithPassword.mockResolvedValue({});
    mocks.collection.mockReturnValue({ authWithPassword: mocks.authWithPassword });
    mocks.PocketBase.mockImplementation(
      class MockPocketBase {
        collection = mocks.collection;
      } as never,
    );
  });

  it('hydrates cache before client authentication and then connects the app-user client', async () => {
    mocks.getAppConfig.mockReturnValue({
      load: () => ({
        mode: 'client',
        serverUrl: 'https://relay.example.com',
        secret: 'client-secret',
      }),
    });
    const { restartKnowledgeSearchRuntime } = await import('./knowledgeSearchRuntime');

    await expect(restartKnowledgeSearchRuntime()).resolves.toBeUndefined();

    const service = mocks.serviceInstances[0]!;
    expect(service.start).toHaveBeenCalledWith(null);
    expect(mocks.authWithPassword).toHaveBeenCalledWith(RELAY_APP_USER_EMAIL, 'client-secret', {
      requestKey: null,
    });
    expect(service.start.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.authWithPassword.mock.invocationCallOrder[0] as number,
    );
    expect(service.connect).toHaveBeenCalledWith(expect.anything());
    expect(mocks.setKnowledgeSearchService).toHaveBeenCalledWith(service);
  });

  it('reuses the existing superuser PocketBase client in server mode', async () => {
    mocks.getAppConfig.mockReturnValue({ load: () => ({ mode: 'server' }) });
    const { restartKnowledgeSearchRuntime } = await import('./knowledgeSearchRuntime');

    await restartKnowledgeSearchRuntime();

    expect(mocks.serviceInstances[0]!.start).toHaveBeenCalledWith({ kind: 'server-client' });
    expect(mocks.PocketBase).not.toHaveBeenCalled();
  });

  it.each(['startup', 'authentication', 'connection'] as const)(
    'contains %s failure and retains the best-effort service owner',
    async (failure) => {
      mocks.getAppConfig.mockReturnValue({
        load: () => ({
          mode: 'client',
          serverUrl: 'https://relay.example.com',
          secret: 'client-secret',
        }),
      });
      const service = createService();
      mocks.KnowledgeSearchService.mockImplementationOnce(function MockKnowledgeSearchService() {
        return service;
      });
      if (failure === 'startup') service.start.mockRejectedValueOnce(new Error('cache failed'));
      if (failure === 'authentication') {
        mocks.authWithPassword.mockRejectedValueOnce(new Error('auth failed'));
      }
      if (failure === 'connection')
        service.connect.mockRejectedValueOnce(new Error('subscribe failed'));
      const { restartKnowledgeSearchRuntime } = await import('./knowledgeSearchRuntime');

      await expect(restartKnowledgeSearchRuntime()).resolves.toBeUndefined();

      expect(mocks.setKnowledgeSearchService).toHaveBeenCalledWith(service);
      expect(mocks.warn).toHaveBeenCalledWith(
        'Enhanced Wiki search is unavailable',
        expect.objectContaining({ error: expect.any(Error) }),
      );
    },
  );

  it('disposes and clears the current service during stop and before reconfigure', async () => {
    const previous = createService();
    mocks.getKnowledgeSearchService.mockReturnValueOnce(previous).mockReturnValue(null);
    mocks.getAppConfig.mockReturnValue(null);
    const { restartKnowledgeSearchRuntime, stopKnowledgeSearchRuntime } =
      await import('./knowledgeSearchRuntime');

    await restartKnowledgeSearchRuntime();
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(mocks.setKnowledgeSearchService).toHaveBeenCalledWith(null);

    const current = mocks.serviceInstances.at(-1)!;
    mocks.getKnowledgeSearchService.mockReturnValue(current);
    await expect(stopKnowledgeSearchRuntime()).resolves.toBeUndefined();
    expect(current.dispose).toHaveBeenCalledOnce();
    expect(mocks.setKnowledgeSearchService).toHaveBeenLastCalledWith(null);
  });

  it('contains disposal failure and still clears ownership', async () => {
    const previous = createService();
    previous.dispose.mockRejectedValueOnce(new Error('dispose failed'));
    mocks.getKnowledgeSearchService.mockReturnValue(previous);
    const { stopKnowledgeSearchRuntime } = await import('./knowledgeSearchRuntime');

    await expect(stopKnowledgeSearchRuntime()).resolves.toBeUndefined();
    expect(mocks.setKnowledgeSearchService).toHaveBeenCalledWith(null);
    expect(mocks.warn).toHaveBeenCalled();
  });
});
