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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('knowledge search runtime', () => {
  beforeEach(() => {
    vi.useRealTimers();
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
      signal: expect.any(AbortSignal),
    });
    expect(service.start.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.authWithPassword.mock.invocationCallOrder[0] as number,
    );
    expect(service.connect).toHaveBeenCalledWith(expect.anything());
    expect(mocks.setKnowledgeSearchService).toHaveBeenCalledWith(service);
    expect(mocks.KnowledgeSearchService).toHaveBeenCalledWith({
      cache: { kind: 'cache' },
      cacheIdentity: 'https://relay.example.com',
    });
  });

  it('reuses the existing superuser PocketBase client in server mode', async () => {
    mocks.getAppConfig.mockReturnValue({ load: () => ({ mode: 'server' }) });
    const { restartKnowledgeSearchRuntime } = await import('./knowledgeSearchRuntime');

    await restartKnowledgeSearchRuntime();

    expect(mocks.serviceInstances[0]!.start).toHaveBeenCalledWith({ kind: 'server-client' });
    expect(mocks.PocketBase).not.toHaveBeenCalled();
    expect(mocks.KnowledgeSearchService).toHaveBeenCalledWith({ cache: null });
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

  it('invalidates ownership synchronously when restart or stop is requested', async () => {
    const previous = createService();
    mocks.getKnowledgeSearchService.mockReturnValue(previous);
    mocks.getAppConfig.mockReturnValue(null);
    const { restartKnowledgeSearchRuntime, stopKnowledgeSearchRuntime } =
      await import('./knowledgeSearchRuntime');

    const restart = restartKnowledgeSearchRuntime();
    expect(mocks.setKnowledgeSearchService).toHaveBeenCalledWith(null);
    expect(previous.dispose).toHaveBeenCalledOnce();
    await restart;

    mocks.setKnowledgeSearchService.mockClear();
    const stop = stopKnowledgeSearchRuntime();
    expect(mocks.setKnowledgeSearchService).toHaveBeenCalledWith(null);
    await stop;
  });

  it('bounds hung authentication so stop and a later restart are not pinned', async () => {
    vi.useFakeTimers();
    let authenticationSignal: AbortSignal | undefined;
    mocks.getAppConfig.mockReturnValue({
      load: () => ({
        mode: 'client',
        serverUrl: 'https://relay.example.com',
        secret: 'client-secret',
      }),
    });
    mocks.authWithPassword.mockImplementationOnce(
      (_email: string, _secret: string, options: { signal: AbortSignal }) => {
        authenticationSignal = options.signal;
        return new Promise(() => undefined);
      },
    );
    const { restartKnowledgeSearchRuntime, stopKnowledgeSearchRuntime } =
      await import('./knowledgeSearchRuntime');

    const restart = restartKnowledgeSearchRuntime();
    await vi.waitFor(() => expect(mocks.authWithPassword).toHaveBeenCalledOnce());
    const stop = stopKnowledgeSearchRuntime();
    expect(mocks.setKnowledgeSearchService).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(20_000);

    await expect(restart).resolves.toBeUndefined();
    await expect(stop).resolves.toBeUndefined();
    expect(authenticationSignal?.aborted).toBe(true);
  });

  it('contains a throwing config load inside the best-effort restart boundary', async () => {
    mocks.getAppConfig.mockReturnValue({
      load: () => {
        throw new Error('config unavailable');
      },
    });
    const { restartKnowledgeSearchRuntime } = await import('./knowledgeSearchRuntime');

    await expect(restartKnowledgeSearchRuntime()).resolves.toBeUndefined();

    expect(mocks.warn).toHaveBeenCalledWith(
      'Enhanced Wiki search is unavailable',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('bounds a hung service disposal so reconfiguration can continue', async () => {
    vi.useFakeTimers();
    const previous = createService();
    previous.dispose.mockImplementationOnce(() => new Promise(() => undefined));
    mocks.getKnowledgeSearchService.mockReturnValue(previous);
    mocks.getAppConfig.mockReturnValue(null);
    const { restartKnowledgeSearchRuntime } = await import('./knowledgeSearchRuntime');

    const restart = restartKnowledgeSearchRuntime();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(restart).resolves.toBeUndefined();
  });

  it('does not restore an older restart generation after a newer request owns the lifecycle', async () => {
    const firstStart = deferred<void>();
    const firstService = createService();
    firstService.start.mockImplementationOnce(() => firstStart.promise);
    const secondService = createService();
    mocks.KnowledgeSearchService.mockImplementationOnce(function FirstKnowledgeSearchService() {
      return firstService;
    }).mockImplementationOnce(function SecondKnowledgeSearchService() {
      return secondService;
    });
    mocks.getAppConfig.mockReturnValue({ load: () => ({ mode: 'server' }) });
    const { restartKnowledgeSearchRuntime } = await import('./knowledgeSearchRuntime');

    const firstRestart = restartKnowledgeSearchRuntime();
    await vi.waitFor(() => expect(firstService.start).toHaveBeenCalledOnce());
    const secondRestart = restartKnowledgeSearchRuntime();
    firstStart.resolve();
    await Promise.all([firstRestart, secondRestart]);

    expect(mocks.setKnowledgeSearchService).toHaveBeenLastCalledWith(secondService);
  });

  it('invokes disposal immediately to unblock a service owned by an earlier lifecycle turn', async () => {
    const firstStart = deferred<void>();
    const firstService = createService();
    firstService.start.mockImplementationOnce(() => firstStart.promise);
    firstService.dispose.mockImplementationOnce(() => {
      firstStart.resolve();
      return Promise.resolve();
    });
    const secondService = createService();
    mocks.KnowledgeSearchService.mockImplementationOnce(function FirstKnowledgeSearchService() {
      return firstService;
    }).mockImplementationOnce(function SecondKnowledgeSearchService() {
      return secondService;
    });
    mocks.getAppConfig.mockReturnValue({ load: () => ({ mode: 'server' }) });
    const { restartKnowledgeSearchRuntime } = await import('./knowledgeSearchRuntime');

    const firstRestart = restartKnowledgeSearchRuntime();
    await vi.waitFor(() => expect(firstService.start).toHaveBeenCalledOnce());
    mocks.getKnowledgeSearchService.mockReturnValue(firstService);
    const secondRestart = restartKnowledgeSearchRuntime();

    expect(firstService.dispose).toHaveBeenCalledOnce();
    await Promise.all([firstRestart, secondRestart]);
    expect(mocks.setKnowledgeSearchService).toHaveBeenLastCalledWith(secondService);
  });
});
