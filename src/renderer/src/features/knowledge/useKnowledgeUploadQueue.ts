import { useCallback, useEffect, useRef, useState } from 'react';
import {
  normalizeKnowledgeUploadQueueView,
  type KnowledgeManagementUploadView,
  type KnowledgeUploadQueueView,
} from '@shared/knowledge';

export const EMPTY_KNOWLEDGE_UPLOAD_QUEUE: KnowledgeUploadQueueView = {
  restartRecovery: false,
  activeBatchId: null,
  totalBytes: 0,
  acknowledgedBytes: 0,
  items: [],
};

type UseKnowledgeUploadQueueOptions = {
  canManage: boolean;
  managementIdentity: string | null;
  serverUploads: readonly KnowledgeManagementUploadView[] | undefined;
  pollSnapshot: () => void | Promise<unknown>;
};

export function useKnowledgeUploadQueue({
  canManage,
  managementIdentity,
  serverUploads,
  pollSnapshot,
}: UseKnowledgeUploadQueueOptions) {
  const [uploadQueue, setUploadQueue] = useState<KnowledgeUploadQueueView>(
    EMPTY_KNOWLEDGE_UPLOAD_QUEUE,
  );
  const managementIdentityRef = useRef(managementIdentity);
  const uploadQueueRef = useRef<KnowledgeUploadQueueView>(EMPTY_KNOWLEDGE_UPLOAD_QUEUE);
  const generationRef = useRef(0);
  const hydratedIdentityRef = useRef<string | null>(null);
  const requestRef = useRef<{
    identity: string;
    promise: Promise<KnowledgeUploadQueueView | null>;
  } | null>(null);
  const mountedRef = useRef(true);
  managementIdentityRef.current = managementIdentity;
  uploadQueueRef.current = uploadQueue;

  const refreshUploadQueue = useCallback((): Promise<KnowledgeUploadQueueView | null> => {
    const expectedIdentity = managementIdentityRef.current;
    const readQueue = globalThis.api?.getKnowledgeUploadQueue;
    if (!expectedIdentity || !readQueue) return Promise.resolve(null);
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let operation!: Promise<KnowledgeUploadQueueView | null>;
    operation = (async () => {
      try {
        const normalized = normalizeKnowledgeUploadQueueView(await readQueue());
        if (
          !normalized ||
          !mountedRef.current ||
          generation !== generationRef.current ||
          managementIdentityRef.current !== expectedIdentity
        ) {
          return null;
        }
        uploadQueueRef.current = normalized;
        hydratedIdentityRef.current = expectedIdentity;
        setUploadQueue(normalized);
        return normalized;
      } finally {
        if (requestRef.current?.promise === operation) requestRef.current = null;
      }
    })();
    requestRef.current = { identity: expectedIdentity, promise: operation };
    return operation;
  }, []);

  const ensureUploadQueueHydrated = useCallback(async () => {
    const expectedIdentity = managementIdentityRef.current;
    if (!expectedIdentity) return null;
    if (hydratedIdentityRef.current === expectedIdentity) return uploadQueueRef.current;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const pending = requestRef.current;
      const queue = await (pending?.identity === expectedIdentity
        ? pending.promise
        : refreshUploadQueue());
      if (managementIdentityRef.current !== expectedIdentity) return null;
      if (queue) return queue;
      if (hydratedIdentityRef.current === expectedIdentity) return uploadQueueRef.current;
    }
    return null;
  }, [refreshUploadQueue]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      requestRef.current = null;
    };
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    requestRef.current = null;
    hydratedIdentityRef.current = null;
    uploadQueueRef.current = EMPTY_KNOWLEDGE_UPLOAD_QUEUE;
    setUploadQueue(EMPTY_KNOWLEDGE_UPLOAD_QUEUE);
    if (!canManage || !managementIdentity) return;

    let active = true;
    const expectedIdentity = managementIdentity;
    const acceptQueue = (value: unknown) => {
      const normalized = normalizeKnowledgeUploadQueueView(value);
      if (active && normalized && managementIdentityRef.current === expectedIdentity) {
        generationRef.current += 1;
        hydratedIdentityRef.current = expectedIdentity;
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
    const serverStates = new Map((serverUploads ?? []).map((upload) => [upload.id, upload.state]));
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
  }, [canManage, pollSnapshot, refreshUploadQueue, serverUploads, uploadQueue.items]);

  return { uploadQueue, refreshUploadQueue, ensureUploadQueueHydrated };
}
