import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupKnowledgeHandlers } from './knowledgeHandlers';

const trusted = vi.fn(() => true);
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
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
  const manager = { getStatus };

  beforeEach(() => {
    vi.clearAllMocks();
    trusted.mockReturnValue(true);
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as (...args: unknown[]) => unknown;
      return ipcMain;
    });
    setupKnowledgeHandlers(
      () => service as never,
      () => manager as never,
    );
  });

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

  it('returns manager status or a stable idle fallback', async () => {
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
});
