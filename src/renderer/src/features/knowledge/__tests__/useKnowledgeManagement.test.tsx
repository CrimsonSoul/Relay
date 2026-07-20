import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeManagementSnapshot } from '@shared/knowledge';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';
import { usePrivilegedAccess } from '../../../contexts/PrivilegedAccessContext';
import { useKnowledgeManagement } from '../useKnowledgeManagement';

vi.mock('../../../contexts/PrivilegedAccessContext', () => ({ usePrivilegedAccess: vi.fn() }));

const usePrivilegedAccessMock = vi.mocked(usePrivilegedAccess);
const snapshot = {
  mode: 'managed',
  categories: [],
  documents: { items: [], nextCursor: null },
  trash: { items: [], nextCursor: null },
  uploads: { items: [], nextCursor: null },
};

const publisherSession = {
  state: 'active' as const,
  accountId: 'account-publisher',
  username: 'paris',
  displayName: 'Paris',
  role: 'publisher' as const,
  capabilities: ['privileged.status.read', 'knowledge.manage'],
  deviceId: 'device-1',
  expiresAt: '2026-07-19T23:00:00.000Z',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function snapshotWithTitle(title: string): KnowledgeManagementSnapshot {
  return {
    mode: 'managed',
    categories: [],
    documents: {
      items: [
        {
          id: 'document-1',
          checksum: 'a'.repeat(64),
          category: 'Operations',
          categoryId: 'category-operations',
          documentType: 'sop',
          displayTitle: title,
          fileName: 'Runbook.pdf',
          byteSize: 1_024,
          pageCount: 4,
          lifecycleState: 'active',
          revision: 2,
          publishedByName: 'Paris',
          publishedAt: '2026-07-19T12:00:00.000Z',
          trashedByName: null,
          trashedAt: null,
          searchIndexState: 'pending',
          searchIndexChecksum: null,
          searchIndexVersion: 0,
          searchIndexedAt: null,
          searchIndexError: null,
          updated: '2026-07-19T12:00:00.000Z',
        },
      ],
      nextCursor: null,
    },
    uploads: { items: [], nextCursor: null },
    trash: { items: [], nextCursor: null },
  };
}

function snapshotWithSearchState(
  state: 'pending' | 'ready' | 'failed',
  title = 'Runbook',
): KnowledgeManagementSnapshot {
  const current = snapshotWithTitle(title);
  const document = current.documents.items[0]!;
  return {
    ...current,
    documents: {
      ...current.documents,
      items: [
        {
          ...document,
          searchIndexState: state,
          searchIndexChecksum: state === 'ready' ? 'a'.repeat(64) : null,
          searchIndexVersion: state === 'ready' ? 1 : 0,
          searchIndexedAt: state === 'ready' ? '2026-07-19T18:00:00.000Z' : null,
          searchIndexError: state === 'failed' ? 'extraction-failed' : null,
        },
      ],
    },
  };
}

function okSnapshot(value: KnowledgeManagementSnapshot): PrivilegedCommandResult {
  return { ok: true, requestId: crypto.randomUUID(), value };
}

describe('useKnowledgeManagement', () => {
  let currentSession = publisherSession;
  let queueListener: ((queue: unknown) => void) | null = null;
  const uploadQueue = {
    restartRecovery: false,
    activeBatchId: null,
    totalBytes: 0,
    acknowledgedBytes: 0,
    items: [],
  };
  const submitCommand = vi.fn(async (input: { command: string }) => ({
    ok: true as const,
    requestId: 'request-1',
    value: input.command === 'knowledge.snapshot.read' ? snapshot : {},
  }));
  const reauthenticate = vi.fn(async () => ({
    proofId: 'proof-1',
    expiresAt: '2026-07-16T02:00:00.000Z',
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    submitCommand.mockReset().mockImplementation(async (input: { command: string }) => ({
      ok: true as const,
      requestId: 'request-1',
      value: input.command === 'knowledge.snapshot.read' ? snapshot : {},
    }));
    currentSession = publisherSession;
    queueListener = null;
    usePrivilegedAccessMock.mockImplementation(
      () =>
        ({
          session: currentSession,
          submitCommand,
          reauthenticate,
        }) as never,
    );
    globalThis.api = {
      selectAndQueueKnowledgePdfs: vi.fn(async () => ({ ok: true, uploads: [] })),
      getKnowledgeUploadQueue: vi.fn(async () => uploadQueue),
      onKnowledgeUploadQueueChanged: vi.fn((listener) => {
        queueListener = listener;
        return vi.fn();
      }),
      pauseKnowledgeUploadBatch: vi.fn(async () => true),
      resumeKnowledgeUploadBatch: vi.fn(async () => true),
      retryKnowledgeUpload: vi.fn(async () => true),
      reselectKnowledgeUploadSource: vi.fn(async () => true),
      cancelKnowledgeUpload: vi.fn(async () => true),
      cancelKnowledgeUploadBatch: vi.fn(async () => true),
    } as never;
  });

  it('ignores a slow older snapshot after a newer refresh succeeds', async () => {
    const first = deferred<PrivilegedCommandResult>();
    const second = deferred<PrivilegedCommandResult>();
    submitCommand.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useKnowledgeManagement());

    act(() => void result.current.refresh());
    second.resolve(okSnapshot(snapshotWithTitle('New')));
    first.resolve(okSnapshot(snapshotWithTitle('Old')));

    await waitFor(() =>
      expect(result.current.snapshot?.documents.items[0]?.displayTitle).toBe('New'),
    );
  });

  it('clears protected data and blocks mutations when capability expires', async () => {
    const { result, rerender } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    currentSession = {
      ...publisherSession,
      capabilities: ['privileged.status.read'],
    };
    rerender();

    expect(result.current.canManage).toBe(false);
    expect(result.current.snapshot).toBeNull();
    expect(await result.current.stagePdfs()).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('rejects a late mutation result after management capability expires', async () => {
    const mutation = deferred<PrivilegedCommandResult>();
    const { result, rerender } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    submitCommand.mockReturnValueOnce(mutation.promise);
    let publishResult: Promise<boolean> | undefined;
    act(() => {
      publishResult = result.current.publish('upload-1', 'Runbook', 'Operations');
    });

    currentSession = { ...publisherSession, capabilities: ['privileged.status.read'] };
    rerender();
    mutation.resolve({ ok: true, requestId: 'late-publish', value: {} });

    await expect(publishResult).resolves.toBe(false);
    expect(result.current.snapshot).toBeNull();
  });

  it('submits a protected search retry and confirms a reordered document by identity', async () => {
    const failed = snapshotWithSearchState('failed');
    const other = {
      ...snapshotWithSearchState('pending', 'Escalation guide').documents.items[0]!,
      id: 'document-2',
    };
    const ready = snapshotWithSearchState('ready').documents.items[0]!;
    const authoritative = {
      ...failed,
      documents: { items: [other, ready], nextCursor: null },
    };
    let snapshotReads = 0;
    submitCommand.mockImplementation(async (input: { command: string }) => {
      if (input.command === 'knowledge.document.search-index.retry') {
        return { ok: false as const, requestId: 'retry-1', error: 'expired' as const };
      }
      snapshotReads += 1;
      return okSnapshot(snapshotReads === 1 ? failed : authoritative);
    });
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(failed));

    let retried = false;
    await act(async () => {
      retried = await result.current.retrySearchIndex('document-1');
    });

    expect(retried).toBe(true);
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.document.search-index.retry',
      payload: { documentId: 'document-1' },
      expectedRevision: null,
    });
    expect(result.current.snapshot?.documents.items.map(({ id }) => id)).toEqual([
      'document-2',
      'document-1',
    ]);
    expect(result.current.error).toBeNull();
  });

  it('does not confirm an ambiguous search retry after the document is removed', async () => {
    const failed = snapshotWithSearchState('failed');
    const removed = { ...failed, documents: { items: [], nextCursor: null } };
    let snapshotReads = 0;
    submitCommand.mockImplementation(async (input: { command: string }) => {
      if (input.command === 'knowledge.document.search-index.retry') {
        return { ok: false as const, requestId: 'retry-1', error: 'expired' as const };
      }
      snapshotReads += 1;
      return okSnapshot(snapshotReads === 1 ? failed : removed);
    });
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(failed));

    let retried = true;
    await act(async () => {
      retried = await result.current.retrySearchIndex('document-1');
    });

    expect(retried).toBe(false);
    expect(result.current.error).toBe('The request expired. Try again.');
  });

  it('uses existing capability and error translation for search retry', async () => {
    currentSession = { ...publisherSession, capabilities: ['privileged.status.read'] };
    const { result, rerender } = renderHook(() => useKnowledgeManagement());

    expect(await result.current.retrySearchIndex('document-1')).toBe(false);
    expect(submitCommand).not.toHaveBeenCalled();

    currentSession = publisherSession;
    rerender();
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    submitCommand.mockResolvedValueOnce({
      ok: false,
      requestId: 'retry-locked',
      error: 'locked',
    });
    await act(async () => {
      expect(await result.current.retrySearchIndex('document-1')).toBe(false);
    });
    expect(result.current.error).toBe('Publisher access is locked. Sign in again.');
  });

  it('rejects a late search retry result from a stale management identity', async () => {
    const failed = snapshotWithSearchState('failed');
    const mutation = deferred<PrivilegedCommandResult>();
    submitCommand.mockImplementation((input: { command: string }) =>
      input.command === 'knowledge.document.search-index.retry'
        ? mutation.promise
        : Promise.resolve(okSnapshot(failed)),
    );
    const { result, rerender } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(failed));
    let retryResult: Promise<boolean> | undefined;
    act(() => {
      retryResult = result.current.retrySearchIndex('document-1');
    });

    currentSession = { ...publisherSession, accountId: 'account-other' };
    rerender();
    mutation.resolve({ ok: true, requestId: 'late-retry', value: {} });

    await expect(retryResult).resolves.toBe(false);
    expect(result.current.snapshot).toBeNull();
  });

  it('treats an ambiguous publish as success when the authoritative snapshot proves it', async () => {
    const onLibraryChanged = vi.fn();
    const { result } = renderHook(() => useKnowledgeManagement(onLibraryChanged));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    submitCommand
      .mockResolvedValueOnce({ ok: false, requestId: 'publish-1', error: 'expired' })
      .mockResolvedValueOnce(okSnapshot(snapshotWithTitle('Runbook')));

    let changed = false;
    await act(async () => {
      changed = await result.current.publish('upload-1', 'Runbook', 'Operations');
    });

    expect(changed).toBe(true);
    expect(result.current.error).toBeNull();
    expect(onLibraryChanged).toHaveBeenCalledOnce();
  });

  it('loads a signed management snapshot only for an authorized active session', async () => {
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.snapshot.read',
      payload: { query: '', cursor: null, pageSize: 100 },
      expectedRevision: null,
    });
    expect(result.current.canManage).toBe(true);
  });

  it('refreshes after staging and sends optimistic revisions for lifecycle actions', async () => {
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    await act(() => result.current.stagePdfs());
    await act(() =>
      result.current.trash({
        documentId: 'document-1',
        expectedRevision: 4,
      }),
    );

    expect(globalThis.api?.selectAndQueueKnowledgePdfs).toHaveBeenCalledOnce();
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.document.trash',
      payload: { documentId: 'document-1', expectedRevision: 4 },
      expectedRevision: null,
    });
  });

  it('loads, validates, and updates the resumable upload queue without renderer file paths', async () => {
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.uploadQueue).toEqual(uploadQueue));

    const next = {
      restartRecovery: true,
      activeBatchId: 'batch-1',
      totalBytes: 100,
      acknowledgedBytes: 40,
      items: [
        {
          id: 'local-1',
          uploadId: 'upload-1',
          batchId: 'batch-1',
          fileName: 'Runbook.pdf',
          byteSize: 100,
          acknowledgedBytes: 40,
          chunkCount: 2,
          acknowledgedChunkCount: 1,
          state: 'paused-network' as const,
          safeError: 'offline' as const,
          retryCount: 8,
          restartRecovery: true,
        },
      ],
    };
    act(() => queueListener?.(next));

    expect(result.current.uploadQueue).toEqual(next);
    expect(JSON.stringify(result.current.uploadQueue)).not.toContain('/private/');
  });

  it('reauthenticates before permanent deletion', async () => {
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    await act(() => result.current.deletePermanently('document-1', 7, 'secret'));

    expect(reauthenticate).toHaveBeenCalledWith('secret');
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.document.delete',
      payload: {
        documentId: 'document-1',
        expectedRevision: 7,
        reauthRequestId: 'proof-1',
      },
      expectedRevision: null,
    });
  });

  it('sends stable category and document classification commands', async () => {
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    await act(() => result.current.createCategory('Network', null));
    await act(() =>
      result.current.setDocumentMetadata(
        {
          id: 'document-1',
          revision: 3,
        },
        'Oracle guide',
        'category-network',
        'cheatsheet',
      ),
    );

    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.category.create',
      payload: { name: 'Network', afterCategoryId: null },
      expectedRevision: null,
    });
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.document.metadata.set',
      payload: {
        documentId: 'document-1',
        title: 'Oracle guide',
        categoryId: 'category-network',
        documentType: 'cheatsheet',
        expectedRevision: 3,
      },
      expectedRevision: null,
    });
  });

  it('paginates retained audit history without duplicating events', async () => {
    const first = {
      id: 'audit-1',
      requestId: 'request-audit-1',
      action: 'published',
      targetId: 'document-1',
      fileName: 'Runbook.pdf',
      title: 'Runbook',
      category: 'Operations',
      accountId: 'account-publisher',
      actorDisplayName: 'Tristan Bowles',
      occurredAt: '2026-07-16T01:00:00.000Z',
    };
    const second = { ...first, id: 'audit-2', requestId: 'request-audit-2' };
    submitCommand.mockImplementation(async (input: { command: string; payload?: unknown }) => {
      if (input.command === 'knowledge.snapshot.read') {
        return { ok: true as const, requestId: 'request-snapshot', value: snapshot };
      }
      const cursor = (input.payload as { cursor?: string | null } | undefined)?.cursor;
      return {
        ok: true as const,
        requestId: 'request-audit',
        value:
          cursor === 'audit-1'
            ? { items: [second], nextCursor: null }
            : { items: [first], nextCursor: 'audit-1' },
      };
    });

    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    await act(() => result.current.readAudit());
    expect(result.current.auditEvents.map(({ id }) => id)).toEqual(['audit-1']);
    expect(result.current.auditNextCursor).toBe('audit-1');

    await act(() => result.current.loadMoreAudit());
    expect(result.current.auditEvents.map(({ id }) => id)).toEqual(['audit-1', 'audit-2']);
    expect(result.current.auditNextCursor).toBeNull();
  });
});
