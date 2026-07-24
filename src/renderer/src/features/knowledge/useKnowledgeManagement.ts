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
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';

const SAFE_ERRORS = {
  unauthorized: 'Wiki publisher access is required.',
  locked: 'Publisher access is signed out. Sign in again.',
  offline: 'Wiki management is unavailable while Relay is offline.',
  'pairing-required': 'Pair this workstation before managing the Wiki.',
  'invalid-request': 'Relay rejected the Wiki request.',
  'duplicate-file-name':
    'A published document with this PDF filename already exists. Replace it or rename the PDF.',
  expired: 'The request expired. Try again.',
  replayed: 'Relay could not safely repeat that request.',
  conflict: 'This item changed on the server. Review the refreshed information and try again.',
  'server-error': 'Relay could not complete the Wiki request.',
} as const;

const EMPTY_UPLOAD_QUEUE: KnowledgeUploadQueueView = {
  restartRecovery: false,
  activeBatchId: null,
  totalBytes: 0,
  acknowledgedBytes: 0,
  items: [],
};

const REAUTHENTICATION_ERROR = 'Password confirmation was not accepted. Try again.';

function commandError(result: Extract<PrivilegedCommandResult, { ok: false }>): string {
  return SAFE_ERRORS[result.error];
}

function normalizeAuditPage(value: unknown): KnowledgePage<KnowledgeAuditEventView> | null {
  if (!value || typeof value !== 'object' || !('items' in value)) return null;
  const { items, nextCursor } = value as { items: unknown; nextCursor?: unknown };
  if (!Array.isArray(items)) return null;
  if (nextCursor !== null && typeof nextCursor !== 'string') return null;
  const normalized = items.map(normalizeKnowledgeAuditEventView);
  return normalized.some((item) => item === null)
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

export function useKnowledgeManagement(onLibraryChanged?: () => void | Promise<void>) {
  const { session, submitCommand, reauthenticate } = usePrivilegedAccess();
  const [snapshot, setSnapshot] = useState<KnowledgeManagementSnapshot | null>(null);
  const [auditEvents, setAuditEvents] = useState<KnowledgeAuditEventView[]>([]);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadQueue, setUploadQueue] = useState<KnowledgeUploadQueueView>(EMPTY_UPLOAD_QUEUE);
  const [error, setError] = useState<string | null>(null);
  const canManage = session.state === 'active' && session.capabilities.includes('knowledge.manage');
  const managementIdentity = canManage ? session.accountId : null;
  const managementIdentityRef = useRef(managementIdentity);
  const refreshGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  managementIdentityRef.current = managementIdentity;

  const refreshUploadQueue = useCallback(async (): Promise<KnowledgeUploadQueueView | null> => {
    const queue = await globalThis.api?.getKnowledgeUploadQueue?.();
    const normalized = normalizeKnowledgeUploadQueueView(queue);
    if (normalized) setUploadQueue(normalized);
    return normalized;
  }, []);

  const readSnapshot = useCallback(
    async (cursor: string | null): Promise<SnapshotRead> => {
      const result = await submitCommand({
        command: 'knowledge.snapshot.read',
        payload: { query: '', cursor, pageSize: 100 },
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

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!canManage) {
      setSnapshot(null);
      return false;
    }
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    setLoading(true);
    setError(null);
    try {
      const result = await readSnapshot(null);
      if (!mountedRef.current || generation !== refreshGenerationRef.current) return false;
      if (!result.snapshot) {
        setError(result.error);
        return false;
      }
      setSnapshot(result.snapshot);
      return true;
    } finally {
      if (mountedRef.current && generation === refreshGenerationRef.current) setLoading(false);
    }
  }, [canManage, readSnapshot]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    refreshGenerationRef.current += 1;
    setSnapshot(null);
    setAuditEvents([]);
    setAuditNextCursor(null);
    setUploadQueue(EMPTY_UPLOAD_QUEUE);
    setError((current) => (canManage || current !== REAUTHENTICATION_ERROR ? null : current));
    if (canManage) void refresh();
  }, [canManage, refresh, session.accountId]);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    const acceptQueue = (value: unknown) => {
      const normalized = normalizeKnowledgeUploadQueueView(value);
      if (active && normalized) setUploadQueue(normalized);
    };
    void refreshUploadQueue();
    const unsubscribe = globalThis.api?.onKnowledgeUploadQueueChanged?.(acceptQueue);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [canManage, refreshUploadQueue]);

  useEffect(() => {
    if (!canManage || uploadQueue.items.length === 0) return;
    const terminal = new Set(['ready', 'failed', 'cancelled', 'published']);
    const serverStates = new Map(
      (snapshot?.uploads.items ?? []).map((upload) => [upload.id, upload.state]),
    );
    const needsServerRefresh = uploadQueue.items.some((item) => {
      if (terminal.has(item.state)) return false;
      return !item.uploadId || !terminal.has(serverStates.get(item.uploadId) ?? '');
    });
    if (!needsServerRefresh) return;
    const timer = window.setInterval(() => {
      void refresh();
      void refreshUploadQueue();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [canManage, refresh, refreshUploadQueue, snapshot?.uploads.items, uploadQueue.items]);

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
          const next = await readSnapshot(cursor);
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
      const initial = await readSnapshot(null);
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
            setError(null);
            await Promise.all([refreshUploadQueue(), Promise.resolve(onLibraryChanged?.())]);
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
          setError(null);
          await Promise.all([refreshUploadQueue(), Promise.resolve(onLibraryChanged?.())]);
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
      submitCommand,
    ],
  );

  const stagePdfs = useCallback(async (): Promise<KnowledgeUploadSelectionResult> => {
    if (!canManage || !globalThis.api?.selectAndQueueKnowledgePdfs) {
      return { ok: false, error: canManage ? 'upload-failed' : 'unauthorized' };
    }
    setBusy('upload');
    setError(null);
    try {
      const result = await globalThis.api.selectAndQueueKnowledgePdfs();
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
  }, [canManage, refresh, refreshUploadQueue]);

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
      const upload = snapshot?.uploads.items.find(({ id }) => id === uploadId);
      if (!upload) {
        return runUploadControl(
          `cancel:${uploadId}`,
          globalThis.api?.cancelKnowledgeUpload
            ? () => globalThis.api.cancelKnowledgeUpload(uploadId)
            : undefined,
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
      if (!cancelled) return false;

      if (globalThis.api?.cancelKnowledgeUpload) {
        await globalThis.api.cancelKnowledgeUpload(uploadId).catch(() => false);
      }
      return true;
    },
    [execute, runUploadControl, snapshot?.uploads.items],
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
    pauseUploadBatch: (batchId: string) =>
      runUploadControl(
        `pause:${batchId}`,
        globalThis.api?.pauseKnowledgeUploadBatch
          ? () => globalThis.api.pauseKnowledgeUploadBatch(batchId)
          : undefined,
        'Relay could not pause this upload batch.',
      ),
    resumeUploadBatch: (batchId: string) =>
      runUploadControl(
        `resume:${batchId}`,
        globalThis.api?.resumeKnowledgeUploadBatch
          ? () => globalThis.api.resumeKnowledgeUploadBatch(batchId)
          : undefined,
        'Relay could not resume this upload batch.',
      ),
    retryUpload: (uploadId: string) =>
      runUploadControl(
        `retry:${uploadId}`,
        globalThis.api?.retryKnowledgeUpload
          ? () => globalThis.api.retryKnowledgeUpload(uploadId)
          : undefined,
        'Relay could not retry this PDF.',
      ),
    reselectUploadSource: (uploadId: string) =>
      runUploadControl(
        `reselect:${uploadId}`,
        globalThis.api?.reselectKnowledgeUploadSource
          ? () => globalThis.api.reselectKnowledgeUploadSource(uploadId)
          : undefined,
        'Choose the same unchanged PDF to resume this upload.',
      ),
    cancelUpload,
    cancelUploadBatch: (batchId: string) =>
      runUploadControl(
        `cancel-batch:${batchId}`,
        globalThis.api?.cancelKnowledgeUploadBatch
          ? () => globalThis.api.cancelKnowledgeUploadBatch(batchId)
          : undefined,
        'Relay could not cancel this upload batch.',
      ),
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
