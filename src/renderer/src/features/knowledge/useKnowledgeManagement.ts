import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicPrivilegedCommandRequest } from '@shared/ipc';
import {
  knowledgeCategoryKey,
  normalizeKnowledgeAuditEventView,
  normalizeKnowledgeManagementSnapshot,
  normalizeKnowledgeUploadQueueView,
  type KnowledgeAuditEventView,
  type KnowledgeCategoryRecord,
  type KnowledgeDocumentType,
  type KnowledgeManagementSnapshot,
  type KnowledgePage,
  type KnowledgeUploadQueueView,
  type KnowledgeUploadSelectionResult,
} from '@shared/knowledge';
import type { PrivilegedCommandError, PrivilegedCommandResult } from '@shared/privilegedCommands';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';

// Typed as a total record so a new PrivilegedCommandError cannot be added without copy: an
// unmapped code used to make commandError() hand `undefined` to the error banner.
const SAFE_ERRORS: Record<PrivilegedCommandError, string> = {
  unauthorized: 'Wiki publisher access is required.',
  locked: 'Publisher access is signed out. Sign in again.',
  offline: 'Wiki management is unavailable while Relay is offline.',
  'pairing-required': 'Pair this workstation before managing the Wiki.',
  'invalid-request': 'Relay rejected the Wiki request.',
  'insufficient-storage': 'Relay does not have enough storage to complete that action.',
  'duplicate-file-name':
    'A published document with this PDF filename already exists. Replace it or rename the PDF.',
  expired: 'The request expired. Try again.',
  replayed: 'Relay could not safely repeat that request.',
  conflict: 'This item changed on the server. Review the refreshed information and try again.',
  // Deliberately not "refresh and try again": a throttled request has not lost a race, and
  // retrying immediately only spends more of the budget.
  'rate-limited': 'Too many Wiki requests. Wait a few minutes and try again.',
  'server-error': 'Relay could not complete the Wiki request.',
};

const EMPTY_UPLOAD_QUEUE: KnowledgeUploadQueueView = {
  restartRecovery: false,
  activeBatchId: null,
  totalBytes: 0,
  acknowledgedBytes: 0,
  items: [],
};

const REAUTHENTICATION_ERROR = 'Password confirmation was not accepted. Try again.';

const QUERY_DEBOUNCE_MS = 250;
// The signed-command bucket refills one token per second, so retrying any sooner would only spend
// another throttled request. Two extra attempts ride out a lost read without letting a filter that
// keeps failing poll the shared budget forever; the error banner is what reports the rest.
const QUERY_RETRY_DELAY_MS = 1_000;
const QUERY_RETRY_LIMIT = 2;

function commandError(result: Extract<PrivilegedCommandResult, { ok: false }>): string {
  return SAFE_ERRORS[result.error];
}

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

function normalizeAuditPage(value: unknown): KnowledgePage<KnowledgeAuditEventView> | null {
  if (!value || typeof value !== 'object' || !('items' in value)) return null;
  const { items, nextCursor } = value as { items: unknown; nextCursor?: unknown };
  if (!Array.isArray(items)) return null;
  if (nextCursor !== null && typeof nextCursor !== 'string') return null;
  const normalized = items.map(normalizeKnowledgeAuditEventView);
  return normalized.includes(null)
    ? null
    : { items: normalized as KnowledgeAuditEventView[], nextCursor };
}

type SnapshotRead =
  { snapshot: KnowledgeManagementSnapshot; error: null } | { snapshot: null; error: string };

type MutationConfirmation = (snapshot: KnowledgeManagementSnapshot) => boolean;
type ConfirmationCollection = 'documents' | 'trash' | 'uploads';
type DocumentAssignment = { documentId: string; expectedRevision: number };

function confirmsDocumentAssignments(
  authoritative: KnowledgeManagementSnapshot,
  documents: DocumentAssignment[],
  categoryId: string,
): boolean {
  return documents.every(({ documentId, expectedRevision }) => {
    const current = authoritative.documents.items.find(({ id }) => id === documentId);
    return current?.categoryId === categoryId && current.revision > expectedRevision;
  });
}

