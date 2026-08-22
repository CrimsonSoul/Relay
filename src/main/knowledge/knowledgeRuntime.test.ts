import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: { load: vi.fn() },
  getAppConfig: vi.fn(),
  getPbClient: vi.fn(),
  getOfflineCache: vi.fn(),
  getKnowledgePdfService: vi.fn(),
  getKnowledgeCoverService: vi.fn(),
  setKnowledgePdfService: vi.fn(),
  setKnowledgeCoverService: vi.fn(),
  cleanup: vi.fn(async () => undefined),
  coverCleanup: vi.fn(async () => undefined),
  pdfConstructor: vi.fn(),
  coverConstructor: vi.fn(),
}));

vi.mock('../app/appState', () => ({
  getAppConfig: mocks.getAppConfig,
  getPbClient: mocks.getPbClient,
  getOfflineCache: mocks.getOfflineCache,
  getKnowledgePdfService: mocks.getKnowledgePdfService,
  getKnowledgeCoverService: mocks.getKnowledgeCoverService,
  setKnowledgePdfService: mocks.setKnowledgePdfService,
  setKnowledgeCoverService: mocks.setKnowledgeCoverService,
}));

vi.mock('./KnowledgePdfService', () => ({
  KnowledgePdfService: vi.fn(function MockKnowledgePdfService(options) {
    mocks.pdfConstructor(options);
    return { cleanup: mocks.cleanup };
  }),
}));

vi.mock('./KnowledgeCoverService', () => ({
  KnowledgeCoverService: vi.fn(function MockKnowledgeCoverService(options) {
    mocks.coverConstructor(options);
    return { cleanup: mocks.coverCleanup };
  }),
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
    mocks.getKnowledgePdfService.mockReturnValue(null);
    mocks.getKnowledgeCoverService.mockReturnValue(null);
    mocks.getOfflineCache.mockReturnValue(null);
  });

  it('creates the PDF service in either Relay mode', async () => {
    const { initializeKnowledgePdfService } = await import('./knowledgeRuntime');

    const service = initializeKnowledgePdfService('/relay/data');

    expect(mocks.pdfConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ configDataDir: '/relay/data' }),
    );
    expect(mocks.setKnowledgePdfService).toHaveBeenCalledWith(service);
    expect(mocks.coverConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ configDataDir: '/relay/data' }),
    );
    expect(mocks.setKnowledgeCoverService).toHaveBeenCalledWith(
      expect.objectContaining({ cleanup: mocks.coverCleanup }),
    );
  });

  it('does not expose a folder manager lifecycle', async () => {
    const runtime = await import('./knowledgeRuntime');

    expect(runtime).not.toHaveProperty('startKnowledgeBaseManager');
    expect(runtime).not.toHaveProperty('stopKnowledgeBaseManager');
  });

  it('passes cached metadata checksums into daily PDF cache cleanup', async () => {
    const service = { cleanup: mocks.cleanup };
    mocks.getKnowledgePdfService.mockReturnValue(service);
    mocks.getKnowledgeCoverService.mockReturnValue({ cleanup: mocks.coverCleanup });
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
    expect(mocks.coverCleanup).toHaveBeenCalledWith(new Set(['a'.repeat(64), 'b'.repeat(64)]));
  });
});
