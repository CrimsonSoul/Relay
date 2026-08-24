import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeDocumentRecord, KnowledgeOutlineNode } from '@shared/knowledge';
import { useToast } from '../../components/Toast';
import type { KnowledgePdfSession } from './KnowledgePdfViewer';
import type { KnowledgeViewerTarget } from './knowledgePdfDestination';
import { resolveKnowledgeLink, type KnowledgeResolvedLink } from './knowledgeLinkResolver';
import {
  acknowledgeKnowledgeDocumentOpen,
  getPendingKnowledgeDocumentOpen,
  type KnowledgeOpenRequest,
  OPEN_KNOWLEDGE_DOCUMENT_EVENT,
} from './knowledgeNavigation';
import { useKnowledgeDocumentSearch } from './useKnowledgeDocumentSearch';
import { useKnowledgeSelectionReconciliation } from './useKnowledgeSelectionReconciliation';

type PendingPassageOpen = {
  key: number;
  documentId: string;
  expectedChecksum: string;
  expectedSessionGeneration: number | null;
  expectedSessionPdf: KnowledgePdfSession['pdf'] | null;
  pageIndex: number;
  highlightText: string;
  normalizedStart: number;
  normalizedEnd: number;
};

type KnowledgeReaderNavigationInput = {
  documents: readonly KnowledgeDocumentRecord[];
  loading: boolean;
  error: string | null;
  hasLoadedSnapshot: boolean;
  refetch: () => Promise<void>;
  onClearLibraryQuery: () => void;
  onCloseLibraryDrawer: () => void;
};

function headingForTarget(
  document: KnowledgeDocumentRecord,
  target: KnowledgeViewerTarget,
): KnowledgeOutlineNode | undefined {
  return document.outline.find(
    (node) =>
      node.pageIndex === target.pageIndex &&
      (target.top === null || node.top === null || Math.abs(node.top - target.top) <= 2),
  );
}

function unavailableLinkMessage(reason: 'not-found' | 'ambiguous' | 'unsupported'): string {
  switch (reason) {
    case 'not-found':
      return 'Linked guide not found.';
    case 'ambiguous':
      return 'Multiple guides use this filename. Ask the document owner to qualify the category.';
    default:
      return 'Relay blocked an unsupported document link.';
  }
}

function clampKnowledgePageIndex(pageIndex: number | undefined, pageCount: number): number | null {
  if (pageIndex === undefined || !Number.isSafeInteger(pageIndex)) return null;
  return Math.min(Math.max(pageIndex, 0), Math.max(pageCount - 1, 0));
}

