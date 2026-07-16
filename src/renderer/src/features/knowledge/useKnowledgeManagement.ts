import { useCallback, useEffect, useState } from 'react';
import type { PublicPrivilegedCommandRequest } from '@shared/ipc';
import {
  normalizeKnowledgeAuditEventView,
  normalizeKnowledgeManagementSnapshot,
  type KnowledgeAuditEventView,
  type KnowledgeManagementSnapshot,
  type KnowledgePage,
  type KnowledgeUploadProgress,
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
  const [uploadProgress, setUploadProgress] = useState<KnowledgeUploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = session.state === 'active' && session.capabilities.includes('knowledge.manage');

  const requestSnapshot = useCallback(
    async (cursor: string | null): Promise<KnowledgeManagementSnapshot | null> => {
      const result = await submitCommand({
        command: 'knowledge.snapshot.read',
        payload: { query: '', cursor, pageSize: 25 },
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
    return globalThis.api?.onKnowledgeUploadProgress?.((progress) => setUploadProgress(progress));
  }, [canManage]);

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
        await Promise.all([refresh(), Promise.resolve(onLibraryChanged?.())]);
        return true;
      } finally {
        setBusy(null);
      }
    },
    [canManage, onLibraryChanged, refresh, submitCommand],
  );

  const stagePdfs = useCallback(async (): Promise<KnowledgeUploadSelectionResult> => {
    if (!canManage || !globalThis.api?.selectAndStageKnowledgePdfs) {
      return { ok: false, error: canManage ? 'upload-failed' : 'unauthorized' };
    }
    setBusy('upload');
    setError(null);
    try {
      const result = await globalThis.api.selectAndStageKnowledgePdfs();
      if (!result.ok && result.error !== 'cancelled') {
        setError('Relay could not stage the selected PDF files.');
      }
      if (result.ok) await refresh();
      return result;
    } finally {
      setBusy(null);
    }
  }, [canManage, refresh]);

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
    uploadProgress,
    error,
    refresh,
    readAudit,
    loadMoreAudit,
    loadMore,
    stagePdfs,
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
