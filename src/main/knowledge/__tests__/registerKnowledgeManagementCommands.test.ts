import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerKnowledgeManagementCommands } from '../registerKnowledgeManagementCommands';

const context = {
  account: { id: 'account-admin' },
  operator: { id: 'operator-admin', displayName: 'Ryan Bledsoe' },
  device: { deviceId: 'device-1' },
};

describe('registerKnowledgeManagementCommands', () => {
  const handlers = new Map<string, (context: never, payload: never) => Promise<unknown>>();
  const upload = {
    id: 'upload-1',
    requestId: 'request-1',
    accountId: 'account-admin',
    deviceId: 'device-1',
    operatorId: 'operator-admin',
    operatorName: 'Ryan Bledsoe',
    fileName: 'Runbook.pdf',
    pdf: 'runbook.pdf',
    checksum: 'a'.repeat(64),
    byteSize: 9,
    state: 'validating',
    expiresAt: '2026-07-17T01:00:00.000Z',
    revision: 0,
  };
  const updateUpload = vi.fn(async () => ({}));
  const getUpload = vi.fn(async () => upload);
  const getDocuments = vi.fn(async () => []);
  const pb = {
    collection: vi.fn((name: string) =>
      name === 'knowledge_uploads'
        ? { getOne: getUpload, update: updateUpload }
        : { getFullList: getDocuments },
    ),
  };
  const extract = vi.fn(async () => ({
    metadataTitle: 'Runbook title',
    pageCount: 2,
    outline: [],
    outlineSource: 'none' as const,
  }));
  const stop = vi.fn(async () => undefined);
  const readUploadPdf = vi.fn(async () => Buffer.from('%PDF-test'));

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    registerKnowledgeManagementCommands({
      registrar: {
        registerCommand: vi.fn((command, capability, handler) => {
          expect(capability).toBe('knowledge.manage');
          handlers.set(command, handler as never);
        }),
      },
      pb: pb as never,
      extractor: { extract, stop },
      readUploadPdf,
    });
  });

  it('repeats checksum, signature, extraction, and ownership validation on the server', async () => {
    const bytes = Buffer.from('%PDF-test');
    const checksum = await import('node:crypto').then(({ createHash }) =>
      createHash('sha256').update(bytes).digest('hex'),
    );
    getUpload.mockResolvedValueOnce({ ...upload, checksum });

    await expect(
      handlers.get('knowledge.upload.validate')!(
        context as never,
        {
          uploadId: 'upload-1',
          preliminaryChecksum: checksum,
        } as never,
      ),
    ).resolves.toMatchObject({ state: 'ready', pageCount: 2, proposedTitle: 'Runbook title' });
    expect(readUploadPdf).toHaveBeenCalledWith(expect.objectContaining({ id: 'upload-1' }));
    expect(updateUpload).toHaveBeenCalledWith(
      'upload-1',
      expect.objectContaining({ state: 'ready', pageCount: 2 }),
      { requestKey: null },
    );
  });

  it('rejects a cross-device upload binding before reading bytes', async () => {
    getUpload.mockResolvedValueOnce({ ...upload, deviceId: 'other-device' });
    await expect(
      handlers.get('knowledge.upload.validate')!(
        context as never,
        {
          uploadId: 'upload-1',
          preliminaryChecksum: upload.checksum,
        } as never,
      ),
    ).rejects.toThrow(/binding/i);
    expect(readUploadPdf).not.toHaveBeenCalled();
  });

  it('maps invalid and encrypted PDFs to safe upload errors', async () => {
    readUploadPdf.mockResolvedValueOnce(Buffer.from('not-a-pdf'));
    await expect(
      handlers.get('knowledge.upload.validate')!(
        context as never,
        {
          uploadId: 'upload-1',
          preliminaryChecksum: upload.checksum,
        } as never,
      ),
    ).resolves.toMatchObject({ state: 'failed', safeError: 'validation-failed' });
    expect(updateUpload).toHaveBeenLastCalledWith(
      'upload-1',
      expect.objectContaining({ state: 'failed', safeError: 'validation-failed' }),
      { requestKey: null },
    );
  });
});