export function useKnowledgeManagement(
  onLibraryChanged?: () => void | Promise<void>,
  documentQuery = '',
) {
  const { session, submitCommand, reauthenticate } = usePrivilegedAccess();
  const [snapshot, setSnapshot] = useState<KnowledgeManagementSnapshot | null>(null);
  const [auditEvents, setAuditEvents] = useState<KnowledgeAuditEventView[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadQueue, setUploadQueue] = useState<KnowledgeUploadQueueView>(EMPTY_UPLOAD_QUEUE);
  const [error, setError] = useState<string | null>(null);
  const canManage = session.state === 'active' && session.capabilities.includes('knowledge.manage');
  const managementIdentity = canManage
    ? `${session.accountId}\u0000${session.deviceId ?? 'server-local'}`
    : null;
  const managementIdentityRef = useRef(managementIdentity);
  const refreshGenerationRef = useRef(0);
  const uploadQueueRef = useRef<KnowledgeUploadQueueView>(EMPTY_UPLOAD_QUEUE);
  const uploadQueueGenerationRef = useRef(0);
  const uploadQueueHydratedIdentityRef = useRef<string | null>(null);
  const uploadQueueRequestRef = useRef<{
    identity: string;
    promise: Promise<KnowledgeUploadQueueView | null>;
  } | null>(null);
  const mountedRef = useRef(true);
  const trimmedQuery = documentQuery.trim();
  // Reads stay pinned to the query the operator can already see so a cursor issued for one
  // filter is never spent against another.
  const appliedQueryRef = useRef(trimmedQuery);
  // `appliedQueryRef` advances the moment a read is dispatched, so on its own it cannot tell a
  // filter that reached the list from one whose read was throttled or superseded. Record the query
  // a snapshot actually came back for separately; the debounce below retries against this.
  const settledQueryRef = useRef(trimmedQuery);
  managementIdentityRef.current = managementIdentity;
  uploadQueueRef.current = uploadQueue;

  const refreshUploadQueue = useCallback((): Promise<KnowledgeUploadQueueView | null> => {
    const expectedIdentity = managementIdentityRef.current;
    const readQueue = globalThis.api?.getKnowledgeUploadQueue;
    if (!expectedIdentity || !readQueue) return Promise.resolve(null);
    const generation = uploadQueueGenerationRef.current + 1;
    uploadQueueGenerationRef.current = generation;
    let operation!: Promise<KnowledgeUploadQueueView | null>;
    operation = (async () => {
      try {
        const normalized = normalizeKnowledgeUploadQueueView(await readQueue());
        if (
          !normalized ||
          !mountedRef.current ||
          generation !== uploadQueueGenerationRef.current ||
          managementIdentityRef.current !== expectedIdentity
        ) {
          return null;
        }
        uploadQueueRef.current = normalized;
        uploadQueueHydratedIdentityRef.current = expectedIdentity;
        setUploadQueue(normalized);
        return normalized;
      } finally {
        if (uploadQueueRequestRef.current?.promise === operation) {
          uploadQueueRequestRef.current = null;
        }
      }
    })();
    uploadQueueRequestRef.current = { identity: expectedIdentity, promise: operation };
    return operation;
  }, []);

  const ensureUploadQueueHydrated =
    useCallback(async (): Promise<KnowledgeUploadQueueView | null> => {
      const expectedIdentity = managementIdentityRef.current;
      if (!expectedIdentity) return null;
      if (uploadQueueHydratedIdentityRef.current === expectedIdentity) {
        return uploadQueueRef.current;
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const pending = uploadQueueRequestRef.current;
        const queue = await (pending?.identity === expectedIdentity
          ? pending.promise
          : refreshUploadQueue());
        if (managementIdentityRef.current !== expectedIdentity) return null;
        if (queue) return queue;
        if (uploadQueueHydratedIdentityRef.current === expectedIdentity) {
          return uploadQueueRef.current;
        }
      }
      return null;
    }, [refreshUploadQueue]);

  const readSnapshot = useCallback(
    async (cursor: string | null, query = appliedQueryRef.current): Promise<SnapshotRead> => {
      const result = await submitCommand({
        command: 'knowledge.snapshot.read',
        payload: { query, cursor, pageSize: 100 },
        expectedRevision: null,
      });
      if (!result.ok) {
        return { snapshot: null, error: commandError(result) };
      }
      const normalized = normalizeKnowledgeManagementSnapshot(result.value);
      if (!normalized) {
        return { snapshot: null, error: 'Relay returned an invalid Wiki snapshot.' };
      }
      return { snapshot: normalized, error: null };
    },
    [submitCommand],
  );

  const requestSnapshot = useCallback(
    async (cursor: string | null): Promise<KnowledgeManagementSnapshot | null> => {
      const result = await readSnapshot(cursor);
      if (!result.snapshot) setError(result.error);
      return result.snapshot;
    },
    [readSnapshot],
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
      uploadQueueGenerationRef.current += 1;
      uploadQueueRequestRef.current = null;
    };
  }, []);

  useEffect(() => {
    refreshGenerationRef.current += 1;
    uploadQueueGenerationRef.current += 1;
    uploadQueueRequestRef.current = null;
    uploadQueueHydratedIdentityRef.current = null;
    uploadQueueRef.current = EMPTY_UPLOAD_QUEUE;
    setSnapshot(null);
    setAuditEvents([]);
    setAuditNextCursor(null);
    setUploadQueue(EMPTY_UPLOAD_QUEUE);
    setError((current) => (canManage || current !== REAUTHENTICATION_ERROR ? null : current));
    if (canManage) void refresh();
  }, [canManage, managementIdentity, refresh]);

  useEffect(() => {
    if (!canManage || !managementIdentity) return;
    let active = true;
    const expectedIdentity = managementIdentity;
    const acceptQueue = (value: unknown) => {
      const normalized = normalizeKnowledgeUploadQueueView(value);
      if (active && normalized && managementIdentityRef.current === expectedIdentity) {
        uploadQueueGenerationRef.current += 1;
        uploadQueueHydratedIdentityRef.current = expectedIdentity;
        uploadQueueRef.current = normalized;
        setUploadQueue(normalized);
      }
    };
    void refreshUploadQueue();
    const unsubscribe = globalThis.api?.onKnowledgeUploadQueueChanged?.(acceptQueue);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [canManage, managementIdentity, refreshUploadQueue]);

  useEffect(() => {
    if (!canManage || uploadQueue.items.length === 0) return;
    const terminal = new Set(['ready', 'failed', 'cancelled', 'published']);
    const serverStates = new Map(
      (snapshot?.uploads.items ?? []).map((upload) => [upload.id, upload.state]),
    );
    const needsServerRefresh = uploadQueue.items.some((item) => {
      if (item.cancelPending) return true;
      if (terminal.has(item.state)) return false;
      return !item.uploadId || !terminal.has(serverStates.get(item.uploadId) ?? '');
    });
    if (!needsServerRefresh) return;
    const timer = window.setInterval(() => {
      void pollSnapshot();
      void refreshUploadQueue();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [canManage, pollSnapshot, refreshUploadQueue, snapshot?.uploads.items, uploadQueue.items]);

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
        const page = normalizeAuditPage(result.value);
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
      collections: ConfirmationCollection[],
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
      predicate: MutationConfirmation | undefined,
      expectedIdentity: string | null,
      collections: ConfirmationCollection[] = [],
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
      confirmation?: MutationConfirmation,
      confirmationCollections?: ConfirmationCollection[],
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
          setError(commandError(result));
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
        setError(SAFE_ERRORS['server-error']);
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

  const requestAuditPage = useCallback(
    async (cursor: string | null): Promise<KnowledgePage<KnowledgeAuditEventView> | null> => {
      const result = await submitCommand({
        command: 'knowledge.audit.read',
        payload: { cursor, pageSize: 25, targetId: null },
        expectedRevision: null,
      });
      if (!result.ok) {
        setError(commandError(result));
        return null;
      }
      const normalized = normalizeAuditPage(result.value);
      if (!normalized) setError('Relay returned an invalid Wiki audit history.');
      return normalized;
    },
    [submitCommand],
  );

  const readAudit = useCallback(async (): Promise<boolean> => {
    if (!canManage) return false;
    setBusy('audit');
    setError(null);
    try {
      const page = await requestAuditPage(null);
      if (!page) return false;
      setAuditEvents(page.items);
      setAuditNextCursor(page.nextCursor);
      return true;
    } finally {
      setBusy(null);
    }
  }, [canManage, requestAuditPage]);

  const loadMoreAudit = useCallback(async (): Promise<boolean> => {
    if (!canManage || !auditNextCursor) return false;
    setBusy('more:audit');
    setError(null);
    try {
      const page = await requestAuditPage(auditNextCursor);
      if (!page) return false;
      setAuditEvents((current) => {
        const existing = new Set(current.map(({ id }) => id));
        return [...current, ...page.items.filter(({ id }) => !existing.has(id))];
      });
      setAuditNextCursor(page.nextCursor);
      return true;
    } finally {
      setBusy(null);
    }
  }, [auditNextCursor, canManage, requestAuditPage]);

  const loadMore = useCallback(
    async (page: 'documents' | 'trash' | 'uploads'): Promise<boolean> => {
      const cursor = snapshot?.[page].nextCursor;
      if (!cursor) return false;
      setBusy(`more:${page}`);
      setError(null);
      try {
        const next = await requestSnapshot(cursor);
        if (!next) return false;
        setSnapshot((current) => {
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
        setBusy(null);
      }
    },
    [requestSnapshot, snapshot],
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
    retrySearchIndex: (documentId: string) =>
      execute(
        {
          command: 'knowledge.document.search-index.retry',
          payload: { documentId },
          expectedRevision: null,
        },
        `search-index:${documentId}`,
        (authoritative) =>
          authoritative.documents.items.some(
            (document) => document.id === documentId && document.searchIndexState !== 'failed',
          ),
        ['documents'],
        false,
      ),
    publish: (
      uploadId: string,
      title: string,
      category: string,
      documentType: KnowledgeDocumentType = 'sop',
    ) =>
      execute(
        {
          command: 'knowledge.document.publish',
          payload: { uploadId, title, category, documentType },
          expectedRevision: null,
        },
        `publish:${uploadId}`,
        (authoritative) =>
          !authoritative.uploads.items.some(
            ({ id, state }) => id === uploadId && state !== 'published',
          ) &&
          authoritative.documents.items.some(
            (document) =>
              document.lifecycleState === 'active' &&
              document.displayTitle === title.trim().replace(/\s+/g, ' ') &&
              knowledgeCategoryKey(document.category) === knowledgeCategoryKey(category) &&
              document.documentType === documentType,
          ),
        ['documents', 'uploads'],
        true,
      ),
    replace: (uploadId: string, documentId: string, expectedRevision: number) => {
      const current = snapshot?.documents.items.find(({ id }) => id === documentId);
      return execute(
        {
          command: 'knowledge.document.replace',
          payload: { uploadId, documentId, expectedRevision },
          expectedRevision: null,
        },
        `replace:${documentId}`,
        (authoritative) =>
          !authoritative.uploads.items.some(
            ({ id, state }) => id === uploadId && state !== 'published',
          ) &&
          authoritative.documents.items.some(
            (document) =>
              document.id === documentId &&
              document.revision > expectedRevision &&
              (!current ||
                (document.displayTitle === current.displayTitle &&
                  document.categoryId === current.categoryId &&
                  document.documentType === current.documentType &&
                  document.fileName === current.fileName &&
                  document.publishedAt === current.publishedAt &&
                  document.publishedByName === current.publishedByName)),
          ),
        ['documents', 'uploads'],
        true,
      );
    },
    setTitle: (documentId: string, expectedRevision: number, title: string) =>
      execute(
        {
          command: 'knowledge.document.title.set',
          payload: { documentId, expectedRevision, title },
          expectedRevision: null,
        },
        `title:${documentId}`,
        (authoritative) =>
          authoritative.documents.items.some(
            (document) =>
              document.id === documentId &&
              document.revision > expectedRevision &&
              document.displayTitle === title,
          ),
      ),
    setCategory: (documentId: string, expectedRevision: number, category: string) =>
      execute(
        {
          command: 'knowledge.document.category.set',
          payload: { documentId, expectedRevision, category },
          expectedRevision: null,
        },
        `category:${documentId}`,
        (authoritative) =>
          authoritative.documents.items.some(
            (document) =>
              document.id === documentId &&
              document.revision > expectedRevision &&
              document.category === category,
          ),
      ),
    renameCategory: (from: string, to: string, expectedDocumentRevisions: Record<string, number>) =>
      execute(
        {
          command: 'knowledge.category.rename',
          payload: { from, to, expectedDocumentRevisions },
          expectedRevision: null,
        },
        `category:${from}`,
        (authoritative) =>
          authoritative.categories.some(({ name }) => name === to) &&
          !authoritative.categories.some(({ name }) => name === from) &&
          !authoritative.documents.items.some(({ category }) => category === from),
      ),
    createCategory: (name: string, afterCategoryId: string | null) =>
      execute(
        {
          command: 'knowledge.category.create',
          payload: { name, afterCategoryId },
          expectedRevision: null,
        },
        'category:create',
        (authoritative) => authoritative.categories.some(({ name: current }) => current === name),
      ),
    setCategoryName: (categoryId: string, name: string, expectedRevision: number) =>
      execute(
        {
          command: 'knowledge.category.name.set',
          payload: { categoryId, name, expectedRevision },
          expectedRevision: null,
        },
        `category:name:${categoryId}`,
        (authoritative) =>
          authoritative.categories.some(
            (category) =>
              category.id === categoryId &&
              category.name === name &&
              category.revision > expectedRevision,
          ),
      ),
    setCategoryOrder: (categories: KnowledgeCategoryRecord[]) =>
      execute(
        {
          command: 'knowledge.category.order.set',
          payload: {
            orderedCategoryIds: categories.map(({ id }) => id),
            expectedRevisions: Object.fromEntries(
              categories.map(({ id, revision }) => [id, revision]),
            ),
          },
          expectedRevision: null,
        },
        'category:order',
        (authoritative) => {
          const expectedIds = categories.map(({ id }) => id);
          return (
            authoritative.categories.length === expectedIds.length &&
            authoritative.categories.every(({ id }, index) => id === expectedIds[index])
          );
        },
      ),
    deleteCategory: (
      categoryId: string,
      replacementCategoryId: string,
      expectedRevision: number,
      expectedDocumentRevisions: Record<string, number>,
    ) =>
      execute(
        {
          command: 'knowledge.category.delete',
          payload: {
            categoryId,
            replacementCategoryId,
            expectedRevision,
            expectedDocumentRevisions,
          },
          expectedRevision: null,
        },
        `category:delete:${categoryId}`,
        (authoritative) =>
          !authoritative.categories.some(({ id }) => id === categoryId) &&
          !authoritative.documents.items.some(
            ({ categoryId: currentCategoryId }) => currentCategoryId === categoryId,
          ),
      ),
    setDocumentMetadata: (
      document: { id: string; revision: number },
      title: string,
      categoryId: string,
      documentType: KnowledgeDocumentType,
    ) =>
      execute(
        {
          command: 'knowledge.document.metadata.set',
          payload: {
            documentId: document.id,
            title,
            categoryId,
            documentType,
            expectedRevision: document.revision,
          },
          expectedRevision: null,
        },
        `metadata:${document.id}`,
        (authoritative) =>
          authoritative.documents.items.some(
            (current) =>
              current.id === document.id &&
              current.revision > document.revision &&
              current.displayTitle === title &&
              current.categoryId === categoryId &&
              current.documentType === documentType,
          ),
      ),
    assignDocumentCategories: (categoryId: string, documents: DocumentAssignment[]) =>
      execute(
        {
          command: 'knowledge.documents.category.assign',
          payload: { categoryId, documents },
          expectedRevision: null,
        },
        'documents:category',
        (authoritative) => confirmsDocumentAssignments(authoritative, documents, categoryId),
      ),
    trash: (payload: { documentId: string; expectedRevision: number }) =>
      execute(
        { command: 'knowledge.document.trash', payload, expectedRevision: null },
        `trash:${payload.documentId}`,
        (authoritative) =>
          !authoritative.documents.items.some(({ id }) => id === payload.documentId) &&
          authoritative.trash.items.some(
            (document) =>
              document.id === payload.documentId &&
              document.revision > payload.expectedRevision &&
              document.lifecycleState === 'trashed',
          ),
      ),
    restore: (payload: { documentId: string; expectedRevision: number }) =>
      execute(
        { command: 'knowledge.document.restore', payload, expectedRevision: null },
        `restore:${payload.documentId}`,
        (authoritative) =>
          !authoritative.trash.items.some(({ id }) => id === payload.documentId) &&
          authoritative.documents.items.some(
            (document) =>
              document.id === payload.documentId &&
              document.revision > payload.expectedRevision &&
              document.lifecycleState === 'active',
          ),
      ),
    deletePermanently,
  };
}