export function useKnowledgeReaderNavigation({
  documents,
  loading,
  error,
  hasLoadedSnapshot,
  refetch,
  onClearLibraryQuery,
  onCloseLibraryDrawer,
}: KnowledgeReaderNavigationInput) {
  const { showToast } = useToast();
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [target, setTarget] = useState<KnowledgeViewerTarget | null>(null);
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const [sidebarMode, setSidebarMode] = useState<'contents' | 'library'>('contents');
  const [pdfSession, setPdfSession] = useState<KnowledgePdfSession | null>(null);
  const [readerPageIndex, setReaderPageIndex] = useState(0);
  const [pendingPassageOpen, setPendingPassageOpen] = useState<PendingPassageOpen | null>(null);
  const [view, setView] = useState<'catalog' | 'reader'>('catalog');
  const passageOpenKeyRef = useRef(0);
  const documentsRef = useRef(documents);
  const selectedDocumentIdRef = useRef(selectedDocumentId);
  documentsRef.current = documents;
  selectedDocumentIdRef.current = selectedDocumentId;

  const handleConfirmedAbsent = useCallback(() => {
    setSelectedDocumentId(null);
    setActiveHeadingId(null);
    setTarget(null);
    setView('catalog');
  }, []);
  const { selectedDocument } = useKnowledgeSelectionReconciliation({
    selectedDocumentId,
    documents,
    loading,
    error,
    hasLoadedSnapshot,
    refetch,
    onConfirmedAbsent: handleConfirmedAbsent,
  });
  const documentSearch = useKnowledgeDocumentSearch(
    pdfSession,
    selectedDocument?.outline ?? [],
    readerPageIndex,
  );
  const activateExternalSearchTarget = documentSearch.activateExternalTarget;
  const cancelExternalSearchActivation = documentSearch.cancelExternalActivation;
  const activeHeading = selectedDocument?.outline.find((node) => node.id === activeHeadingId);

  const cancelPendingPassageOpen = useCallback(() => {
    cancelExternalSearchActivation();
    passageOpenKeyRef.current += 1;
    setPendingPassageOpen(null);
  }, [cancelExternalSearchActivation]);

  const queuePassageOpen = useCallback(
    (
      request: KnowledgeOpenRequest,
      document: KnowledgeDocumentRecord,
      pageIndex: number | null,
    ) => {
      if (
        pageIndex === null ||
        !request.highlightText ||
        request.normalizedStart === undefined ||
        request.normalizedEnd === undefined ||
        !Number.isSafeInteger(request.normalizedStart) ||
        !Number.isSafeInteger(request.normalizedEnd) ||
        request.normalizedStart < 0 ||
        request.normalizedEnd <= request.normalizedStart
      ) {
        cancelPendingPassageOpen();
        return;
      }
      const readySession =
        pdfSession?.documentId === document.id && pdfSession.checksum === document.checksum
          ? pdfSession
          : null;
      passageOpenKeyRef.current += 1;
      setPendingPassageOpen({
        key: passageOpenKeyRef.current,
        documentId: document.id,
        expectedChecksum: document.checksum,
        expectedSessionGeneration: readySession?.generation ?? null,
        expectedSessionPdf: readySession?.pdf ?? null,
        pageIndex,
        highlightText: request.highlightText,
        normalizedStart: request.normalizedStart,
        normalizedEnd: request.normalizedEnd,
      });
    },
    [cancelPendingPassageOpen, pdfSession],
  );

  useEffect(() => {
    setPendingPassageOpen((current) => {
      if (!current) return null;
      const currentDocument = documents.find((document) => document.id === current.documentId);
      return currentDocument?.checksum === current.expectedChecksum &&
        selectedDocumentId === current.documentId
        ? current
        : null;
    });
  }, [documents, selectedDocumentId]);

  useEffect(
    () => () => {
      passageOpenKeyRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (documentSearch.query) cancelPendingPassageOpen();
  }, [cancelPendingPassageOpen, documentSearch.query]);

  useEffect(() => {
    const pending = pendingPassageOpen;
    if (
      !pending ||
      pdfSession?.documentId !== pending.documentId ||
      pdfSession.checksum !== pending.expectedChecksum ||
      selectedDocument?.id !== pending.documentId ||
      selectedDocument.checksum !== pending.expectedChecksum
    ) {
      return;
    }
    if (pending.expectedSessionGeneration === null || pending.expectedSessionPdf === null) {
      setPendingPassageOpen((current) =>
        current?.key === pending.key
          ? {
              ...current,
              expectedSessionGeneration: pdfSession.generation,
              expectedSessionPdf: pdfSession.pdf,
            }
          : current,
      );
      return;
    }
    if (
      pdfSession.generation !== pending.expectedSessionGeneration ||
      pdfSession.pdf !== pending.expectedSessionPdf
    ) {
      cancelPendingPassageOpen();
      return;
    }
    let activeRequest = true;
    void activateExternalSearchTarget({
      pageIndex: pending.pageIndex,
      highlightText: pending.highlightText,
      normalizedStart: pending.normalizedStart,
      normalizedEnd: pending.normalizedEnd,
    }).then((resolved) => {
      if (!activeRequest || passageOpenKeyRef.current !== pending.key) return;
      setPendingPassageOpen((current) => (current?.key === pending.key ? null : current));
      if (resolved) return;
      setTarget({ pageIndex: pending.pageIndex, top: null });
      setReaderPageIndex(pending.pageIndex);
      showToast('Match text was not selectable on this page.', 'info');
    });
    return () => {
      activeRequest = false;
    };
  }, [
    activateExternalSearchTarget,
    cancelPendingPassageOpen,
    pdfSession,
    pendingPassageOpen,
    selectedDocument?.checksum,
    selectedDocument?.id,
    showToast,
  ]);

  const applyDocumentOpen = useCallback(
    (request: KnowledgeOpenRequest, externalRequest: boolean): boolean => {
      const { documentId, headingId, pageIndex } = request;
      const document = documents.find((candidate) => candidate.id === documentId);
      if (!document) return false;
      const heading = headingId
        ? document.outline.find((candidate) => candidate.id === headingId)
        : undefined;
      const safePageIndex = clampKnowledgePageIndex(pageIndex, document.pageCount);
      const pageTarget = safePageIndex === null ? null : { pageIndex: safePageIndex, top: null };
      if (externalRequest) onClearLibraryQuery();
      setSelectedDocumentId(documentId);
      setActiveHeadingId(heading?.id ?? null);
      setTarget(pageTarget ?? (heading ? { ...heading } : null));
      setReaderPageIndex(pageTarget?.pageIndex ?? heading?.pageIndex ?? 0);
      queuePassageOpen(request, document, safePageIndex);
      setView('reader');
      setSidebarMode('contents');
      if (externalRequest) {
        onCloseLibraryDrawer();
        acknowledgeKnowledgeDocumentOpen(documentId);
      }
      return true;
    },
    [documents, onClearLibraryQuery, onCloseLibraryDrawer, queuePassageOpen],
  );

  const openDocument = useCallback(
    (request: KnowledgeOpenRequest) => applyDocumentOpen(request, true),
    [applyDocumentOpen],
  );
  const openCatalogDocument = useCallback(
    (request: KnowledgeOpenRequest) => applyDocumentOpen(request, false),
    [applyDocumentOpen],
  );

  useEffect(() => {
    const handleOpenRequest = (event: Event) => {
      const detail = (event as CustomEvent<Partial<KnowledgeOpenRequest>>).detail;
      if (typeof detail?.documentId === 'string') {
        openDocument({
          documentId: detail.documentId,
          headingId: typeof detail.headingId === 'string' ? detail.headingId : undefined,
          pageIndex: typeof detail.pageIndex === 'number' ? detail.pageIndex : undefined,
          highlightText:
            typeof detail.highlightText === 'string' ? detail.highlightText : undefined,
          normalizedStart:
            typeof detail.normalizedStart === 'number' ? detail.normalizedStart : undefined,
          normalizedEnd:
            typeof detail.normalizedEnd === 'number' ? detail.normalizedEnd : undefined,
        });
      }
    };
    globalThis.addEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, handleOpenRequest);
    const pendingRequest = getPendingKnowledgeDocumentOpen();
    if (pendingRequest) openDocument(pendingRequest);
    return () => globalThis.removeEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, handleOpenRequest);
  }, [openDocument]);

  const handleSelectHeading = useCallback(
    (heading: KnowledgeOutlineNode) => {
      cancelPendingPassageOpen();
      setActiveHeadingId(heading.id);
      setTarget({ ...heading, top: null });
      onCloseLibraryDrawer();
    },
    [cancelPendingPassageOpen, onCloseLibraryDrawer],
  );

  const handlePageChange = useCallback(
    (pageIndex: number) => {
      if (pageIndex !== readerPageIndex) cancelPendingPassageOpen();
      setReaderPageIndex(pageIndex);
      if (!selectedDocument) return;
      const heading = selectedDocument.outline
        .filter((node) => node.pageIndex <= pageIndex)
        .sort((left, right) => left.pageIndex - right.pageIndex)
        .at(-1);
      setActiveHeadingId(heading?.id ?? null);
    },
    [cancelPendingPassageOpen, readerPageIndex, selectedDocument],
  );

  const resolveUrl = useCallback(
    (url: string): KnowledgeResolvedLink =>
      selectedDocument
        ? resolveKnowledgeLink({ rawUrl: url, currentDocument: selectedDocument, documents })
        : { kind: 'unavailable', reason: 'unsupported' },
    [documents, selectedDocument],
  );

  const handleActivateResolvedLink = useCallback(
    (link: KnowledgeResolvedLink) => {
      if (link.kind === 'unavailable') {
        showToast(unavailableLinkMessage(link.reason), 'error');
        return;
      }

      if (link.kind === 'web') {
        void (async () => {
          try {
            const result = await globalThis.api?.openKnowledgeWebLink(link.url);
            if (result?.ok) return;
          } catch {
            // The same approved message covers bridge and system-browser failures.
          }
          showToast('Relay could not open this website in the system browser.', 'error');
        })();
        return;
      }

      if (selectedDocument === null) {
        showToast('Linked guide not found.', 'error');
        return;
      }

      if (
        selectedDocumentIdRef.current !== selectedDocument.id ||
        !documentsRef.current.some((document) => document.id === selectedDocument.id)
      ) {
        showToast('Linked guide not found.', 'error');
        return;
      }

      if (link.kind === 'same-document') {
        cancelPendingPassageOpen();
        const nextTarget = { pageIndex: link.pageIndex, top: null };
        const heading = headingForTarget(selectedDocument, nextTarget);
        setActiveHeadingId(heading?.id ?? null);
        setTarget(nextTarget);
        return;
      }

      const linkedDocument = documentsRef.current.find(
        (document) => document.id === link.documentId,
      );
      if (!linkedDocument) {
        showToast('Linked guide not found.', 'error');
        return;
      }
      const nextTarget = { pageIndex: link.pageIndex, top: null };
      const heading = headingForTarget(linkedDocument, nextTarget);
      onClearLibraryQuery();
      cancelPendingPassageOpen();
      setSelectedDocumentId(linkedDocument.id);
      setActiveHeadingId(heading?.id ?? null);
      setTarget(nextTarget);
      setReaderPageIndex(nextTarget.pageIndex);
      setFocusRequestKey((current) => current + 1);
      setView('reader');
      setSidebarMode('contents');
    },
    [cancelPendingPassageOpen, onClearLibraryQuery, selectedDocument, showToast],
  );

  const handleDestinationChange = useCallback(
    (nextTarget: KnowledgeViewerTarget) => {
      cancelPendingPassageOpen();
      const heading = selectedDocument ? headingForTarget(selectedDocument, nextTarget) : undefined;
      setActiveHeadingId(heading?.id ?? null);
      setTarget(nextTarget);
      setReaderPageIndex(nextTarget.pageIndex);
    },
    [cancelPendingPassageOpen, selectedDocument],
  );

  const selectDocument = useCallback(
    (document: KnowledgeDocumentRecord) => {
      cancelPendingPassageOpen();
      setSelectedDocumentId(document.id);
      setReaderPageIndex(0);
      setView('reader');
      setActiveHeadingId(null);
      setTarget(null);
      setSidebarMode('contents');
      onCloseLibraryDrawer();
    },
    [cancelPendingPassageOpen, onCloseLibraryDrawer],
  );

  const selectSidebarMode = useCallback(
    (mode: 'contents' | 'library') => {
      cancelPendingPassageOpen();
      setSidebarMode(mode);
    },
    [cancelPendingPassageOpen],
  );

  const returnToCatalog = useCallback(() => {
    cancelPendingPassageOpen();
    setView('catalog');
    setSidebarMode('contents');
    onCloseLibraryDrawer();
  }, [cancelPendingPassageOpen, onCloseLibraryDrawer]);

  return {
    view,
    selectedDocument,
    activeHeading,
    activeHeadingId,
    target,
    focusRequestKey,
    sidebarMode,
    setSidebarMode,
    documentSearch,
    cancelPendingPassageOpen,
    openDocument,
    openCatalogDocument,
    selectDocument,
    selectSidebarMode,
    returnToCatalog,
    handleSelectHeading,
    handlePageChange,
    resolveUrl,
    handleActivateResolvedLink,
    handleDestinationChange,
    setPdfSession,
  };
}
