import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicPrivilegedCommandRequest } from '@shared/ipc';
import {
  normalizeKnowledgeManagementSnapshot,
  type KnowledgeManagementSnapshot,
  type KnowledgePage,
  type KnowledgeUploadSelectionResult,
} from '@shared/knowledge';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';
import { usePrivilegedCommands } from '../../contexts/PrivilegedCommandContext';
import { useKnowledgeUploadQueue } from './useKnowledgeUploadQueue';
import { normalizeKnowledgeAuditPage, useKnowledgeAudit } from './useKnowledgeAudit';
import { KNOWLEDGE_MANAGEMENT_ERRORS, knowledgeCommandError } from './knowledgeManagementErrors';
import {
  createKnowledgeMutationActions,
  type KnowledgeConfirmationCollection,
  type KnowledgeMutationConfirmation,
} from './knowledgeMutationCoordinator';

const REAUTHENTICATION_ERROR = 'Password confirmation was not accepted. Try again.';

const QUERY_DEBOUNCE_MS = 250;
// The signed-command bucket refills one token per second, so retrying any sooner would only spend
// another throttled request. Two extra attempts ride out a lost read without letting a filter that
// keeps failing poll the shared budget forever; the error banner is what reports the rest.
const QUERY_RETRY_DELAY_MS = 1_000;
const QUERY_RETRY_LIMIT = 2;

/**
 * A background poll only re-reads the first page. Splice the refreshed page over the pages the
 * operator already loaded so an upload progress tick cannot undo "Load more".
 */
function mergeKnowledgePage<T extends { id: string }>(
  current: KnowledgePage<T>,
  next: KnowledgePage<T>,
): KnowledgePage<T> {
  const boundaryId = next.items.at(-1)?.id;
  if (!next.nextCursor || boundaryId === undefined) return next;
  const boundaryIndex = current.items.findIndex(({ id }) => id === boundaryId);
  if (boundaryIndex < 0) return next;
  const refreshedIds = new Set(next.items.map(({ id }) => id));
  const retained = current.items.slice(boundaryIndex + 1).filter(({ id }) => !refreshedIds.has(id));
  if (retained.length === 0) return next;
  return { items: [...next.items, ...retained], nextCursor: current.nextCursor };
}

function mergeKnowledgeSnapshot(
  current: KnowledgeManagementSnapshot,
  next: KnowledgeManagementSnapshot,
): KnowledgeManagementSnapshot {
  return {
    ...next,
    documents: mergeKnowledgePage(current.documents, next.documents),
    trash: mergeKnowledgePage(current.trash, next.trash),
    uploads: mergeKnowledgePage(current.uploads, next.uploads),
  };
}

type SnapshotRead =
  { snapshot: KnowledgeManagementSnapshot; error: null } | { snapshot: null; error: string };

