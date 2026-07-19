import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivilegedCommandSafeError } from '../../privileged/PrivilegedCommandProcessor';
import { KnowledgeUploadAdmissionError } from '../KnowledgeUploadCapacity';
import { registerKnowledgeManagementCommands } from '../registerKnowledgeManagementCommands';

const context = {
  requestId: 'command-request-1',
  account: { id: 'account-admin', displayName: 'Ryan Bledsoe' },
  device: { deviceId: 'device-1' },
  role: 'admin' as const,
};

describe('registerKnowledgeManagementCommands', () => {
  const handlers = new Map<string, (context: never, payload: never) => Promise<unknown>>();
  const capabilities = new Map<string, string>();
  const upload = {
    id: 'upload-1',
    requestId: 'request-1',
    accountId: 'account-admin',
    deviceId: 'device-1',
    operatorId: 'account-admin',
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
    createCategory: vi.fn(async () => ({ id: 'category-1' })),
    setCategoryName: vi.fn(async () => ({ id: 'category-1' })),
    setCategoryOrder: vi.fn(async () => [{ id: 'category-1' }]),
    deleteCategory: vi.fn(async () => undefined),
    setDocumentMetadata: vi.fn(async () => ({ id: 'document-1' })),
    assignDocumentCategories: vi.fn(async () => [{ id: 'document-1' }]),
    trash: vi.fn(async () => ({ id: 'document-1' })),
    restore: vi.fn(async () => ({ id: 'document-1' })),
    deletePermanently: vi.fn(async () => ({ id: 'document-1', deleted: true as const })),
    readAudit: vi.fn(async () => ({ items: [], nextCursor: null })),
  };
  const consumeReauthenticationProof = vi.fn(async () => true);
  const uploadCoordinator = {
    beginBatch: vi.fn(async () => ({ id: 'batch-1' })),
    beginFile: vi.fn(async () => ({ id: 'upload-1' })),
    status: vi.fn(async () => ({ batch: { id: 'batch-1' }, uploads: [] })),
    finalize: vi.fn(async () => ({ id: 'upload-1', state: 'assembling' })),
    cancelFile: vi.fn(async () => undefined),
    cancelBatch: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const searchIndexer = {
    enqueue: vi.fn(),
    retry: vi.fn(),
    remove: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    capabilities.clear();
    registerKnowledgeManagementCommands({
      registrar: {
        registerCommand: vi.fn((command, capability, handler) => {
          expect(capability).toBe('knowledge.manage');
          handlers.set(command, handler as never);
          capabilities.set(command, capability);
        }),
      },
      pb: pb as never,
      service: service as never,
      consumeReauthenticationProof,
      extractor: { extract, stop },
      readUploadPdf,
      uploadCoordinator: uploadCoordinator as never,
      searchIndexer,
    });
  });

  it('repeats checksum, signature, extraction, and ownership validation on the server', async () => {
    const bytes = Buffer.from('%PDF-test');
    const checksum = await import('node:crypto').then(({ createHash }) =>
      createHash('sha256').update(bytes).digest('hex'),
    );
    getUpload.mockResolvedValueOnce({
      ...upload,
      checksum,
      operatorId: 'historical-roster-id',
    });

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
      'knowledge.upload.batch.begin',
      'knowledge.upload.file.begin',
      'knowledge.upload.status',
      'knowledge.upload.file.finalize',
      'knowledge.upload.file.cancel',
      'knowledge.upload.batch.cancel',
      'knowledge.upload.validate',
      'knowledge.snapshot.read',
      'knowledge.document.publish',
      'knowledge.document.replace',
      'knowledge.document.title.set',
      'knowledge.document.category.set',
      'knowledge.category.rename',
      'knowledge.category.create',
      'knowledge.category.name.set',
      'knowledge.category.order.set',
      'knowledge.category.delete',
      'knowledge.document.metadata.set',
      'knowledge.documents.category.assign',
      'knowledge.document.trash',
      'knowledge.document.restore',
      'knowledge.document.delete',
      'knowledge.document.search-index.retry',
      'knowledge.audit.read',
    ]);

    await handlers.get('knowledge.document.publish')!(
      context as never,
      { uploadId: 'upload-1', title: 'Runbook', category: 'Operations' } as never,
    );
    expect(service.publish).toHaveBeenCalledWith({
      actor: {
        accountId: 'account-admin',
        displayName: 'Ryan Bledsoe',
      },
      requestId: 'command-request-1',
      uploadId: 'upload-1',
      title: 'Runbook',
      category: 'Operations',
    });

    await handlers.get('knowledge.category.create')!(
      context as never,
      { name: 'Network', afterCategoryId: null } as never,
    );
    expect(service.createCategory).toHaveBeenCalledWith({
      actor: { accountId: 'account-admin', displayName: 'Ryan Bledsoe' },
      requestId: 'command-request-1',
      name: 'Network',
      afterCategoryId: null,
    });

    await handlers.get('knowledge.document.metadata.set')!(
      context as never,
      {
        documentId: 'document-1',
        title: 'Oracle guide',
        categoryId: 'category-1',
        documentType: 'sop',
        expectedRevision: 3,
      } as never,
    );
    expect(service.setDocumentMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'command-request-1',
        categoryId: 'category-1',
        documentType: 'sop',
      }),
    );
  });

  it('queues indexing only after a successful publication', async () => {
    await handlers.get('knowledge.document.publish')!(
      context as never,
      { uploadId: 'upload-1', title: 'Runbook', category: 'Operations' } as never,
    );
    expect(searchIndexer.enqueue).toHaveBeenCalledWith('document-1');

    service.publish.mockRejectedValueOnce(new Error('publication-failed'));
    await expect(
      handlers.get('knowledge.document.publish')!(
        context as never,
        { uploadId: 'upload-1', title: 'Runbook', category: 'Operations' } as never,
      ),
    ).rejects.toThrow('publication-failed');
    expect(searchIndexer.enqueue).toHaveBeenCalledTimes(1);
  });

  it('registers retry with the existing Wiki management capability', async () => {
    expect(capabilities.get('knowledge.document.search-index.retry')).toBe('knowledge.manage');

    await expect(
      handlers.get('knowledge.document.search-index.retry')!(
        context as never,
        { documentId: 'document-1' } as never,
      ),
    ).resolves.toEqual({ documentId: 'document-1', queued: true });
    expect(searchIndexer.retry).toHaveBeenCalledWith('document-1');
  });

  it.each([
    [
      'knowledge.document.replace',
      {
        uploadId: 'upload-1',
        documentId: 'document-1',
        expectedRevision: 2,
        title: 'Oracle SOP',
        category: 'Access',
      },
      'enqueue',
    ],
    ['knowledge.document.restore', { documentId: 'document-1', expectedRevision: 2 }, 'enqueue'],
  ] as const)(
    '%s queues indexing only after the mutation succeeds',
    async (command, payload, method) => {
      await handlers.get(command)!(context as never, payload as never);
      expect(searchIndexer[method]).toHaveBeenCalledWith('document-1');

      const serviceMethod =
        command === 'knowledge.document.replace' ? service.replace : service.restore;
      serviceMethod.mockRejectedValueOnce(new Error('mutation-failed'));
      await expect(handlers.get(command)!(context as never, payload as never)).rejects.toThrow(
        'mutation-failed',
      );
      expect(searchIndexer[method]).toHaveBeenCalledTimes(1);
    },
  );

  it('awaits permanent chunk removal after authoritative document deletion succeeds', async () => {
    let finishRemoval!: () => void;
    searchIndexer.remove.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRemoval = resolve;
        }),
    );

    let settled = false;
    const deletion = handlers.get('knowledge.document.delete')!(
      context as never,
      {
        documentId: 'document-1',
        expectedRevision: 3,
        reauthRequestId: 'reauth-delete',
      } as never,
    ).then((value) => {
      settled = true;
      return value;
    });
    await vi.waitFor(() => expect(searchIndexer.remove).toHaveBeenCalledWith('document-1'));
    expect(service.deletePermanently).toHaveBeenCalledBefore(searchIndexer.remove);
    expect(settled).toBe(false);

    finishRemoval();
    await expect(deletion).resolves.toEqual({ id: 'document-1', deleted: true });
  });

  it('does not remove chunks when permanent document deletion fails', async () => {
    service.deletePermanently.mockRejectedValueOnce(new Error('deletion-failed'));

    await expect(
      handlers.get('knowledge.document.delete')!(
        context as never,
        {
          documentId: 'document-1',
          expectedRevision: 3,
          reauthRequestId: 'reauth-delete',
        } as never,
      ),
    ).rejects.toThrow('deletion-failed');
    expect(searchIndexer.remove).not.toHaveBeenCalled();
  });

  it('does not physically remove trashed chunks or re-extract metadata-only changes', async () => {
    await handlers.get('knowledge.document.trash')!(
      context as never,
      { documentId: 'document-1', expectedRevision: 2 } as never,
    );
    await handlers.get('knowledge.document.title.set')!(
      context as never,
      { documentId: 'document-1', title: 'Oracle SOP', expectedRevision: 2 } as never,
    );
    await handlers.get('knowledge.document.category.set')!(
      context as never,
      { documentId: 'document-1', category: 'Access', expectedRevision: 2 } as never,
    );
    await handlers.get('knowledge.document.metadata.set')!(
      context as never,
      {
        documentId: 'document-1',
        title: 'Oracle SOP',
        categoryId: 'category-1',
        documentType: 'sop',
        expectedRevision: 2,
      } as never,
    );
    await handlers.get('knowledge.documents.category.assign')!(
      context as never,
      {
        categoryId: 'category-1',
        documents: [{ documentId: 'document-1', expectedRevision: 2 }],
      } as never,
    );

    expect(searchIndexer.enqueue).not.toHaveBeenCalled();
    expect(searchIndexer.remove).not.toHaveBeenCalled();
  });

  it('registers all resumable commands with the current account, device, and request ID', async () => {
    const actor = {
      accountId: 'account-admin',
      deviceId: 'device-1',
      displayName: 'Ryan Bledsoe',
      role: 'admin',
    };
    await handlers.get('knowledge.upload.batch.begin')!(
      context as never,
      { requestId: 'batch-client-1', fileCount: 2, totalBytes: 100 } as never,
    );
    expect(uploadCoordinator.beginBatch).toHaveBeenCalledWith(actor, {
      requestId: 'batch-client-1',
      fileCount: 2,
      totalBytes: 100,
    });

    await handlers.get('knowledge.upload.file.begin')!(
      context as never,
      {
        batchId: 'batch-1',
        fileName: 'Runbook.pdf',
        byteSize: 9,
        checksum: 'a'.repeat(64),
        chunkCount: 1,
      } as never,
    );
    expect(uploadCoordinator.beginFile).toHaveBeenCalledWith(actor, {
      requestId: 'command-request-1',
      batchId: 'batch-1',
      fileName: 'Runbook.pdf',
      byteSize: 9,
      checksum: 'a'.repeat(64),
      chunkCount: 1,
    });

    await handlers.get('knowledge.upload.status')!(
      context as never,
      { batchId: 'batch-1' } as never,
    );
    await handlers.get('knowledge.upload.file.finalize')!(
      context as never,
      { uploadId: 'upload-1', expectedRevision: 1 } as never,
    );
    await handlers.get('knowledge.upload.file.cancel')!(
      context as never,
      { uploadId: 'upload-1', expectedRevision: 2 } as never,
    );
    await handlers.get('knowledge.upload.batch.cancel')!(
      context as never,
      { batchId: 'batch-1', expectedRevision: 3 } as never,
    );
    expect(uploadCoordinator.status).toHaveBeenCalledWith(actor, 'batch-1');
    expect(uploadCoordinator.finalize).toHaveBeenCalledWith(actor, {
      uploadId: 'upload-1',
      expectedRevision: 1,
    });
    expect(uploadCoordinator.cancelFile).toHaveBeenCalledWith(actor, {
      uploadId: 'upload-1',
      expectedRevision: 2,
    });
    expect(uploadCoordinator.cancelBatch).toHaveBeenCalledWith(actor, {
      batchId: 'batch-1',
      expectedRevision: 3,
    });
  });

  it('translates asynchronous upload admission failures into bounded command errors', async () => {
    uploadCoordinator.beginBatch.mockRejectedValueOnce(
      new KnowledgeUploadAdmissionError('insufficient-storage'),
    );

    const result = handlers.get('knowledge.upload.batch.begin')!(
      context as never,
      { requestId: 'batch-client-1', fileCount: 2, totalBytes: 100 } as never,
    );

    await expect(result).rejects.toBeInstanceOf(PrivilegedCommandSafeError);
    await expect(result).rejects.toMatchObject({ code: 'insufficient-storage' });
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
