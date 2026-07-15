import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: { load: vi.fn() },
  getAppConfig: vi.fn(),
  getPbClient: vi.fn(),
  getOfflineCache: vi.fn(),
  getKnowledgeBaseManager: vi.fn(),
  getKnowledgePdfService: vi.fn(),
  setKnowledgeBaseManager: vi.fn(),
  setKnowledgePdfService: vi.fn(),
  managerStart: vi.fn(async () => undefined),
  managerStop: vi.fn(async () => undefined),
  managerConstructor: vi.fn(),
  cleanup: vi.fn(async () => undefined),
  pdfConstructor: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('../app/appState', () => ({
  getAppConfig: mocks.getAppConfig,
  getPbClient: mocks.getPbClient,
  getOfflineCache: mocks.getOfflineCache,
  getKnowledgeBaseManager: mocks.getKnowledgeBaseManager,
  getKnowledgePdfService: mocks.getKnowledgePdfService,
  setKnowledgeBaseManager: mocks.setKnowledgeBaseManager,
  setKnowledgePdfService: mocks.setKnowledgePdfService,
}));

vi.mock('./KnowledgeBaseManager', () => ({
  KnowledgeBaseManager: vi.fn(function MockKnowledgeBaseManager(options) {
    mocks.managerConstructor(options);
    return { start: mocks.managerStart, stop: mocks.managerStop };
  }),
}));

vi.mock('./KnowledgePdfService', () => ({
  KnowledgePdfService: vi.fn(function MockKnowledgePdfService(options) {
    mocks.pdfConstructor(options);
    return { cleanup: mocks.cleanup };
  }),
}));

vi.mock('../utils/broadcastToAllWindows', () => ({
  broadcastToAllWindows: mocks.broadcast,
}));

describe('knowledgeRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAppConfig.mockReturnValue(mocks.config);
    mocks.config.load.mockReturnValue({
      mode: 'server',
      port: 8090,
      bindHost: '0.0.0.0',
      secret: 'secret',
    });
    mocks.getPbClient.mockReturnValue({ collection: vi.fn() });
    mocks.getKnowledgeBaseManager.mockReturnValue(null);
    mocks.getKnowledgePdfService.mockReturnValue(null);
    mocks.getOfflineCache.mockReturnValue(null);
  });

  it('creates the PDF service in either Relay mode', async () => {
    const { initializeKnowledgePdfService } = await import('./knowledgeRuntime');

    const service = initializeKnowledgePdfService('/relay/data');

    expect(mocks.pdfConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ configDataDir: '/relay/data' }),
    );
    expect(mocks.setKnowledgePdfService).toHaveBeenCalledWith(service);
  });

  it('starts a server manager after replacing any previous manager', async () => {
    const previous = { stop: vi.fn(async () => undefined) };
    mocks.getKnowledgeBaseManager.mockReturnValue(previous);
    const { startKnowledgeBaseManager } = await import('./knowledgeRuntime');

    await startKnowledgeBaseManager('/relay/data');

    expect(previous.stop).toHaveBeenCalledOnce();
    expect(mocks.managerConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ root: '/relay/data/knowledge-base' }),
    );
    expect(mocks.managerStart).toHaveBeenCalledOnce();
    expect(mocks.setKnowledgeBaseManager).toHaveBeenLastCalledWith(
      expect.objectContaining({ start: mocks.managerStart }),
    );
  });

  it('does not start a manager outside server mode or before PocketBase is ready', async () => {
    const { startKnowledgeBaseManager } = await import('./knowledgeRuntime');
    mocks.config.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'secret',
    });
    await startKnowledgeBaseManager('/relay/data');
    expect(mocks.managerStart).not.toHaveBeenCalled();

    mocks.config.load.mockReturnValue({
      mode: 'server',
      port: 8090,
      bindHost: '0.0.0.0',
      secret: 'secret',
    });
    mocks.getPbClient.mockReturnValue(null);
    await startKnowledgeBaseManager('/relay/data');
    expect(mocks.managerStart).not.toHaveBeenCalled();
  });

  it('passes cached metadata checksums into daily PDF cache cleanup', async () => {
    const service = { cleanup: mocks.cleanup };
    mocks.getKnowledgePdfService.mockReturnValue(service);
    mocks.getOfflineCache.mockReturnValue({
      readCollection: vi.fn(() => [
        { checksum: 'a'.repeat(64) },
        { checksum: 'invalid' },
        { checksum: 'b'.repeat(64) },
      ]),
    });
    mocks.config.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'secret',
    });
    const { cleanupKnowledgePdfCache } = await import('./knowledgeRuntime');

    await cleanupKnowledgePdfCache();

    expect(mocks.cleanup).toHaveBeenCalledWith(new Set(['a'.repeat(64), 'b'.repeat(64)]));
  });
});
