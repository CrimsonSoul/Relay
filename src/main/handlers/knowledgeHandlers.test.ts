import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { loggers } from '../logger';
import { rateLimiters } from '../rateLimiter';
import { setupKnowledgeHandlers } from './knowledgeHandlers';

const trusted = vi.fn(() => true);
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
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
  const getPdf = vi.fn();
  const service = { getPdf };
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
  const pauseBatch = vi.fn();
  const resumeBatch = vi.fn();
  const retryUpload = vi.fn();
  const reselectSource = vi.fn();
  const cancelUpload = vi.fn();
  const cancelBatch = vi.fn();
  const uploadService = {
    selectAndQueue,
    snapshot,
    pauseBatch,
    resumeBatch,
    retryUpload,
    reselectSource,
    cancelUpload,
    cancelBatch,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    trusted.mockReturnValue(true);
    vi.mocked(rateLimiters.fsOperations.tryConsume).mockReturnValue({ allowed: true });
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as (...args: unknown[]) => unknown;
      return ipcMain;
    });
    setupKnowledgeHandlers(
      () => service as never,
      () => indexStatusService as never,
      () => uploadService as never,
    );
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

    await expect(handlers[IPC_CHANNELS.KNOWLEDGE_GET_PDF]({}, request)).resolves.toMatchObject({
      ok: true,
      source: 'cache',
    });
    expect(getPdf).toHaveBeenCalledWith(request);
  });

  it('rejects untrusted and malformed PDF requests before the service', async () => {
    trusted.mockReturnValueOnce(false);
    await expect(
      handlers[IPC_CHANNELS.KNOWLEDGE_GET_PDF](
        {},
        {
          documentId: 'document123',
          checksum: 'a'.repeat(64),
        },
      ),
    ).resolves.toEqual({ ok: false, error: 'invalid-document' });
    await expect(
      handlers[IPC_CHANNELS.KNOWLEDGE_GET_PDF](
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

    await expect(handlers[IPC_CHANNELS.KNOWLEDGE_GET_PDF]({}, request)).resolves.toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('returns PocketBase-derived status or a stable idle fallback', async () => {
    await expect(handlers[IPC_CHANNELS.KNOWLEDGE_GET_INDEX_STATUS]({})).resolves.toMatchObject({
      documentCount: 3,
      categoryCount: 2,
    });

    setupKnowledgeHandlers(
      () => null,
      () => null,
    );
    await expect(handlers[IPC_CHANNELS.KNOWLEDGE_GET_INDEX_STATUS]({})).resolves.toEqual({
      state: 'idle',
      documentCount: 0,
      categoryCount: 0,
      lastIndexedAt: null,
    });
  });

  it('requires a trusted sender and forwards only the no-argument upload selection request', async () => {
    selectAndQueue.mockResolvedValue({ ok: false, error: 'cancelled' });
    await expect(
      handlers[IPC_CHANNELS.KNOWLEDGE_SELECT_AND_STAGE]({}, '/renderer/cannot/pass/a/path.pdf'),
    ).resolves.toEqual({ ok: false, error: 'cancelled' });
    expect(selectAndQueue).toHaveBeenCalledWith();

    trusted.mockReturnValueOnce(false);
    await expect(handlers[IPC_CHANNELS.KNOWLEDGE_SELECT_AND_STAGE]({})).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('exposes safe queue controls and never accepts renderer file paths', async () => {
    await expect(handlers[IPC_CHANNELS.KNOWLEDGE_UPLOAD_QUEUE_GET]({})).resolves.toEqual(
      snapshot(),
    );
    await handlers[IPC_CHANNELS.KNOWLEDGE_UPLOAD_BATCH_PAUSE]({}, 'batch-1');
    await handlers[IPC_CHANNELS.KNOWLEDGE_UPLOAD_BATCH_RESUME]({}, 'batch-1');
    await handlers[IPC_CHANNELS.KNOWLEDGE_UPLOAD_RETRY]({}, 'upload-1');
    await handlers[IPC_CHANNELS.KNOWLEDGE_UPLOAD_RESELECT]({}, 'upload-1', '/renderer/path.pdf');
    await handlers[IPC_CHANNELS.KNOWLEDGE_UPLOAD_FILE_CANCEL]({}, 'upload-1');
    await handlers[IPC_CHANNELS.KNOWLEDGE_UPLOAD_BATCH_CANCEL]({}, 'batch-1');

    expect(pauseBatch).toHaveBeenCalledWith('batch-1');
    expect(resumeBatch).toHaveBeenCalledWith('batch-1');
    expect(retryUpload).toHaveBeenCalledWith('upload-1');
    expect(reselectSource).toHaveBeenCalledWith('upload-1');
    expect(cancelUpload).toHaveBeenCalledWith('upload-1');
    expect(cancelBatch).toHaveBeenCalledWith('batch-1');

    await handlers[IPC_CHANNELS.KNOWLEDGE_UPLOAD_RETRY]({}, '../outside.pdf');
    expect(retryUpload).toHaveBeenCalledTimes(1);
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
