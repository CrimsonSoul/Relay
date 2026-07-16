import { useCallback, useEffect, useState } from 'react';
import type { PublicPrivilegedCommandRequest } from '@shared/ipc';
import {
  normalizeKnowledgeAuditEventView,
  normalizeKnowledgeManagementSnapshot,
  normalizeKnowledgeUploadQueueView,
  type KnowledgeAuditEventView,
  type KnowledgeManagementSnapshot,
  type KnowledgePage,
  type KnowledgeUploadQueueView,
  type KnowledgeUploadSelectionResult,
} from '@shared/knowledge';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';

const SAFE_ERRORS = {
  unauthorized: 'Knowledge Base publisher access is required.',
  locked: 'Publisher access is locked. Sign in again.',
  offline: 'Knowledge Base management is unavailable while Relay is offline.',
  'pairing-required': 'Pair this workstation before managing the Knowledge Base.',
  'invalid-request': 'Relay rejected the Knowledge Base request.',
  expired: 'The request expired. Try again.',
  replayed: 'Relay could not safely repeat that request.',
  conflict: 'This item changed on the server. Review the refreshed information and try again.',
  'server-error': 'Relay could not complete the Knowledge Base request.',
} as const;

const EMPTY_UPLOAD_QUEUE: KnowledgeUploadQueueView = {
  restartRecovery: false,
  activeBatchId: null,
  totalBytes: 0,
  acknowledgedBytes: 0,
  items: [],
};

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

  const refreshUploadQueue = useCallback(async (): Promise<KnowledgeUploadQueueView | null> => {
    const queue = await globalThis.api?.getKnowledgeUploadQueue?.();
    const normalized = normalizeKnowledgeUploadQueueView(queue);
    if (normalized) setUploadQueue(normalized);
    return normalized;
  }, []);

  const requestSnapshot = useCallback(
    async (cursor: string | null): Promise<KnowledgeManagementSnapshot | null> => {
      const result = await submitCommand({
        command: 'knowledge.snapshot.read',
        payload: { query: '', cursor, pageSize: 100 },
        expectedRevision: null,
      });
      if (!result.ok) {
        setError(commandError(result));
        return null;
      }
      const normalized = normalizeKnowledgeManagementSnapshot(result.value);
      if (!normalized) {
        setError('Relay returned an invalid Knowledge Base snapshot.');
        return null;
      }
      return normalized;
    },
    [submitCommand],
  );

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!canManage) {
      setSnapshot(null);
      return false;
    }
    setLoading(true);
    setError(null);
    try {
      const normalized = await requestSnapshot(null);
      if (!normalized) return false;
      setSnapshot(normalized);
      return true;
    } finally {
      setLoading(false);
    }
  }, [canManage, requestSnapshot]);

  useEffect(() => {
    if (canManage) void refresh();
    else {
      setSnapshot(null);
      setAuditEvents([]);
      setAuditNextCursor(null);
      setError(null);
    }
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

  const execute = useCallback(
    async (request: PublicPrivilegedCommandRequest, busyKey: string): Promise<boolean> => {
      if (!canManage) return false;
      setBusy(busyKey);
      setError(null);
      try {
        const result = await submitCommand(request);
        if (!result.ok) {
          setError(commandError(result));
          if (result.error === 'conflict') await refresh();
          return false;
        }
        await Promise.all([refresh(), refreshUploadQueue(), Promise.resolve(onLibraryChanged?.())]);
        return true;
      } finally {
        setBusy(null);
      }
    },
    [canManage, onLibraryChanged, refresh, refreshUploadQueue, submitCommand],
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
    async (busyKey: string, operation: (() => Promise<boolean>) | undefined, message: string) => {
      if (!canManage || !operation) return false;
      setBusy(busyKey);
      setError(null);
      try {
        const ok = await operation();
        if (!ok) setError(message);
        return ok;
      } finally {
        setBusy(null);
      }
    },
    [canManage],
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
      if (!normalized) setError('Relay returned an invalid Knowledge Base audit history.');
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
      const proof = await reauthenticate(password);
      setBusy(null);
      if (!proof) return false;
      return execute(
        {
          command: 'knowledge.document.delete',
          payload: { documentId, expectedRevision, reauthRequestId: proof.proofId },
          expectedRevision: null,
        },
        `delete:${documentId}`,
      );
    },
    [execute, reauthenticate],
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
    cancelUpload: (uploadId: string) =>
      runUploadControl(
        `cancel:${uploadId}`,
        globalThis.api?.cancelKnowledgeUpload
          ? () => globalThis.api.cancelKnowledgeUpload(uploadId)
          : undefined,
        'Relay could not cancel this PDF.',
      ),
    cancelUploadBatch: (batchId: string) =>
      runUploadControl(
        `cancel-batch:${batchId}`,
        globalThis.api?.cancelKnowledgeUploadBatch
          ? () => globalThis.api.cancelKnowledgeUploadBatch(batchId)
          : undefined,
        'Relay could not cancel this upload batch.',
      ),
    clearError: () => setError(null),
    publish: (uploadId: string, title: string, category: string) =>
      execute(
        {
          command: 'knowledge.document.publish',
          payload: { uploadId, title, category },
          expectedRevision: null,
        },
        `publish:${uploadId}`,
      ),
    replace: (
      uploadId: string,
      documentId: string,
      expectedRevision: number,
      title: string,
      category: string,
    ) =>
      execute(
        {
          command: 'knowledge.document.replace',
          payload: { uploadId, documentId, expectedRevision, title, category },
          expectedRevision: null,
        },
        `replace:${documentId}`,
      ),
    setTitle: (documentId: string, expectedRevision: number, title: string) =>
      execute(
        {
          command: 'knowledge.document.title.set',
          payload: { documentId, expectedRevision, title },
          expectedRevision: null,
        },
        `title:${documentId}`,
      ),
    setCategory: (documentId: string, expectedRevision: number, category: string) =>
      execute(
        {
          command: 'knowledge.document.category.set',
          payload: { documentId, expectedRevision, category },
          expectedRevision: null,
        },
        `category:${documentId}`,
      ),
    renameCategory: (from: string, to: string, expectedDocumentRevisions: Record<string, number>) =>
      execute(
        {
          command: 'knowledge.category.rename',
          payload: { from, to, expectedDocumentRevisions },
          expectedRevision: null,
        },
        `category:${from}`,
      ),
    trash: (payload: { documentId: string; expectedRevision: number }) =>
      execute(
        { command: 'knowledge.document.trash', payload, expectedRevision: null },
        `trash:${payload.documentId}`,
      ),
    restore: (payload: { documentId: string; expectedRevision: number }) =>
      execute(
        { command: 'knowledge.document.restore', payload, expectedRevision: null },
        `restore:${payload.documentId}`,
      ),
    deletePermanently,
  };
}
