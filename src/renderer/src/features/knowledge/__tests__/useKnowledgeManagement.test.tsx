import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeManagementSnapshot, KnowledgeUploadQueueView } from '@shared/knowledge';
import type { PrivilegedReauthenticationProof } from '@shared/ipc';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';
import { usePrivilegedAccess } from '../../../contexts/PrivilegedAccessContext';
import { usePrivilegedCommands } from '../../../contexts/PrivilegedCommandContext';
import { useKnowledgeManagement } from '../useKnowledgeManagement';

vi.mock('../../../contexts/PrivilegedAccessContext', () => ({ usePrivilegedAccess: vi.fn() }));
vi.mock('../../../contexts/PrivilegedCommandContext', () => ({ usePrivilegedCommands: vi.fn() }));

const usePrivilegedAccessMock = vi.mocked(usePrivilegedAccess);
const usePrivilegedCommandsMock = vi.mocked(usePrivilegedCommands);
const snapshot: KnowledgeManagementSnapshot = {
  mode: 'managed',
  categories: [],
  documents: { items: [], nextCursor: null },
  trash: { items: [], nextCursor: null },
  uploads: { items: [], nextCursor: null },
};

const publisherSession: PrivilegedSessionView = {
  state: 'active',
  accountId: 'account-publisher',
  username: 'paris',
  displayName: 'Paris',
  role: 'publisher',
  capabilities: ['privileged.status.read', 'knowledge.manage'],
  deviceId: 'device-1',
  expiresAt: null,
};

// The hook is wired to `submitCommand` through an untyped context double, so this mirrors the
// request shape the hook actually sends and narrows the payload fields these tests read back.
type SubmitCommandInput = {
  command: string;
  payload: { query?: string; cursor?: string | null; pageSize?: number };
  expectedRevision: number | null;
};

type SubmitCommandMock = (input: SubmitCommandInput) => Promise<PrivilegedCommandResult>;

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