export function useKnowledgeManagement(
  onLibraryChanged?: () => void | Promise<void>,
  documentQuery = '',
) {
  const { session, reauthenticate } = usePrivilegedAccess();
  const { submitCommand } = usePrivilegedCommands();
  const [snapshot, setSnapshot] = useState<KnowledgeManagementSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = session.state === 'active' && session.capabilities.includes('knowledge.manage');
  const managementIdentity = canManage
    ? `${session.accountId}\u0000${session.deviceId ?? 'server-local'}`
    : null;
  const { auditEvents, auditNextCursor, readAudit, loadMoreAudit, resetAudit } = useKnowledgeAudit({
    canManage,
    managementIdentity,
    submitCommand,
    setBusy,
    setError,
  });
  const managementIdentityRef = useRef(managementIdentity);
  const refreshGenerationRef = useRef(0);
  const loadMoreOperationRef = useRef(0);
  const mountedRef = useRef(true);
  const trimmedQuery = documentQuery.trim();
  const visibleQueryRef = useRef(trimmedQuery);
  // Reads stay pinned to the query the operator can already see so a cursor issued for one
  // filter is never spent against another.
  const appliedQueryRef = useRef(trimmedQuery);
  // `appliedQueryRef` advances the moment a read is dispatched, so on its own it cannot tell a
  // filter that reached the list from one whose read was throttled or superseded. Record the query
  // a snapshot actually came back for separately; the debounce below retries against this.
  const settledQueryRef = useRef(trimmedQuery);
  managementIdentityRef.current = managementIdentity;
  visibleQueryRef.current = trimmedQuery;

  const readSnapshot = useCallback(
    async (cursor: string | null, query = appliedQueryRef.current): Promise<SnapshotRead> => {
      const result = await submitCommand({
        command: 'knowledge.snapshot.read',
        payload: { query, cursor, pageSize: 100 },
        expectedRevision: null,
      });
      if (!result.ok) {
        return { snapshot: null, error: knowledgeCommandError(result) };
      }
      const normalized = normalizeKnowledgeManagementSnapshot(result.value);
      if (!normalized) {
        return { snapshot: null, error: 'Relay returned an invalid Wiki snapshot.' };
      }
      return { snapshot: normalized, error: null };
    },
    [submitCommand],
  );

  const loadSnapshot = useCallback(
    async (background: boolean): Promise<boolean> => {
      if (!canManage) {
        setSnapshot(null);
        return false;
      }
      const generation = refreshGenerationRef.current + 1;
      refreshGenerationRef.current = generation;
      // A background poll must leave the workspace exactly as the operator left it: no spinner,
      // no dismissed banner, and no collapse back to the first page.
      if (!background) {
        setLoading(true);
        setError(null);
      }
      const query = appliedQueryRef.current;
      try {
        const result = await readSnapshot(null, query);
        if (!mountedRef.current || generation !== refreshGenerationRef.current) return false;
        const authoritative = result.snapshot;
        if (!authoritative) {
          if (!background) setError(result.error);
          return false;
        }
        // A background poll splices its page over rows the previous filter produced, so only a
        // foreground read proves the whole list on screen belongs to `query`.
        if (!background) settledQueryRef.current = query;
        setSnapshot((current) =>
          background && current ? mergeKnowledgeSnapshot(current, authoritative) : authoritative,
        );
        return true;
      } finally {
        if (!background && mountedRef.current) setLoading(false);
      }
    },
    [canManage, readSnapshot],
  );

  const refresh = useCallback(() => loadSnapshot(false), [loadSnapshot]);
  const pollSnapshot = useCallback(() => loadSnapshot(true), [loadSnapshot]);
  const { uploadQueue, refreshUploadQueue, ensureUploadQueueHydrated } = useKnowledgeUploadQueue({
    canManage,
    managementIdentity,
    serverUploads: snapshot?.uploads.items,
    pollSnapshot,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
      loadMoreOperationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    refreshGenerationRef.current += 1;
    loadMoreOperationRef.current += 1;
    setSnapshot(null);
    resetAudit();
    setBusy(null);
    setError((current) => (canManage || current !== REAUTHENTICATION_ERROR ? null : current));
    if (canManage) void refresh();
  }, [canManage, managementIdentity, refresh, resetAudit]);

  // Every read is pinned to `appliedQueryRef`, so the new filter has to be claimed the moment the
  // debounce fires or retries would keep re-reading the query the operator already left behind.
  // Claiming it does not mean the rows arrived: one throttled or superseded read would otherwise
  // leave the previous filter's documents on screen with nothing left to re-read them. Retry a
  // bounded number of times until a snapshot settles on the query that was typed.
  useEffect(() => {
    if (!canManage || trimmedQuery === settledQueryRef.current) return;
    let cancelled = false;
    let timer = 0;
    const attempt = async (remaining: number) => {
      if (cancelled || settledQueryRef.current === trimmedQuery) return;
      appliedQueryRef.current = trimmedQuery;
      let settled = false;
      try {
        settled = await refresh();
      } catch {
        settled = false;
      }
      if (settled || cancelled || remaining === 0) return;
      timer = window.setTimeout(() => void attempt(remaining - 1), QUERY_RETRY_DELAY_MS);
    };
    timer = window.setTimeout(() => void attempt(QUERY_RETRY_LIMIT), QUERY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canManage, refresh, trimmedQuery]);

  const confirmAuditRequest = useCallback(
    async (requestId: string, expectedIdentity: string | null): Promise<boolean> => {
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const result = await submitCommand({
          command: 'knowledge.audit.read',
          payload: { cursor, pageSize: 25, targetId: null },
          expectedRevision: null,
        });
        if (managementIdentityRef.current !== expectedIdentity || !result.ok) return false;
        const page = normalizeKnowledgeAuditPage(result.value);
        if (!page) return false;
        if (page.items.some((event) => event.requestId === requestId)) return true;
        cursor = page.nextCursor;
        if (cursor && seenCursors.has(cursor)) return false;
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
      return false;
    },
    [submitCommand],
  );

  const readConfirmationSnapshot = useCallback(
    async (
      initial: KnowledgeManagementSnapshot,
      collections: KnowledgeConfirmationCollection[],
      expectedIdentity: string | null,
    ): Promise<KnowledgeManagementSnapshot | null> => {
      let authoritative = initial;
      for (const collection of collections) {
        const seenCursors = new Set<string>();
        const seenIds = new Set(authoritative[collection].items.map(({ id }) => id));
        let cursor = authoritative[collection].nextCursor;
        while (cursor) {
          if (seenCursors.has(cursor)) return null;
          seenCursors.add(cursor);
          const next = await readSnapshot(cursor, '');
          if (
            !next.snapshot ||
            !mountedRef.current ||
            managementIdentityRef.current !== expectedIdentity
          ) {
            return null;
          }
          authoritative = {
            ...authoritative,
            [collection]: {
              items: [
                ...authoritative[collection].items,
                ...next.snapshot[collection].items.filter(({ id }) => !seenIds.has(id)),
              ],
              nextCursor: next.snapshot[collection].nextCursor,
            },
          };
          for (const { id } of next.snapshot[collection].items) seenIds.add(id);
          cursor = next.snapshot[collection].nextCursor;
        }
      }
      return authoritative;
    },
    [readSnapshot],
  );

  const confirmMutation = useCallback(
    async (
      predicate: KnowledgeMutationConfirmation | undefined,
      expectedIdentity: string | null,
      collections: KnowledgeConfirmationCollection[] = [],
      requestId: string | null = null,
      requireAudit = false,
    ): Promise<boolean> => {
      if (!predicate || !canManage || managementIdentityRef.current !== expectedIdentity) {
        return false;
      }
      // Confirmation has to see every document, not just the ones the active filter admits.
      const initial = await readSnapshot(null, '');
      if (
        !initial.snapshot ||
        !mountedRef.current ||
        managementIdentityRef.current !== expectedIdentity
      ) {
        return false;
      }
      const authoritative = await readConfirmationSnapshot(
        initial.snapshot,
        collections,
        expectedIdentity,
      );
      if (!authoritative) return false;
      setSnapshot(authoritative);
      if (requireAudit) {
        return requestId !== null && (await confirmAuditRequest(requestId, expectedIdentity));
      }
      return predicate(authoritative);
    },
    [canManage, confirmAuditRequest, readConfirmationSnapshot, readSnapshot],
  );

  const settleConfirmedMutation = useCallback(async () => {
    setError(null);
    await Promise.all([
      // The confirmation snapshot is unfiltered, so realign it with the active filter.
      appliedQueryRef.current ? refresh() : Promise.resolve(true),
      refreshUploadQueue(),
      Promise.resolve(onLibraryChanged?.()),
    ]);
  }, [onLibraryChanged, refresh, refreshUploadQueue]);

  const execute = useCallback(
    async (
      request: PublicPrivilegedCommandRequest,
      busyKey: string,
      confirmation?: KnowledgeMutationConfirmation,
      confirmationCollections?: KnowledgeConfirmationCollection[],
      requireAudit = true,
    ): Promise<boolean> => {
      if (!canManage) return false;
      const expectedIdentity = managementIdentity;
      setBusy(busyKey);
      setError(null);
      try {
        const result = await submitCommand(request);
        if (managementIdentityRef.current !== expectedIdentity) return false;
        if (!result.ok) {
          if (
            ['expired', 'replayed', 'conflict', 'server-error'].includes(result.error) &&
            (await confirmMutation(
              confirmation,
              expectedIdentity,
              confirmationCollections,
              result.requestId ?? null,
              requireAudit,
            ))
          ) {
            await settleConfirmedMutation();
            return true;
          }
          setError(knowledgeCommandError(result));
          return false;
        }
        await Promise.all([refresh(), refreshUploadQueue(), Promise.resolve(onLibraryChanged?.())]);
        return true;
      } catch {
        if (
          await confirmMutation(
            confirmation,
            expectedIdentity,
            confirmationCollections,
            null,
            requireAudit,
          )
        ) {
          await settleConfirmedMutation();
          return true;
        }
        setError(KNOWLEDGE_MANAGEMENT_ERRORS['server-error']);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [
      canManage,
      confirmMutation,
      managementIdentity,
      onLibraryChanged,
      refresh,
      refreshUploadQueue,
      settleConfirmedMutation,
      submitCommand,
    ],
  );

  const stagePdfs = useCallback(
    async (replacementDocumentId?: string): Promise<KnowledgeUploadSelectionResult> => {
      if (!canManage || !globalThis.api?.selectAndQueueKnowledgePdfs) {
        return { ok: false, error: canManage ? 'upload-failed' : 'unauthorized' };
      }
      setBusy('upload');
      setError(null);
      try {
        const result = await globalThis.api.selectAndQueueKnowledgePdfs(replacementDocumentId);
        if (!result.ok && result.error !== 'cancelled') {
          setError(
            result.error === 'invalid-file'
              ? 'Choose up to 100 valid PDF files with unique filenames.'
              : 'Relay could not queue the selected PDF files.',
          );
        }
        if (result.ok) {
          await refreshUploadQueue();
          await refresh();
        }
        return result;
      } finally {
        setBusy(null);
      }
    },
    [canManage, refresh, refreshUploadQueue],
  );

  const runUploadControl = useCallback(
    async (
      busyKey: string,
      operation: (() => Promise<boolean>) | undefined,
      message: string,
      refreshAfterSuccess = false,
    ) => {
      if (!canManage || !operation) return false;
      setBusy(busyKey);
      setError(null);
      try {
        const ok = await operation();
        if (!ok) {
          setError(message);
          return false;
        }
        if (refreshAfterSuccess) {
          await Promise.all([refresh(), refreshUploadQueue()]);
        }
        return true;
      } catch {
        setError(message);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [canManage, refresh, refreshUploadQueue],
  );

  const loadMore = useCallback(
    async (page: 'documents' | 'trash' | 'uploads'): Promise<boolean> => {
      const cursor = snapshot?.[page].nextCursor;
      const expectedIdentity = managementIdentityRef.current;
      const expectedQuery = appliedQueryRef.current;
      if (!canManage || !cursor || !expectedIdentity || visibleQueryRef.current !== expectedQuery) {
        return false;
      }
      const expectedGeneration = refreshGenerationRef.current;
      const operation = loadMoreOperationRef.current + 1;
      loadMoreOperationRef.current = operation;
      const busyKey = `more:${page}`;
      const isCurrent = () =>
        mountedRef.current &&
        managementIdentityRef.current === expectedIdentity &&
        refreshGenerationRef.current === expectedGeneration &&
        appliedQueryRef.current === expectedQuery &&
        visibleQueryRef.current === expectedQuery;
      setBusy(busyKey);
      setError(null);
      try {
        const result = await readSnapshot(cursor, expectedQuery);
        if (!isCurrent()) return false;
        const next = result.snapshot;
        if (!next) {
          setError(result.error);
          return false;
        }
        setSnapshot((current) => {
          if (!isCurrent()) return current;
          if (!current) return next;
          const existing = new Set(current[page].items.map(({ id }) => id));
          const items = next[page].items.filter(({ id }) => !existing.has(id));
          return {
            ...current,
            [page]: {
              items: [...current[page].items, ...items],
              nextCursor: next[page].nextCursor,
            },
          };
        });
        return true;
      } finally {
        if (
          mountedRef.current &&
          managementIdentityRef.current === expectedIdentity &&
          loadMoreOperationRef.current === operation
        ) {
          setBusy((current) => (current === busyKey ? null : current));
        }
      }
    },
    [canManage, readSnapshot, snapshot],
  );

  const deletePermanently = useCallback(
    async (documentId: string, expectedRevision: number, password: string): Promise<boolean> => {
      setBusy(`delete:${documentId}`);
      setError(null);
      const proof = await reauthenticate(password);
      setBusy(null);
      if (!proof) {
        setError(REAUTHENTICATION_ERROR);
        return false;
      }
      const deleted = await execute(
        {
          command: 'knowledge.document.delete',
          payload: { documentId, expectedRevision, reauthRequestId: proof.proofId },
          expectedRevision: null,
        },
        `delete:${documentId}`,
        (authoritative) =>
          !authoritative.documents.items.some(({ id }) => id === documentId) &&
          !authoritative.trash.items.some(({ id }) => id === documentId),
        ['documents', 'trash'],
      );
      if (deleted) {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                documents: {
                  ...current.documents,
                  items: current.documents.items.filter(({ id }) => id !== documentId),
                },
                trash: {
                  ...current.trash,
                  items: current.trash.items.filter(({ id }) => id !== documentId),
                },
              }
            : current,
        );
      }
      return deleted;
    },
    [execute, reauthenticate],
  );

  const cancelUpload = useCallback(
    async (uploadId: string): Promise<boolean> => {
      const hydratedQueue = await ensureUploadQueueHydrated();
      if (!hydratedQueue) return false;
      const hasLocalQueueItem = hydratedQueue.items.some(
        (item) => item.id === uploadId || item.uploadId === uploadId,
      );
      const cancelKnowledgeUpload = globalThis.api?.cancelKnowledgeUpload;
      const cancelDirectly = cancelKnowledgeUpload
        ? () => cancelKnowledgeUpload(uploadId)
        : undefined;
      if (hasLocalQueueItem) {
        return runUploadControl(
          `cancel:${uploadId}`,
          cancelDirectly,
          'Relay could not cancel this PDF.',
          true,
        );
      }
      const upload = snapshot?.uploads.items.find(({ id }) => id === uploadId);
      if (!upload) {
        return runUploadControl(
          `cancel:${uploadId}`,
          cancelDirectly,
          'Relay could not cancel this PDF.',
          true,
        );
      }

      const cancelled = await execute(
        {
          command: 'knowledge.upload.file.cancel',
          payload: { uploadId, expectedRevision: upload.revision },
          expectedRevision: null,
        },
        `cancel:${uploadId}`,
        (authoritative) =>
          !authoritative.uploads.items.some(
            (candidate) => candidate.id === uploadId && candidate.state !== 'cancelled',
          ),
        ['uploads'],
        false,
      );
      return cancelled;
    },
    [ensureUploadQueueHydrated, execute, runUploadControl, snapshot?.uploads.items],
  );
  const mutationActions = createKnowledgeMutationActions({ execute, snapshot });

  return {
    canManage,
    snapshot,
    auditEvents,
    auditNextCursor,
    loading,
    busy,
    uploadQueue,
    error,
    refresh,
    readAudit,
    loadMoreAudit,
    loadMore,
    stagePdfs,
    // Each closure captures the exact callable whose presence was checked instead of re-reading
    // `globalThis.api` after the control operation begins.
    pauseUploadBatch: (batchId: string) => {
      const pauseKnowledgeUploadBatch = globalThis.api?.pauseKnowledgeUploadBatch;
      return runUploadControl(
        `pause:${batchId}`,
        pauseKnowledgeUploadBatch ? () => pauseKnowledgeUploadBatch(batchId) : undefined,
        'Relay could not pause this upload batch.',
      );
    },
    resumeUploadBatch: (batchId: string) => {
      const resumeKnowledgeUploadBatch = globalThis.api?.resumeKnowledgeUploadBatch;
      return runUploadControl(
        `resume:${batchId}`,
        resumeKnowledgeUploadBatch ? () => resumeKnowledgeUploadBatch(batchId) : undefined,
        'Relay could not resume this upload batch.',
      );
    },
    retryUpload: (uploadId: string) => {
      const retryKnowledgeUpload = globalThis.api?.retryKnowledgeUpload;
      return runUploadControl(
        `retry:${uploadId}`,
        retryKnowledgeUpload ? () => retryKnowledgeUpload(uploadId) : undefined,
        'Relay could not retry this PDF.',
      );
    },
    reselectUploadSource: (uploadId: string) => {
      const reselectKnowledgeUploadSource = globalThis.api?.reselectKnowledgeUploadSource;
      return runUploadControl(
        `reselect:${uploadId}`,
        reselectKnowledgeUploadSource ? () => reselectKnowledgeUploadSource(uploadId) : undefined,
        'Choose the same unchanged PDF to resume this upload.',
      );
    },
    cancelUpload,
    cancelUploadBatch: (batchId: string) => {
      const cancelKnowledgeUploadBatch = globalThis.api?.cancelKnowledgeUploadBatch;
      return runUploadControl(
        `cancel-batch:${batchId}`,
        cancelKnowledgeUploadBatch ? () => cancelKnowledgeUploadBatch(batchId) : undefined,
        'Relay could not cancel this upload batch.',
      );
    },
    clearError: () => setError(null),
    ...mutationActions,
    deletePermanently,
  };
}
