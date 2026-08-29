import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dialog, ipcMain, shell } from 'electron';
import { open, rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc';
import { loggers } from '../logger';
import { rateLimiters } from '../rateLimiter';
import { setupKnowledgeHandlers } from './knowledgeHandlers';

const trusted = vi.fn((..._args: unknown[]) => true);
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { openExternal: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
}));
vi.mock('node:fs/promises', () => ({ open: vi.fn(), rename: vi.fn(), rm: vi.fn() }));
vi.mock('../logger', () => ({
  loggers: {
    ipc: { warn: vi.fn() },
    security: { warn: vi.fn() },
  },
}));
vi.mock('../rateLimiter', () => ({
  rateLimiters: {
    fsOperations: { tryConsume: vi.fn(() => ({ allowed: true })) },
  },
}));
vi.mock('../utils/trustedSender', () => ({
  assertTrustedIpcSender: (...args: unknown[]) => trusted(...args),
}));

describe('knowledgeHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const getHandler = (channel: string): ((...args: unknown[]) => unknown) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler;
  };
  const listeners: Record<string, (...args: unknown[]) => unknown> = {};
  const getListener = (channel: string): ((...args: unknown[]) => unknown) => {
    const listener = listeners[channel];
    if (!listener) throw new Error(`No listener registered for ${channel}`);
    return listener;
  };
  const getPdf = vi.fn();
  const writePdfBytes = vi.fn();
  const syncPdfBytes = vi.fn();
  const closePdfFile = vi.fn();
  const service = { getPdf };
  const getCover = vi.fn();
  const coverService = { getCover };
  const getStatus = vi.fn(() => ({
    state: 'idle' as const,
    documentCount: 3,
    categoryCount: 2,
    lastIndexedAt: '2026-07-14T12:00:00.000Z',
  }));
  const indexStatusService = { getStatus };
  const selectAndQueue = vi.fn();
  const snapshot = vi.fn(() => ({
    restartRecovery: false,
    activeBatchId: null,
    totalBytes: 0,
    acknowledgedBytes: 0,
    items: [],
  }));
  const refresh = vi.fn(async () => snapshot());
  const pauseBatch = vi.fn();
  const resumeBatch = vi.fn();
  const retryUpload = vi.fn();
  const reselectSource = vi.fn();
  const cancelUpload = vi.fn();
  const cancelBatch = vi.fn();
  const uploadService = {
    selectAndQueue,
    snapshot,
    refresh,
    pauseBatch,
    resumeBatch,
    retryUpload,
    reselectSource,
    cancelUpload,
    cancelBatch,
  };
  const search = vi.fn();
  const cancel = vi.fn();
  const searchService = { search, cancel };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS;
    trusted.mockReturnValue(true);
    vi.mocked(rateLimiters.fsOperations.tryConsume).mockReturnValue({ allowed: true });
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: true,
      filePath: undefined,
    } as never);
    writePdfBytes.mockResolvedValue(undefined);
    syncPdfBytes.mockResolvedValue(undefined);
    closePdfFile.mockResolvedValue(undefined);
    vi.mocked(open).mockResolvedValue({
      writeFile: writePdfBytes,
      sync: syncPdfBytes,
      close: closePdfFile,
    } as never);
    vi.mocked(rename).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as (...args: unknown[]) => unknown;
      return ipcMain;
    });
    vi.mocked(ipcMain.on).mockImplementation((channel, listener) => {
      listeners[channel] = listener as (...args: unknown[]) => unknown;
      return ipcMain;
    });
    setupKnowledgeHandlers(
      () => service as never,
      () => indexStatusService as never,
      () => uploadService as never,
      () => coverService as never,
      () => searchService as never,
    );
  });

  it('validates and forwards a trusted search request without exposing storage filters', async () => {
    const request = {
      requestId: 'search-request-1',
      query: '  failvoer ',
      scope: { kind: 'all' },
      categoryId: null,
      documentType: null,
      limit: 20,
    };
    search.mockResolvedValue({
      ok: true,
      requestId: request.requestId,
      availability: 'ready',
      normalizedQuery: 'failvoer',
      results: [],
    });

    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_SEARCH)({}, request)).resolves.toMatchObject({
      ok: true,
      normalizedQuery: 'failvoer',
    });
    expect(search).toHaveBeenCalledWith({ ...request, query: 'failvoer' });
  });

  it('returns stable typed errors for untrusted, malformed, absent, and throwing search services', async () => {
    const request = {
      requestId: 'search-request-1',
      query: 'failover',
      scope: { kind: 'all' },
      categoryId: null,
      documentType: null,
      limit: 20,
    };
    trusted.mockReturnValueOnce(false);
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_SEARCH)({}, request)).resolves.toEqual({
      ok: false,
      requestId: request.requestId,
      error: 'invalid-query',
    });
    await expect(
      getHandler(IPC_CHANNELS.KNOWLEDGE_SEARCH)({}, { ...request, filter: 'title ~ "secret"' }),
    ).resolves.toEqual({ ok: false, requestId: request.requestId, error: 'invalid-query' });

    setupKnowledgeHandlers(
      () => null,
      () => null,
      () => null,
      () => null,
      () => null,
    );
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_SEARCH)({}, request)).resolves.toEqual({
      ok: false,
      requestId: request.requestId,
      error: 'unavailable',
    });

    search.mockRejectedValueOnce(new Error('engine failed'));
    setupKnowledgeHandlers(
      () => null,
      () => null,
      () => null,
      () => null,
      () => searchService as never,
    );
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_SEARCH)({}, request)).resolves.toEqual({
      ok: false,
      requestId: request.requestId,
      error: 'unavailable',
    });
  });

  it('cancels only trusted requests with a strict request identifier', () => {
    getListener(IPC_CHANNELS.KNOWLEDGE_SEARCH_CANCEL)({}, 'search-request-1');
    expect(cancel).toHaveBeenCalledWith('search-request-1');

    getListener(IPC_CHANNELS.KNOWLEDGE_SEARCH_CANCEL)({}, '../escape');
    trusted.mockReturnValueOnce(false);
    getListener(IPC_CHANNELS.KNOWLEDGE_SEARCH_CANCEL)({}, 'search-request-2');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  function getOpenWebLinkHandler(): (...args: unknown[]) => Promise<unknown> {
    const handler = handlers['knowledge:openWebLink'];
    expect(handler).toBeTypeOf('function');
    return handler as (...args: unknown[]) => Promise<unknown>;
  }

  it('validates and forwards a trusted PDF request', async () => {
    const request = { documentId: 'document123', checksum: 'a'.repeat(64) };
    getPdf.mockResolvedValue({
      ok: true,
      data: new ArrayBuffer(4),
      checksum: request.checksum,
      source: 'cache',
    });

    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_GET_PDF)({}, request)).resolves.toMatchObject({
      ok: true,
      source: 'cache',
    });
    expect(getPdf).toHaveBeenCalledWith(request);
  });

  it('atomically publishes verified PDF bytes under a safe authored filename', async () => {
    const request = {
      documentId: 'document123',
      checksum: 'a'.repeat(64),
      fileName: 'Ops: East*Recovery.pdf',
    };
    const data = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
    const destinationPath = resolve('managed', 'user-selected', 'Ops_ East_Recovery.pdf');
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: destinationPath,
    } as never);
    getPdf.mockResolvedValue({ ok: true, data, checksum: request.checksum, source: 'cache' });

    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_DOWNLOAD_PDF)({}, request)).resolves.toEqual({
      ok: true,
    });

    expect(dialog.showSaveDialog).toHaveBeenCalledWith({
      defaultPath: 'Ops_ East_Recovery.pdf',
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    expect(getPdf).toHaveBeenCalledWith({
      documentId: request.documentId,
      checksum: request.checksum,
    });
    const temporaryPath = vi.mocked(open).mock.calls[0]?.[0];
    expect(dirname(String(temporaryPath))).toBe(dirname(destinationPath));
    expect(basename(String(temporaryPath))).toMatch(/^\.relay-download-[0-9a-f-]+\.tmp$/u);
    expect(open).toHaveBeenCalledWith(temporaryPath, 'wx', 0o600);
    expect(writePdfBytes).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(syncPdfBytes).toHaveBeenCalledOnce();
    expect(closePdfFile).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledWith(temporaryPath, destinationPath);
    expect(rm).toHaveBeenCalledWith(temporaryPath, { force: true });
    expect(syncPdfBytes.mock.invocationCallOrder[0]).toBeLessThan(
      closePdfFile.mock.invocationCallOrder[0]!,
    );
    expect(closePdfFile.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(rename).mock.invocationCallOrder[0]!,
    );
  });

  it('keeps the atomic temporary component short for a maximum-length destination name', async () => {
    const fileName = `${'a'.repeat(236)}.pdf`;
    const filePath = `/managed/user-selected/${fileName}`;
    const request = { documentId: 'document123', checksum: 'a'.repeat(64), fileName };
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath } as never);
    getPdf.mockResolvedValue({
      ok: true,
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
      checksum: request.checksum,
      source: 'cache',
    });

    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_DOWNLOAD_PDF)({}, request)).resolves.toEqual({
      ok: true,
    });

    const temporaryPath = String(vi.mocked(open).mock.calls[0]?.[0]);
    expect(basename(temporaryPath)).toMatch(/^\.relay-download-[0-9a-f-]+\.tmp$/u);
    expect([...basename(temporaryPath)]).toHaveLength(56);
    expect(rename).toHaveBeenCalledWith(temporaryPath, filePath);
  });

  it('does not fetch or write PDF bytes when the save dialog is cancelled', async () => {
    const request = {
      documentId: 'document123',
      checksum: 'a'.repeat(64),
      fileName: 'Guide.pdf',
    };

    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_DOWNLOAD_PDF)({}, request)).resolves.toEqual({
      ok: false,
      error: 'cancelled',
    });

    expect(getPdf).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects untrusted and renderer-path download requests before any file dialog', async () => {
    const request = {
      documentId: 'document123',
      checksum: 'a'.repeat(64),
      fileName: 'Guide.pdf',
    };
    trusted.mockReturnValueOnce(false);

    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_DOWNLOAD_PDF)({}, request)).resolves.toEqual({
      ok: false,
      error: 'invalid-document',
    });
    await expect(
      getHandler(IPC_CHANNELS.KNOWLEDGE_DOWNLOAD_PDF)(
        {},
        {
          ...request,
          fileName: '../outside.pdf',
        },
      ),
    ).resolves.toEqual({ ok: false, error: 'invalid-document' });

    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
    expect(getPdf).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects rate-limited, unavailable, and E2E-suppressed saves before the dialog', async () => {
    const request = {
      documentId: 'document123',
      checksum: 'a'.repeat(64),
      fileName: 'Guide.pdf',
    };
    vi.mocked(rateLimiters.fsOperations.tryConsume).mockReturnValueOnce({ allowed: false });
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_DOWNLOAD_PDF)({}, request)).resolves.toEqual({
      ok: false,
      error: 'rate-limited',
    });

    setupKnowledgeHandlers(
      () => null,
      () => indexStatusService as never,
      () => uploadService as never,
      () => coverService as never,
      () => searchService as never,
    );
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_DOWNLOAD_PDF)({}, request)).resolves.toEqual({
      ok: false,
      error: 'not-found',
    });

    process.env.RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS = '1';
    setupKnowledgeHandlers(
      () => service as never,
      () => indexStatusService as never,
      () => uploadService as never,
      () => coverService as never,
      () => searchService as never,
    );
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_DOWNLOAD_PDF)({}, request)).resolves.toEqual({
      ok: false,
      error: 'cancelled',
    });

    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
    expect(getPdf).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('does not create a destination when verified PDF retrieval fails', async () => {
    const request = {
      documentId: 'document123',
      checksum: 'a'.repeat(64),
      fileName: 'Guide.pdf',
    };
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/managed/user-selected/Guide.pdf',
    } as never);
    getPdf.mockResolvedValue({ ok: false, error: 'download-failed' });

    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_DOWNLOAD_PDF)({}, request)).resolves.toEqual({
      ok: false,
      error: 'download-failed',
    });
    expect(open).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it('removes a failed temporary write without replacing the selected destination', async () => {
    const request = {
      documentId: 'document123',
      checksum: 'a'.repeat(64),
      fileName: 'Guide.pdf',
    };
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/managed/user-selected/Existing Guide.pdf',
    } as never);
    getPdf.mockResolvedValue({
      ok: true,
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
      checksum: request.checksum,
      source: 'cache',
    });
    writePdfBytes.mockRejectedValueOnce(new Error('disk full'));

    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_DOWNLOAD_PDF)({}, request)).resolves.toEqual({
      ok: false,
      error: 'save-failed',
    });

    const temporaryPath = vi.mocked(open).mock.calls[0]?.[0];
    expect(temporaryPath).not.toBe('/managed/user-selected/Existing Guide.pdf');
    expect(rename).not.toHaveBeenCalled();
    expect(closePdfFile).toHaveBeenCalledOnce();
    expect(rm).toHaveBeenCalledWith(temporaryPath, { force: true });
  });

  it('validates and forwards a trusted cover request', async () => {
    const request = { documentId: 'document123', checksum: 'a'.repeat(64) };
    getCover.mockResolvedValue({ ok: true, data: new ArrayBuffer(8), ...request, source: 'cache' });
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_GET_COVER)({}, request)).resolves.toMatchObject({
      ok: true,
      source: 'cache',
    });
    expect(getCover).toHaveBeenCalledWith(request);
  });

  it('rejects untrusted and malformed PDF requests before the service', async () => {
    trusted.mockReturnValueOnce(false);
    await expect(
      getHandler(IPC_CHANNELS.KNOWLEDGE_GET_PDF)(
        {},
        {
          documentId: 'document123',
          checksum: 'a'.repeat(64),
        },
      ),
    ).resolves.toEqual({ ok: false, error: 'invalid-document' });
    await expect(
      getHandler(IPC_CHANNELS.KNOWLEDGE_GET_PDF)(
        {},
        {
          documentId: '../outside',
          checksum: 'short',
        },
      ),
    ).resolves.toEqual({ ok: false, error: 'invalid-document' });
    expect(getPdf).not.toHaveBeenCalled();
  });

  it('returns a bounded fallback when the PDF service is unavailable', async () => {
    setupKnowledgeHandlers(
      () => null,
      () => null,
    );
    const request = { documentId: 'document123', checksum: 'a'.repeat(64) };

    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_GET_PDF)({}, request)).resolves.toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('returns PocketBase-derived status or a stable idle fallback', async () => {
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_GET_INDEX_STATUS)({})).resolves.toMatchObject({
      documentCount: 3,
      categoryCount: 2,
    });

    setupKnowledgeHandlers(
      () => null,
      () => null,
    );
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_GET_INDEX_STATUS)({})).resolves.toEqual({
      state: 'idle',
      documentCount: 0,
      categoryCount: 0,
      lastIndexedAt: null,
    });
  });

  it('forwards only a bounded replacement document identity to upload selection', async () => {
    selectAndQueue.mockResolvedValue({ ok: false, error: 'cancelled' });
    await expect(
      getHandler(IPC_CHANNELS.KNOWLEDGE_SELECT_AND_STAGE)({}, 'document-1'),
    ).resolves.toEqual({ ok: false, error: 'cancelled' });
    expect(selectAndQueue).toHaveBeenCalledWith(undefined, 'document-1');

    selectAndQueue.mockClear();
    await expect(
      getHandler(IPC_CHANNELS.KNOWLEDGE_SELECT_AND_STAGE)({}, '/renderer/cannot/pass/a/path.pdf'),
    ).resolves.toEqual({ ok: false, error: 'invalid-file' });
    expect(selectAndQueue).not.toHaveBeenCalled();

    trusted.mockReturnValueOnce(false);
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_SELECT_AND_STAGE)({})).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('exposes safe queue controls and never accepts renderer file paths', async () => {
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_UPLOAD_QUEUE_GET)({})).resolves.toEqual(
      snapshot(),
    );
    await getHandler(IPC_CHANNELS.KNOWLEDGE_UPLOAD_BATCH_PAUSE)({}, 'batch-1');
    await getHandler(IPC_CHANNELS.KNOWLEDGE_UPLOAD_BATCH_RESUME)({}, 'batch-1');
    await getHandler(IPC_CHANNELS.KNOWLEDGE_UPLOAD_RETRY)({}, 'upload-1');
    await getHandler(IPC_CHANNELS.KNOWLEDGE_UPLOAD_RESELECT)({}, 'upload-1', '/renderer/path.pdf');
    await getHandler(IPC_CHANNELS.KNOWLEDGE_UPLOAD_FILE_CANCEL)({}, 'upload-1');
    await getHandler(IPC_CHANNELS.KNOWLEDGE_UPLOAD_BATCH_CANCEL)({}, 'batch-1');

    expect(pauseBatch).toHaveBeenCalledWith('batch-1');
    expect(resumeBatch).toHaveBeenCalledWith('batch-1');
    expect(retryUpload).toHaveBeenCalledWith('upload-1');
    expect(reselectSource).toHaveBeenCalledWith('upload-1');
    expect(cancelUpload).toHaveBeenCalledWith('upload-1');
    expect(cancelBatch).toHaveBeenCalledWith('batch-1');

    await getHandler(IPC_CHANNELS.KNOWLEDGE_UPLOAD_RETRY)({}, '../outside.pdf');
    expect(retryUpload).toHaveBeenCalledTimes(1);
  });

  it('reports a control failure instead of claiming the request succeeded', async () => {
    reselectSource.mockResolvedValueOnce(false);

    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_UPLOAD_RESELECT)({}, 'upload-1')).resolves.toBe(
      false,
    );

    reselectSource.mockResolvedValueOnce(true);
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_UPLOAD_RESELECT)({}, 'upload-1')).resolves.toBe(
      true,
    );
    // Void controls have no outcome of their own, so dispatch still counts as success.
    await expect(getHandler(IPC_CHANNELS.KNOWLEDGE_UPLOAD_RETRY)({}, 'upload-1')).resolves.toBe(
      true,
    );
  });

  describe('KNOWLEDGE_OPEN_WEB_LINK', () => {
    it('rejects an untrusted sender before rate limiting or opening', async () => {
      trusted.mockReturnValueOnce(false);

      await expect(
        getOpenWebLinkHandler()({}, 'https://docs.example.com/runbook'),
      ).resolves.toEqual({ ok: false, error: 'invalid-url' });
      expect(rateLimiters.fsOperations.tryConsume).not.toHaveBeenCalled();
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('returns rate-limited when the filesystem operation budget is exhausted', async () => {
      vi.mocked(rateLimiters.fsOperations.tryConsume).mockReturnValueOnce({ allowed: false });

      await expect(
        getOpenWebLinkHandler()({}, 'https://docs.example.com/runbook'),
      ).resolves.toEqual({ ok: false, error: 'rate-limited' });
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it.each([
      ['unsupported scheme', 'javascript:alert(1)'],
      ['non-string value', { url: 'https://docs.example.com/runbook' }],
    ])('rejects %s without calling shell.openExternal', async (_label, value) => {
      await expect(getOpenWebLinkHandler()({}, value)).resolves.toEqual({
        ok: false,
        error: 'invalid-url',
      });
      expect(shell.openExternal).not.toHaveBeenCalled();
      expect(loggers.security.warn).toHaveBeenCalledWith('Blocked unsupported Knowledge web link');
    });

    it.each([
      ['https://docs.example.com/runbook', 'https://docs.example.com/runbook'],
      // Plain HTTP is intentionally supported for internal Knowledge runbooks.
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      ['http://INTRANET.Example.local/status', 'http://intranet.example.local/status'],
    ])('opens valid Knowledge web link %s', async (value, normalized) => {
      await expect(getOpenWebLinkHandler()({}, value)).resolves.toEqual({ ok: true });
      expect(shell.openExternal).toHaveBeenCalledWith(normalized);
    });

    it('accepts a valid E2E Knowledge link without opening a desktop app', async () => {
      process.env.NODE_ENV = 'test';
      process.env.RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS = '1';

      await expect(
        getOpenWebLinkHandler()({}, 'https://docs.example.com/runbook'),
      ).resolves.toEqual({ ok: true });
      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('returns open-failed when shell.openExternal rejects', async () => {
      vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('external handler rejected'));

      await expect(
        getOpenWebLinkHandler()({}, 'https://docs.example.com/runbook'),
      ).resolves.toEqual({ ok: false, error: 'open-failed' });
      expect(loggers.ipc.warn).toHaveBeenCalledWith('Knowledge web link open failed');
    });

    it('returns open-failed when shell.openExternal throws synchronously', async () => {
      vi.mocked(shell.openExternal).mockImplementationOnce(() => {
        throw new Error('external handler threw');
      });

      await expect(
        getOpenWebLinkHandler()({}, 'https://docs.example.com/runbook'),
      ).resolves.toEqual({ ok: false, error: 'open-failed' });
      expect(loggers.ipc.warn).toHaveBeenCalledWith('Knowledge web link open failed');
    });

    it('does not log a URL included in the shell failure', async () => {
      const url = 'https://docs.example.com/runbook?token=secret';
      vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error(`No handler for ${url}`));

      await expect(getOpenWebLinkHandler()({}, url)).resolves.toEqual({
        ok: false,
        error: 'open-failed',
      });

      expect(loggers.ipc.warn).toHaveBeenCalledWith('Knowledge web link open failed');
      const loggedValues = JSON.stringify(vi.mocked(loggers.ipc.warn).mock.calls);
      expect(loggedValues).not.toContain(url);
      expect(loggedValues).not.toContain('token=secret');
    });
  });
});
