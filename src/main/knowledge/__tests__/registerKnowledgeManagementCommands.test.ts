import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerKnowledgeManagementCommands } from '../registerKnowledgeManagementCommands';

const context = {
  requestId: 'command-request-1',
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
  const service = {
    snapshot: vi.fn(async () => ({ mode: 'managed' })),
    publish: vi.fn(async () => ({ id: 'document-1' })),
    replace: vi.fn(async () => ({ id: 'document-1' })),
    setTitle: vi.fn(async () => ({ id: 'document-1' })),
    setCategory: vi.fn(async () => ({ id: 'document-1' })),
    renameCategory: vi.fn(async () => []),
    trash: vi.fn(async () => ({ id: 'document-1' })),
    restore: vi.fn(async () => ({ id: 'document-1' })),
    deletePermanently: vi.fn(async () => ({ id: 'document-1', deleted: true as const })),
    readAudit: vi.fn(async () => ({ items: [], nextCursor: null })),
  };
  const consumeReauthenticationProof = vi.fn(async () => true);

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
      service: service as never,
      consumeReauthenticationProof,
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

  it('registers and attributes every managed library command', async () => {
    expect([...handlers.keys()]).toEqual([
      'knowledge.upload.validate',
      'knowledge.snapshot.read',
      'knowledge.document.publish',
      'knowledge.document.replace',
      'knowledge.document.title.set',
      'knowledge.document.category.set',
      'knowledge.category.rename',
      'knowledge.document.trash',
      'knowledge.document.restore',
      'knowledge.document.delete',
      'knowledge.audit.read',
    ]);

    await handlers.get('knowledge.document.publish')!(
      context as never,
      { uploadId: 'upload-1', title: 'Runbook', category: 'Operations' } as never,
    );
    expect(service.publish).toHaveBeenCalledWith({
      actor: {
        accountId: 'account-admin',
        operatorId: 'operator-admin',
        operatorName: 'Ryan Bledsoe',
      },
      requestId: 'command-request-1',
      uploadId: 'upload-1',
      title: 'Runbook',
      category: 'Operations',
    });
  });

  it('requires a bound reauthentication proof for permanent deletion', async () => {
    await handlers.get('knowledge.document.delete')!(
      context as never,
      {
        documentId: 'document-1',
        expectedRevision: 3,
        reauthRequestId: 'reauth-delete',
      } as never,
    );
    expect(consumeReauthenticationProof).toHaveBeenCalledWith('reauth-delete', {
      accountId: 'account-admin',
      deviceId: 'device-1',
    });
    expect(service.deletePermanently).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'command-request-1',
        documentId: 'document-1',
        expectedRevision: 3,
      }),
    );
  });
});
