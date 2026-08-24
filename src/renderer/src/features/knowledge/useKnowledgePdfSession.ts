import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type KnowledgePdfSession = {
  pdf: PDFDocumentProxy;
  documentId: string;
  checksum: string;
  generation: number;
};

export type KnowledgeViewerError = {
  message: string;
  documentId: string;
  checksum: string;
};

type KnowledgePdfLoadStart = {
  preserveViewState: boolean;
};

type UseKnowledgePdfSessionOptions = {
  active: boolean;
  documentId: string | undefined;
  checksum: string | undefined;
  onSessionChange?: (session: KnowledgePdfSession | null) => void;
  onLoadStart?: (event: KnowledgePdfLoadStart) => void;
};

type KnowledgePdfSessionController = {
  session: KnowledgePdfSession | null;
  sessionRef: RefObject<KnowledgePdfSession | null>;
  loading: boolean;
  error: KnowledgeViewerError | null;
  retryKey: number;
  retry: () => void;
};

function viewerError(error: string): string {
  switch (error) {
    case 'not-available-offline':
      return 'This document is not cached on this laptop. Reconnect to the Relay server to open it.';
    case 'not-found':
      return 'This document is no longer available in the Wiki.';
    case 'checksum-mismatch':
      return 'Relay could not verify this document. Refresh the library and try again.';
    default:
      return 'Relay could not open this document. Try again after the library refreshes.';
  }
}

export function useKnowledgePdfSession({
  active,
  documentId,
  checksum,
  onSessionChange,
  onLoadStart,
}: UseKnowledgePdfSessionOptions): KnowledgePdfSessionController {
  const [session, setSession] = useState<KnowledgePdfSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<KnowledgeViewerError | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const sessionRef = useRef<KnowledgePdfSession | null>(null);
  const generationRef = useRef(0);
  const loadedDocumentIdentityRef = useRef<string | null>(null);
  const onSessionChangeRef = useRef(onSessionChange);
  const onLoadStartRef = useRef(onLoadStart);
  onSessionChangeRef.current = onSessionChange;
  onLoadStartRef.current = onLoadStart;
  const retry = useCallback(() => setRetryKey((current) => current + 1), []);

  useEffect(() => {
    if (!active || !documentId || !checksum || !globalThis.api?.getKnowledgePdf) {
      sessionRef.current = null;
      setSession(null);
      if (!documentId || !checksum) loadedDocumentIdentityRef.current = null;
      return;
    }

    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let loadingTaskDestroyed = false;
    const destroyLoadingTask = async () => {
      if (!loadingTask || loadingTaskDestroyed) return;
      loadingTaskDestroyed = true;
      await loadingTask.destroy();
    };
    const generation = generationRef.current + 1;
    const documentIdentity = `${documentId}:${checksum}`;
    const preserveViewState = loadedDocumentIdentityRef.current === documentIdentity;
    loadedDocumentIdentityRef.current = documentIdentity;
    generationRef.current = generation;
    sessionRef.current = null;
    setSession(null);
    setLoading(true);
    setError(null);
    onLoadStartRef.current?.({ preserveViewState });

    globalThis.api
      .getKnowledgePdf({ documentId, checksum })
      .then(async (result) => {
        if (disposed) return;
        if (!result.ok) {
          setError({ message: viewerError(result.error), documentId, checksum });
          return;
        }
        loadingTask = getDocument({
          data: new Uint8Array(result.data),
          // pdf.js 6 removed the eval option and the dynamic-function path it once gated.
          disableAutoFetch: true,
          disableStream: true,
          enableXfa: false,
          useWorkerFetch: false,
        });
        const pdf = await loadingTask.promise;
        if (disposed) {
          await destroyLoadingTask();
          return;
        }
        const nextSession: KnowledgePdfSession = {
          pdf,
          documentId,
          checksum,
          generation,
        };
        sessionRef.current = nextSession;
        onSessionChangeRef.current?.(nextSession);
        setSession(nextSession);
      })
      .catch(() => {
        if (!disposed) {
          setError({ message: viewerError('download-failed'), documentId, checksum });
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      if (sessionRef.current?.generation === generation) {
        sessionRef.current = null;
        onSessionChangeRef.current?.(null);
      }
      void destroyLoadingTask().catch(() => undefined);
    };
  }, [active, checksum, documentId, retryKey]);

  return { session, sessionRef, loading, error, retryKey, retry };
}