function snapshotWithReadyUpload(
  state: 'ready' | 'cancelled' = 'ready',
): KnowledgeManagementSnapshot {
  return {
    ...snapshot,
    uploads: {
      items: [
        {
          id: 'upload-1',
          requestId: 'upload-request-1',
          fileName: 'Runbook.pdf',
          byteSize: 1_024,
          checksum: 'a'.repeat(64),
          state,
          progress: state === 'ready' ? 100 : 50,
          proposedTitle: 'Runbook',
          proposedCategory: 'Operations',
          proposedCategoryId: 'category-operations',
          proposedDocumentType: 'sop',
          pageCount: 4,
          outlineSource: 'native',
          outlineCount: 3,
          duplicateDocumentId: 'document-1',
          safeError: null,
          expiresAt: '2026-07-23T01:00:00.000Z',
          revision: 2,
        },
      ],
      nextCursor: null,
    },
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
  let currentSession: PrivilegedSessionView = publisherSession;
  let queueListener: ((queue: unknown) => void) | null = null;
  const uploadQueue = {
    restartRecovery: false,
    activeBatchId: null,
    totalBytes: 0,
    acknowledgedBytes: 0,
    items: [],
  };
  const submitCommand = vi.fn<SubmitCommandMock>(async (input) => ({
    ok: true,
    requestId: 'request-1',
    value: input.command === 'knowledge.snapshot.read' ? snapshot : {},
  }));
  const reauthenticate = vi.fn<
    (password: string) => Promise<PrivilegedReauthenticationProof | null>
  >(async () => ({
    proofId: 'proof-1',
    expiresAt: '2026-07-16T02:00:00.000Z',
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    submitCommand.mockReset().mockImplementation(async (input) => ({
      ok: true,
      requestId: 'request-1',
      value: input.command === 'knowledge.snapshot.read' ? snapshot : {},
    }));
    currentSession = publisherSession;
    queueListener = null;
    usePrivilegedAccessMock.mockImplementation(
      () =>
        ({
          session: currentSession,
          reauthenticate,
        }) as never,
    );
    usePrivilegedCommandsMock.mockReturnValue({ submitCommand } as never);
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

  it('refreshes authoritative upload state after cancelling one PDF', async () => {
    const ready = snapshotWithReadyUpload();
    const cancelled = snapshotWithReadyUpload('cancelled');
    const localQueue = {
      restartRecovery: false,
      activeBatchId: 'batch-1',
      totalBytes: 1_024,
      acknowledgedBytes: 1_024,
      items: [
        {
          id: 'local-upload-1',
          uploadId: 'upload-1',
          batchId: 'batch-1',
          fileName: 'Runbook.pdf',
          byteSize: 1_024,
          acknowledgedBytes: 1_024,
          chunkCount: 1,
          acknowledgedChunkCount: 1,
          state: 'ready' as const,
          safeError: null,
          retryCount: 0,
          restartRecovery: false,
          cancelPending: false,
        },
      ],
    };
    globalThis.api!.getKnowledgeUploadQueue = vi.fn(async () => localQueue);
    let snapshotReads = 0;
    submitCommand.mockImplementation(async (input) => {
      if (input.command !== 'knowledge.snapshot.read') {
        return { ok: true, requestId: 'request-1', value: {} };
      }
      const value = snapshotReads === 0 ? ready : cancelled;
      snapshotReads += 1;
      return okSnapshot(value);
    });
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(ready));

    let discarded = false;
    await act(async () => {
      discarded = await result.current.cancelUpload('upload-1');
    });

    expect(discarded).toBe(true);
    expect(globalThis.api?.cancelKnowledgeUpload).toHaveBeenCalledWith('upload-1');
    expect(submitCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: 'knowledge.upload.file.cancel' }),
    );
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.snapshot.read',
      payload: { query: '', cursor: null, pageSize: 100 },
      expectedRevision: null,
    });
    expect(result.current.snapshot).toEqual(cancelled);
    expect(globalThis.api?.getKnowledgeUploadQueue).toHaveBeenCalledTimes(2);
  });

  it('discards a server-backed upload when its local queue entry is unavailable', async () => {
    const ready = snapshotWithReadyUpload();
    const cancelled = snapshotWithReadyUpload('cancelled');
    let serverCancelled = false;
    submitCommand.mockImplementation(async (input) => {
      if (input.command === 'knowledge.upload.file.cancel') {
        serverCancelled = true;
        return { ok: true, requestId: 'cancel-upload-1', value: {} };
      }
      return okSnapshot(serverCancelled ? cancelled : ready);
    });
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(ready));

    let discarded = false;
    await act(async () => {
      discarded = await result.current.cancelUpload('upload-1');
    });

    expect(discarded).toBe(true);
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.upload.file.cancel',
      payload: { uploadId: 'upload-1', expectedRevision: 2 },
      expectedRevision: null,
    });
    expect(globalThis.api?.cancelKnowledgeUpload).not.toHaveBeenCalled();
    expect(result.current.snapshot).toEqual(cancelled);
  });

  it('keeps the upload snapshot visible when protected cancellation fails', async () => {
    const ready = snapshotWithReadyUpload();
    submitCommand.mockImplementation(async (input) =>
      input.command === 'knowledge.snapshot.read'
        ? okSnapshot(ready)
        : { ok: false, requestId: 'cancel-upload-1', error: 'unauthorized' },
    );
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(ready));

    let discarded = true;
    await act(async () => {
      discarded = await result.current.cancelUpload('upload-1');
    });

    expect(discarded).toBe(false);
    expect(result.current.snapshot).toEqual(ready);
    expect(result.current.error).toBe('Wiki publisher access is required.');
    expect(globalThis.api?.cancelKnowledgeUpload).not.toHaveBeenCalled();
    expect(globalThis.api?.getKnowledgeUploadQueue).toHaveBeenCalledOnce();
  });

  it('surfaces a safe error when local queue cancellation rejects', async () => {
    globalThis.api!.cancelKnowledgeUpload = vi.fn(async () => {
      throw new Error('offline');
    });
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    let discarded = true;
    await act(async () => {
      discarded = await result.current.cancelUpload('local-upload-1');
    });

    expect(discarded).toBe(false);
    expect(result.current.error).toBe('Relay could not cancel this PDF.');
    expect(result.current.busy).toBeNull();
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
    submitCommand.mockImplementation(async (input) => {
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
    submitCommand.mockImplementation(async (input) => {
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

  it('checks later document pages when confirming an ambiguous search retry', async () => {
    const failed = snapshotWithSearchState('failed');
    const firstPage = {
      ...snapshot,
      documents: { items: [], nextCursor: 'documents-page-2' },
    } satisfies KnowledgeManagementSnapshot;
    const laterPage = {
      ...snapshot,
      documents: {
        items: [snapshotWithSearchState('ready').documents.items[0]!],
        nextCursor: null,
      },
    } satisfies KnowledgeManagementSnapshot;
    let snapshotReads = 0;
    submitCommand.mockImplementation(async (input) => {
      if (input.command === 'knowledge.document.search-index.retry') {
        return { ok: false, requestId: 'retry-later-page', error: 'expired' };
      }
      const cursor = input.command === 'knowledge.snapshot.read' ? input.payload.cursor : null;
      snapshotReads += 1;
      if (snapshotReads === 1) return okSnapshot(failed);
      return okSnapshot(cursor === 'documents-page-2' ? laterPage : firstPage);
    });
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(failed));

    let retried = false;
    await act(async () => {
      retried = await result.current.retrySearchIndex('document-1');
    });

    expect(retried).toBe(true);
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.snapshot.read',
      payload: { query: '', cursor: 'documents-page-2', pageSize: 100 },
      expectedRevision: null,
    });
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
    expect(result.current.error).toBe('Publisher access is signed out. Sign in again.');
  });

  it('rejects a late search retry result from a stale management identity', async () => {
    const failed = snapshotWithSearchState('failed');
    const mutation = deferred<PrivilegedCommandResult>();
    submitCommand.mockImplementation((input) =>
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

  it('rejects a late pagination page from a stale management identity', async () => {
    const accountAFirstPage = snapshotWithTitle('Account A first page');
    accountAFirstPage.documents.nextCursor = 'account-a-page-2';
    const accountALatePage = snapshotWithTitle('Account A late page');
    accountALatePage.documents.items[0] = {
      ...accountALatePage.documents.items[0]!,
      id: 'document-account-a-late',
      fileName: 'Account A late.pdf',
    };
    const accountBSnapshot = snapshotWithTitle('Account B current page');
    accountBSnapshot.documents.items[0] = {
      ...accountBSnapshot.documents.items[0]!,
      id: 'document-account-b',
      fileName: 'Account B.pdf',
    };
    const latePage = deferred<PrivilegedCommandResult>();
    submitCommand.mockImplementation((input) => {
      if (input.command !== 'knowledge.snapshot.read') {
        return Promise.resolve({ ok: true, requestId: 'request-1', value: {} });
      }
      if (input.payload.cursor === 'account-a-page-2') return latePage.promise;
      return Promise.resolve(
        okSnapshot(
          currentSession.accountId === publisherSession.accountId
            ? accountAFirstPage
            : accountBSnapshot,
        ),
      );
    });
    const { result, rerender } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(accountAFirstPage));

    let loadMoreResult!: Promise<boolean>;
    act(() => {
      loadMoreResult = result.current.loadMore('documents');
    });
    currentSession = { ...publisherSession, accountId: 'account-other' };
    rerender();
    await waitFor(() => expect(result.current.snapshot).toEqual(accountBSnapshot));

    let loadMoreAccepted = true;
    await act(async () => {
      latePage.resolve(okSnapshot(accountALatePage));
      loadMoreAccepted = await loadMoreResult;
    });

    expect(loadMoreAccepted).toBe(false);
    expect(result.current.snapshot?.documents.items.map(({ id }) => id)).toEqual([
      'document-account-b',
    ]);
  });

  it('treats a post-commit server error as success when the authoritative snapshot proves it', async () => {
    const onLibraryChanged = vi.fn();
    const firstPage = {
      ...snapshot,
      documents: { items: [], nextCursor: 'documents-page-2' },
      uploads: { items: [], nextCursor: 'uploads-page-2' },
    } satisfies KnowledgeManagementSnapshot;
    const documentPage = snapshotWithTitle('Runbook');
    const uploadPage = {
      ...snapshot,
      uploads: {
        items: [
          {
            id: 'upload-1',
            requestId: 'publish-1',
            fileName: 'Runbook.pdf',
            byteSize: 1_024,
            checksum: 'a'.repeat(64),
            state: 'published' as const,
            progress: 100,
            proposedTitle: 'Runbook',
            proposedCategory: 'Operations',
            proposedCategoryId: 'category-operations',
            proposedDocumentType: 'sop',
            pageCount: 4,
            outlineSource: 'native' as const,
            outlineCount: 3,
            duplicateDocumentId: null,
            safeError: null,
            expiresAt: '2026-07-23T01:00:00.000Z',
            revision: 2,
          },
        ],
        nextCursor: null,
      },
    } satisfies KnowledgeManagementSnapshot;
    submitCommand.mockImplementation(async (input) => {
      if (input.command === 'knowledge.document.publish') {
        return { ok: false, requestId: 'publish-1', error: 'server-error' };
      }
      if (input.command === 'knowledge.audit.read') {
        return {
          ok: true,
          requestId: 'audit-read-1',
          value: {
            items: [
              {
                id: 'audit-1',
                requestId: 'publish-1',
                action: 'published',
                targetId: 'document-1',
                fileName: 'Runbook.pdf',
                title: 'Runbook',
                category: 'Operations',
                accountId: 'account-publisher',
                actorDisplayName: 'Paris',
                occurredAt: '2026-07-19T12:00:00.000Z',
              },
            ],
            nextCursor: null,
          },
        };
      }
      const cursor = input.command === 'knowledge.snapshot.read' ? input.payload.cursor : null;
      if (cursor === 'documents-page-2') return okSnapshot(documentPage);
      if (cursor === 'uploads-page-2') return okSnapshot(uploadPage);
      return okSnapshot(firstPage);
    });
    const { result } = renderHook(() => useKnowledgeManagement(onLibraryChanged));
    await waitFor(() => expect(result.current.snapshot).toEqual(firstPage));

    let changed = false;
    await act(async () => {
      changed = await result.current.publish('upload-1', 'Runbook', 'Operations');
    });

    expect(changed).toBe(true);
    expect(result.current.error).toBeNull();
    expect(onLibraryChanged).toHaveBeenCalledOnce();
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.snapshot.read',
      payload: { query: '', cursor: 'uploads-page-2', pageSize: 100 },
      expectedRevision: null,
    });
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.audit.read',
      payload: { cursor: null, pageSize: 25, targetId: null },
      expectedRevision: null,
    });
  });

  it('explains an active filename collision instead of showing a generic Wiki error', async () => {
    submitCommand.mockImplementation(async (input) =>
      input.command === 'knowledge.document.publish'
        ? {
            ok: false,
            requestId: 'publish-duplicate',
            error: 'duplicate-file-name' as const,
          }
        : okSnapshot(snapshot),
    );
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    await act(async () => {
      await result.current.publish('upload-1', 'Runbook', 'Operations');
    });

    expect(result.current.error).toBe(
      'A published document with this PDF filename already exists. Replace it or rename the PDF.',
    );
  });

  // Regression: the safe-error table covered only 10 of the 12 PrivilegedCommandError codes, so
  // commandError() handed `undefined` to the banner for the two it missed and the operator was
  // told nothing at all about why the request failed.
  it.each([
    ['rate-limited', 'Too many Wiki requests. Wait a few minutes and try again.'],
    ['insufficient-storage', 'Relay does not have enough storage to complete that action.'],
  ] as const)('explains a %s publish rejection', async (error, message) => {
    submitCommand.mockImplementation(async (input) =>
      input.command === 'knowledge.document.publish'
        ? { ok: false, requestId: `publish-${error}`, error }
        : okSnapshot(snapshot),
    );
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    await act(async () => {
      await result.current.publish('upload-1', 'Runbook', 'Operations');
    });

    expect(result.current.error).toBe(message);
  });

  it('keeps a post-commit publish error visible when its audit event is missing', async () => {
    const authoritative = {
      ...snapshotWithTitle('Runbook'),
      uploads: {
        items: [
          {
            id: 'upload-1',
            requestId: 'publish-missing-audit',
            fileName: 'Runbook.pdf',
            byteSize: 1_024,
            checksum: 'a'.repeat(64),
            state: 'published' as const,
            progress: 100,
            proposedTitle: 'Runbook',
            proposedCategory: 'Operations',
            proposedCategoryId: 'category-operations',
            proposedDocumentType: 'sop',
            pageCount: 4,
            outlineSource: 'native' as const,
            outlineCount: 3,
            duplicateDocumentId: null,
            safeError: null,
            expiresAt: '2026-07-23T01:00:00.000Z',
            revision: 2,
          },
        ],
        nextCursor: null,
      },
    } satisfies KnowledgeManagementSnapshot;
    submitCommand.mockImplementation(async (input) => {
      if (input.command === 'knowledge.document.publish') {
        return { ok: false, requestId: 'publish-missing-audit', error: 'server-error' };
      }
      if (input.command === 'knowledge.audit.read') {
        return {
          ok: true,
          requestId: 'audit-read-empty',
          value: { items: [], nextCursor: null },
        };
      }
      return okSnapshot(authoritative);
    });
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toMatchObject(authoritative));

    let published = true;
    await act(async () => {
      published = await result.current.publish('upload-1', 'Runbook', 'Operations');
    });

    expect(published).toBe(false);
    expect(result.current.error).toBe('Relay could not complete the Wiki request.');
  });

  it('requires audit proof before confirming other post-commit Wiki mutations', async () => {
    const before = snapshotWithTitle('Runbook');
    const updated = snapshotWithTitle('Updated runbook');
    const after = {
      ...updated,
      documents: {
        ...updated.documents,
        items: updated.documents.items.map((document) => ({ ...document, revision: 3 })),
      },
    };
    let snapshotReads = 0;
    submitCommand.mockImplementation(async (input) => {
      if (input.command === 'knowledge.document.title.set') {
        return { ok: false, requestId: 'title-missing-audit', error: 'server-error' };
      }
      if (input.command === 'knowledge.audit.read') {
        return {
          ok: true,
          requestId: 'audit-read-empty',
          value: { items: [], nextCursor: null },
        };
      }
      snapshotReads += 1;
      return okSnapshot(snapshotReads === 1 ? before : after);
    });
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(before));

    let changed = true;
    await act(async () => {
      changed = await result.current.setTitle('document-1', 2, 'Updated runbook');
    });

    expect(changed).toBe(false);
    expect(result.current.error).toBe('Relay could not complete the Wiki request.');
  });

  it('uses exact audit proof to confirm an audited mutation outside the first snapshot page', async () => {
    const firstPage = {
      ...snapshot,
      documents: { items: [], nextCursor: 'documents-page-2' },
    } satisfies KnowledgeManagementSnapshot;
    const onLibraryChanged = vi.fn();
    submitCommand.mockImplementation(async (input) => {
      if (input.command === 'knowledge.document.title.set') {
        return { ok: false, requestId: 'title-later-page', error: 'server-error' };
      }
      if (input.command === 'knowledge.audit.read') {
        return {
          ok: true,
          requestId: 'audit-read-title',
          value: {
            items: [
              {
                id: 'audit-title',
                requestId: 'title-later-page',
                action: 'title-changed',
                targetId: 'document-later',
                fileName: 'Runbook.pdf',
                title: 'Updated runbook',
                category: 'Operations',
                accountId: 'account-publisher',
                actorDisplayName: 'Paris',
                occurredAt: '2026-07-19T12:00:00.000Z',
              },
            ],
            nextCursor: null,
          },
        };
      }
      return okSnapshot(firstPage);
    });
    const { result } = renderHook(() => useKnowledgeManagement(onLibraryChanged));
    await waitFor(() => expect(result.current.snapshot).toEqual(firstPage));

    let changed = false;
    await act(async () => {
      changed = await result.current.setTitle('document-later', 2, 'Updated runbook');
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
          cancelPending: false,
        },
      ],
    };
    act(() => queueListener?.(next));

    expect(result.current.uploadQueue).toEqual(next);
    expect(JSON.stringify(result.current.uploadQueue)).not.toContain('/private/');
  });

  it('ignores a late upload queue response from the previous account', async () => {
    const accountAQueue = deferred<KnowledgeUploadQueueView>();
    const accountBQueue = deferred<KnowledgeUploadQueueView>();
    const privateQueue: KnowledgeUploadQueueView = {
      restartRecovery: true,
      activeBatchId: 'batch-a',
      totalBytes: 100,
      acknowledgedBytes: 0,
      items: [
        {
          id: 'local-a',
          uploadId: 'upload-a',
          batchId: 'batch-a',
          fileName: 'Private A.pdf',
          byteSize: 100,
          acknowledgedBytes: 0,
          chunkCount: 1,
          acknowledgedChunkCount: 0,
          state: 'paused',
          safeError: null,
          retryCount: 0,
          restartRecovery: true,
          cancelPending: false,
        },
      ],
    };
    globalThis.api!.getKnowledgeUploadQueue = vi
      .fn()
      .mockReturnValueOnce(accountAQueue.promise)
      .mockReturnValueOnce(accountBQueue.promise);
    const { result, rerender } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(globalThis.api?.getKnowledgeUploadQueue).toHaveBeenCalledOnce());

    currentSession = { ...publisherSession, accountId: 'account-other' };
    rerender();
    await waitFor(() => expect(globalThis.api?.getKnowledgeUploadQueue).toHaveBeenCalledTimes(2));

    accountBQueue.resolve(uploadQueue);
    await waitFor(() => expect(result.current.uploadQueue).toEqual(uploadQueue));
    accountAQueue.resolve(privateQueue);
    await act(async () => {
      await accountAQueue.promise;
    });

    expect(result.current.uploadQueue).toEqual(uploadQueue);
    expect(JSON.stringify(result.current.uploadQueue)).not.toContain('Private A.pdf');
  });

  it('invalidates queue responses and events after a same-account device change', async () => {
    const oldDeviceQueue = deferred<KnowledgeUploadQueueView>();
    const newDeviceQueue = deferred<KnowledgeUploadQueueView>();
    const listeners: Array<(queue: KnowledgeUploadQueueView) => void> = [];
    const privateQueue: KnowledgeUploadQueueView = {
      restartRecovery: true,
      activeBatchId: 'batch-old-device',
      totalBytes: 100,
      acknowledgedBytes: 0,
      items: [
        {
          id: 'local-old-device',
          uploadId: 'upload-old-device',
          batchId: 'batch-old-device',
          fileName: 'Old device.pdf',
          byteSize: 100,
          acknowledgedBytes: 0,
          chunkCount: 1,
          acknowledgedChunkCount: 0,
          state: 'paused',
          safeError: null,
          retryCount: 0,
          restartRecovery: true,
          cancelPending: false,
        },
      ],
    };
    globalThis.api!.getKnowledgeUploadQueue = vi
      .fn()
      .mockReturnValueOnce(oldDeviceQueue.promise)
      .mockReturnValueOnce(newDeviceQueue.promise);
    globalThis.api!.onKnowledgeUploadQueueChanged = vi.fn((listener) => {
      listeners.push(listener);
      return vi.fn();
    });
    const { result, rerender } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => {
      expect(globalThis.api?.getKnowledgeUploadQueue).toHaveBeenCalledOnce();
      expect(listeners).toHaveLength(1);
    });

    currentSession = { ...publisherSession, deviceId: 'device-2' };
    rerender();
    await waitFor(() => {
      expect(globalThis.api?.getKnowledgeUploadQueue).toHaveBeenCalledTimes(2);
      expect(listeners).toHaveLength(2);
    });

    act(() => listeners[0]?.(privateQueue));
    expect(result.current.uploadQueue).toEqual(uploadQueue);

    newDeviceQueue.resolve(uploadQueue);
    await waitFor(() => expect(result.current.uploadQueue).toEqual(uploadQueue));
    oldDeviceQueue.resolve(privateQueue);
    await act(async () => {
      await oldDeviceQueue.promise;
    });
    act(() => listeners[0]?.(privateQueue));

    expect(result.current.uploadQueue).toEqual(uploadQueue);
    expect(JSON.stringify(result.current.uploadQueue)).not.toContain('Old device.pdf');
  });

  it('waits for queue hydration before choosing the local cancellation path', async () => {
    const queueHydration = deferred<KnowledgeUploadQueueView>();
    const localQueue: KnowledgeUploadQueueView = {
      restartRecovery: false,
      activeBatchId: 'batch-1',
      totalBytes: 1_024,
      acknowledgedBytes: 1_024,
      items: [
        {
          id: 'local-upload-1',
          uploadId: 'upload-1',
          batchId: 'batch-1',
          fileName: 'Runbook.pdf',
          byteSize: 1_024,
          acknowledgedBytes: 1_024,
          chunkCount: 1,
          acknowledgedChunkCount: 1,
          state: 'ready',
          safeError: null,
          retryCount: 0,
          restartRecovery: false,
          cancelPending: false,
        },
      ],
    };
    globalThis.api!.getKnowledgeUploadQueue = vi
      .fn()
      .mockReturnValueOnce(queueHydration.promise)
      .mockResolvedValue(localQueue);
    submitCommand.mockImplementation(async (input) =>
      input.command === 'knowledge.snapshot.read'
        ? okSnapshot(snapshotWithReadyUpload())
        : { ok: true, requestId: 'unexpected-direct-cancel', value: {} },
    );
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshotWithReadyUpload()));

    let cancellation!: Promise<boolean>;
    act(() => {
      cancellation = result.current.cancelUpload('upload-1');
    });
    expect(submitCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: 'knowledge.upload.file.cancel' }),
    );

    queueHydration.resolve(localQueue);
    await expect(cancellation).resolves.toBe(true);

    expect(globalThis.api?.cancelKnowledgeUpload).toHaveBeenCalledWith('upload-1');
    expect(submitCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: 'knowledge.upload.file.cancel' }),
    );
  });

  it('keeps polling a locally ready upload while durable cancellation is pending', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const pendingQueue = {
      restartRecovery: true,
      activeBatchId: 'batch-1',
      totalBytes: 1_024,
      acknowledgedBytes: 1_024,
      items: [
        {
          id: 'local-upload-1',
          uploadId: 'upload-1',
          batchId: 'batch-1',
          fileName: 'Runbook.pdf',
          byteSize: 1_024,
          acknowledgedBytes: 1_024,
          chunkCount: 1,
          acknowledgedChunkCount: 1,
          state: 'ready' as const,
          safeError: null,
          retryCount: 0,
          restartRecovery: true,
          cancelPending: true,
        },
      ],
    };
    globalThis.api!.getKnowledgeUploadQueue = vi.fn(async () => pendingQueue);

    renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(globalThis.api?.getKnowledgeUploadQueue).toHaveBeenCalled());

    await waitFor(() =>
      expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 2_000)).toBe(true),
    );
    setIntervalSpy.mockRestore();
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

  it('preserves permanent-delete password feedback when reauthentication signs out', async () => {
    reauthenticate.mockResolvedValueOnce(null);
    const { result, rerender } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    let deleted = true;
    await act(async () => {
      deleted = await result.current.deletePermanently('document-1', 7, 'wrong-password');
    });

    currentSession = {
      state: 'signed-out',
      accountId: null,
      username: null,
      displayName: null,
      role: null,
      capabilities: [],
      deviceId: null,
      expiresAt: null,
    };
    rerender();

    expect(deleted).toBe(false);
    expect(result.current.canManage).toBe(false);
    expect(result.current.error).toBe('Password confirmation was not accepted. Try again.');
    expect(submitCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: 'knowledge.document.delete' }),
    );
  });

  it('checks later trash pages before rejecting a post-commit delete error', async () => {
    const firstPage = {
      ...snapshot,
      trash: { items: [], nextCursor: 'trash-page-2' },
    } satisfies KnowledgeManagementSnapshot;
    const target = {
      ...snapshotWithTitle('Later page document').documents.items[0]!,
      lifecycleState: 'trashed' as const,
      trashedByName: 'Paris',
      trashedAt: '2026-07-19T12:00:00.000Z',
    };
    const laterPage = {
      ...snapshot,
      trash: { items: [target], nextCursor: null },
    } satisfies KnowledgeManagementSnapshot;
    submitCommand.mockImplementation(async (input) => {
      if (input.command === 'knowledge.document.delete') {
        return { ok: false, requestId: 'delete-1', error: 'server-error' };
      }
      const cursor = input.command === 'knowledge.snapshot.read' ? input.payload.cursor : null;
      return okSnapshot(cursor === 'trash-page-2' ? laterPage : firstPage);
    });
    const { result } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(firstPage));

    let deleted = true;
    await act(async () => {
      deleted = await result.current.deletePermanently('document-1', 2, 'secret');
    });

    expect(deleted).toBe(false);
    expect(result.current.error).toBe('Relay could not complete the Wiki request.');
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'knowledge.snapshot.read',
      payload: { query: '', cursor: 'trash-page-2', pageSize: 100 },
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
    submitCommand.mockImplementation(async (input) => {
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

  it('rejects a late audit read from a stale management identity', async () => {
    const lateAudit = deferred<PrivilegedCommandResult>();
    const accountAEvent = {
      id: 'audit-account-a',
      requestId: 'request-audit-account-a',
      action: 'published',
      targetId: 'document-account-a',
      fileName: 'Account A.pdf',
      title: 'Account A runbook',
      category: 'Operations',
      accountId: 'account-publisher',
      actorDisplayName: 'Paris',
      occurredAt: '2026-07-16T01:00:00.000Z',
    };
    submitCommand.mockImplementation((input) =>
      input.command === 'knowledge.snapshot.read'
        ? Promise.resolve(okSnapshot(snapshot))
        : lateAudit.promise,
    );
    const { result, rerender } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    let auditResult!: Promise<boolean>;
    act(() => {
      auditResult = result.current.readAudit();
    });
    currentSession = { ...publisherSession, accountId: 'account-other' };
    rerender();

    let auditAccepted = true;
    await act(async () => {
      lateAudit.resolve({
        ok: true,
        requestId: 'late-audit-read',
        value: { items: [accountAEvent], nextCursor: null },
      });
      auditAccepted = await auditResult;
    });

    expect(auditAccepted).toBe(false);
    expect(result.current.auditEvents).toEqual([]);
  });

  it('rejects late audit pagination from a stale management identity', async () => {
    const firstEvent = {
      id: 'audit-first',
      requestId: 'request-audit-first',
      action: 'published',
      targetId: 'document-first',
      fileName: 'First.pdf',
      title: 'First runbook',
      category: 'Operations',
      accountId: 'account-publisher',
      actorDisplayName: 'Paris',
      occurredAt: '2026-07-16T01:00:00.000Z',
    };
    const accountALateEvent = {
      ...firstEvent,
      id: 'audit-account-a-late',
      requestId: 'request-audit-account-a-late',
      targetId: 'document-account-a-late',
      fileName: 'Account A late.pdf',
      title: 'Account A late runbook',
    };
    const lateAuditPage = deferred<PrivilegedCommandResult>();
    submitCommand.mockImplementation((input) => {
      if (input.command === 'knowledge.snapshot.read') {
        return Promise.resolve(okSnapshot(snapshot));
      }
      if (input.payload.cursor === 'audit-page-2') return lateAuditPage.promise;
      return Promise.resolve({
        ok: true,
        requestId: 'initial-audit-read',
        value: { items: [firstEvent], nextCursor: 'audit-page-2' },
      });
    });
    const { result, rerender } = renderHook(() => useKnowledgeManagement());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));
    await act(() => result.current.readAudit());
    expect(result.current.auditEvents.map(({ id }) => id)).toEqual(['audit-first']);

    let auditResult!: Promise<boolean>;
    act(() => {
      auditResult = result.current.loadMoreAudit();
    });
    currentSession = { ...publisherSession, accountId: 'account-other' };
    rerender();

    let auditAccepted = true;
    await act(async () => {
      lateAuditPage.resolve({
        ok: true,
        requestId: 'late-audit-page',
        value: { items: [accountALateEvent], nextCursor: null },
      });
      auditAccepted = await auditResult;
    });

    expect(auditAccepted).toBe(false);
    expect(result.current.auditEvents).toEqual([]);
  });

  it('re-reads a filtered documents list whose debounced read was throttled', async () => {
    const filtered = snapshotWithTitle('Payment API Degradation Guide');
    const queries: string[] = [];
    const respond = async (input: {
      command: string;
      payload?: unknown;
    }): Promise<PrivilegedCommandResult> => {
      if (input.command !== 'knowledge.snapshot.read') {
        return { ok: true, requestId: 'request-1', value: {} };
      }
      const { query } = input.payload as { query: string };
      if (!query) return { ok: true, requestId: 'request-unfiltered', value: snapshot };
      queries.push(query);
      return queries.length === 1
        ? { ok: false, requestId: 'request-throttled', error: 'rate-limited' }
        : okSnapshot(filtered);
    };
    submitCommand.mockImplementation(respond as never);
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useKnowledgeManagement(undefined, query),
      { initialProps: { query: '' } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.snapshot).toEqual(snapshot);

    rerender({ query: 'payment' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    // The debounced read has to carry the query the operator typed, so cursors are never issued
    // for one filter and spent against another.
    expect(queries).toEqual(['payment']);
    expect(result.current.snapshot).toEqual(snapshot);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(queries).toEqual(['payment', 'payment']);
    expect(result.current.snapshot).toEqual(filtered);
    expect(result.current.error).toBeNull();
  });

  it('stops re-reading a query the server keeps throttling and keeps the banner up', async () => {
    const queries: string[] = [];
    const respond = async (input: {
      command: string;
      payload?: unknown;
    }): Promise<PrivilegedCommandResult> => {
      if (input.command !== 'knowledge.snapshot.read') {
        return { ok: true, requestId: 'request-1', value: {} };
      }
      const { query } = input.payload as { query: string };
      if (!query) return { ok: true, requestId: 'request-unfiltered', value: snapshot };
      queries.push(query);
      return { ok: false, requestId: 'request-throttled', error: 'rate-limited' };
    };
    submitCommand.mockImplementation(respond as never);
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useKnowledgeManagement(undefined, query),
      { initialProps: { query: '' } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    rerender({ query: 'payment' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // Three reads total: the debounced dispatch plus the bounded retries. A filter the server
    // keeps refusing must not keep spending the shared signed-command budget.
    expect(queries).toEqual(['payment', 'payment', 'payment']);
    expect(result.current.error).toBe('Too many Wiki requests. Wait a few minutes and try again.');
    expect(result.current.snapshot).toEqual(snapshot);
  });
});
