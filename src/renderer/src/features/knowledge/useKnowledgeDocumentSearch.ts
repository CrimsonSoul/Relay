import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeOutlineNode } from '@shared/knowledge';
import { normalizeKnowledgeSearchText, type KnowledgeSearchResult } from '@shared/knowledgeSearch';
import {
  KnowledgeDocumentSearchController,
  type KnowledgeExternalSearchTarget,
  type KnowledgeDocumentSearchMatch,
  type KnowledgeDocumentSearchSnapshot,
} from './knowledgeDocumentSearch';
import type { KnowledgePdfSession } from './KnowledgePdfViewer';
import { useKnowledgePassageSearch } from './useKnowledgePassageSearch';

export type KnowledgeSearchNavigationRequest = {
  key: number;
  result: KnowledgeDocumentSearchMatch;
};

export type KnowledgeDocumentSearchDisplayResult =
  | { source: 'local-exact'; id: string; match: KnowledgeDocumentSearchMatch }
  | { source: 'fuzzy'; id: string; match: KnowledgeSearchResult };

export type KnowledgeDocumentSearchModel = {
  query: string;
  snapshot: KnowledgeDocumentSearchSnapshot;
  results: readonly KnowledgeDocumentSearchDisplayResult[];
  highlightMatches: readonly KnowledgeDocumentSearchMatch[];
  enhancedUnavailable: boolean;
  enhancedGenerationKey: string;
  activeResultIndex: number;
  activeResult: KnowledgeDocumentSearchDisplayResult | null;
  navigationRequest: KnowledgeSearchNavigationRequest | null;
  setQuery: (query: string) => void;
  activateResult: (index: number) => Promise<void>;
  activateNext: () => void;
  activatePrevious: () => void;
  clear: () => void;
  activateExternalTarget: (target: KnowledgeExternalSearchTarget) => Promise<boolean>;
  cancelExternalActivation: () => void;
  hideEnhancedResults: (generationKey: string) => void;
};

export type KnowledgeDocumentSearchControllerFactory = (
  options: ConstructorParameters<typeof KnowledgeDocumentSearchController>[0],
) => Pick<
  KnowledgeDocumentSearchController,
  'subscribe' | 'getSnapshot' | 'setQuery' | 'setCurrentPage' | 'resolveExternalMatch' | 'dispose'
>;

const createDefaultController: KnowledgeDocumentSearchControllerFactory = (options) =>
  new KnowledgeDocumentSearchController(options);

function emptySnapshot(totalPages: number): KnowledgeDocumentSearchSnapshot {
  return {
    query: '',
    normalizedQuery: '',
    state: 'idle',
    results: [],
    completedPages: 0,
    totalPages,
    failedPageIndices: [],
    searchablePageCount: 0,
  };
}

export function useKnowledgeDocumentSearch(
  session: KnowledgePdfSession | null,
  outline: readonly KnowledgeOutlineNode[],
  currentPageIndex: number,
  createController: KnowledgeDocumentSearchControllerFactory = createDefaultController,
): KnowledgeDocumentSearchModel {
  const controllerRef = useRef<ReturnType<KnowledgeDocumentSearchControllerFactory> | null>(null);
  const outlineRef = useRef(outline);
  const sessionRef = useRef(session);
  const currentPageIndexRef = useRef(currentPageIndex);
  outlineRef.current = outline;
  sessionRef.current = session;
  currentPageIndexRef.current = currentPageIndex;
  const requestKeyRef = useRef(0);
  const activationGenerationRef = useRef(0);
  const [query, setQuery] = useState('');
  const [snapshot, setSnapshot] = useState<KnowledgeDocumentSearchSnapshot>(() =>
    emptySnapshot(session?.pdf.numPages ?? 0),
  );
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const activeResultRef = useRef<{
    id: string;
    index: number;
    result: KnowledgeDocumentSearchDisplayResult;
  } | null>(null);
  const [externalHighlightMatches, setExternalHighlightMatches] = useState<
    KnowledgeDocumentSearchMatch[]
  >([]);
  const [hiddenEnhancedGenerationKey, setHiddenEnhancedGenerationKey] = useState<string | null>(
    null,
  );
  const [navigationRequest, setNavigationRequest] =
    useState<KnowledgeSearchNavigationRequest | null>(null);
  const sessionDocumentId = session?.documentId;
  const sessionChecksum = session?.checksum;
  const sessionGeneration = session?.generation;
  const passageSearch = useKnowledgePassageSearch({
    query,
    scope: { kind: 'document', documentId: sessionDocumentId ?? '' },
    enabled: Boolean(sessionDocumentId),
  });

  useEffect(() => {
    const activeSession = sessionRef.current;
    activationGenerationRef.current += 1;
    setQuery('');
    setActiveResultId(null);
    activeResultRef.current = null;
    setNavigationRequest(null);
    setExternalHighlightMatches([]);
    setHiddenEnhancedGenerationKey(null);
    setSnapshot(emptySnapshot(activeSession?.pdf.numPages ?? 0));

    if (!activeSession) {
      controllerRef.current = null;
      return;
    }

    const controller = createController({
      pdf: activeSession.pdf,
      documentId: activeSession.documentId,
      checksum: activeSession.checksum,
      outline: outlineRef.current,
      initialPageIndex: currentPageIndexRef.current,
    });
    controllerRef.current = controller;
    setSnapshot(controller.getSnapshot());
    const unsubscribe = controller.subscribe((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });

    return () => {
      unsubscribe();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [createController, sessionChecksum, sessionDocumentId, sessionGeneration]);

  useEffect(() => {
    controllerRef.current?.setCurrentPage(currentPageIndex);
  }, [currentPageIndex]);

  const updateQuery = useCallback((nextQuery: string) => {
    activationGenerationRef.current += 1;
    setQuery(nextQuery);
    setActiveResultId(null);
    activeResultRef.current = null;
    setNavigationRequest(null);
    setExternalHighlightMatches([]);
    setHiddenEnhancedGenerationKey(null);
    controllerRef.current?.setQuery(nextQuery);
  }, []);

  const results = useMemo<KnowledgeDocumentSearchDisplayResult[]>(() => {
    const localResults: KnowledgeDocumentSearchDisplayResult[] = snapshot.results.map((match) => ({
      source: 'local-exact',
      id: `local:${match.id}`,
      match,
    }));
    const normalizedQuery = normalizeKnowledgeSearchText(query);
    const enhancedResults =
      hiddenEnhancedGenerationKey !== passageSearch.generationKey &&
      passageSearch.response?.normalizedQuery === normalizedQuery
        ? passageSearch.response.results
        : [];
    const seen = new Set<string>();
    const fuzzyResults: KnowledgeDocumentSearchDisplayResult[] = [];
    for (const match of enhancedResults) {
      if (
        match.matchKind !== 'fuzzy' ||
        match.documentId !== sessionDocumentId ||
        match.checksum !== sessionChecksum ||
        snapshot.results.some(
          (local) =>
            local.pageIndex === match.pageIndex &&
            Math.max(local.normalizedStart, match.normalizedStart) <
              Math.min(local.normalizedEnd, match.normalizedEnd),
        )
      ) {
        continue;
      }
      const identity = `${match.pageIndex}:${match.normalizedStart}:${match.normalizedEnd}:${normalizeKnowledgeSearchText(match.highlightText)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      fuzzyResults.push({ source: 'fuzzy', id: `fuzzy:${match.id}`, match });
    }
    return [...localResults, ...fuzzyResults];
  }, [
    hiddenEnhancedGenerationKey,
    passageSearch.generationKey,
    passageSearch.response,
    query,
    sessionChecksum,
    sessionDocumentId,
    snapshot.results,
  ]);

  const publishResolvedMatch = useCallback((result: KnowledgeDocumentSearchMatch) => {
    setExternalHighlightMatches((current) =>
      current.some(
        (match) =>
          match.pageIndex === result.pageIndex &&
          match.normalizedStart === result.normalizedStart &&
          match.normalizedEnd === result.normalizedEnd,
      )
        ? current
        : [...current, result],
    );
    requestKeyRef.current += 1;
    setNavigationRequest({ key: requestKeyRef.current, result });
  }, []);

  const activeResultIndex = activeResultId
    ? results.findIndex((result) => result.id === activeResultId)
    : -1;
  const activeResult = activeResultIndex >= 0 ? (results[activeResultIndex] ?? null) : null;
  if (activeResult && activeResultId) {
    activeResultRef.current = {
      id: activeResultId,
      index: activeResultIndex,
      result: activeResult,
    };
  }

  useEffect(() => {
    if (!activeResultId || activeResultIndex >= 0) return;
    const previous = activeResultRef.current;
    if (previous?.id !== activeResultId) {
      setActiveResultId(null);
      setNavigationRequest(null);
      return;
    }
    const previousMatch = previous.result.match;
    const replacement = results.find(
      (candidate) =>
        candidate.source === 'local-exact' &&
        candidate.match.pageIndex === previousMatch.pageIndex &&
        Math.max(candidate.match.normalizedStart, previousMatch.normalizedStart) <
          Math.min(candidate.match.normalizedEnd, previousMatch.normalizedEnd),
    );
    if (replacement) {
      setActiveResultId(replacement.id);
      activeResultRef.current = {
        id: replacement.id,
        index: results.indexOf(replacement),
        result: replacement,
      };
      publishResolvedMatch(replacement.match);
      return;
    }
    setActiveResultId(null);
    activeResultRef.current = null;
    setNavigationRequest(null);
    setExternalHighlightMatches((current) =>
      current.filter(
        (match) =>
          match.pageIndex !== previousMatch.pageIndex ||
          Math.max(match.normalizedStart, previousMatch.normalizedStart) >=
            Math.min(match.normalizedEnd, previousMatch.normalizedEnd),
      ),
    );
  }, [activeResultId, activeResultIndex, publishResolvedMatch, results]);

  const activateResult = useCallback(
    async (index: number) => {
      const displayResult = results[index];
      if (!displayResult) return;
      setActiveResultId(displayResult.id);
      activeResultRef.current = { id: displayResult.id, index, result: displayResult };
      if (displayResult.source === 'local-exact') {
        publishResolvedMatch(displayResult.match);
        return;
      }

      const controller = controllerRef.current;
      if (!controller) return;
      const activationGeneration = activationGenerationRef.current;
      const resolved = await controller.resolveExternalMatch(displayResult.match);
      if (
        !resolved ||
        activationGenerationRef.current !== activationGeneration ||
        controllerRef.current !== controller
      ) {
        return;
      }
      publishResolvedMatch(resolved);
    },
    [publishResolvedMatch, results],
  );

  const activateNext = useCallback(() => {
    if (results.length === 0) return;
    const nextIndex = activeResultIndex < 0 ? 0 : (activeResultIndex + 1) % results.length;
    void activateResult(nextIndex);
  }, [activateResult, activeResultIndex, results.length]);

  const activatePrevious = useCallback(() => {
    if (results.length === 0) return;
    const previousIndex =
      activeResultIndex < 0
        ? results.length - 1
        : (activeResultIndex - 1 + results.length) % results.length;
    void activateResult(previousIndex);
  }, [activateResult, activeResultIndex, results.length]);

  const clear = useCallback(() => {
    activationGenerationRef.current += 1;
    setQuery('');
    setActiveResultId(null);
    activeResultRef.current = null;
    setNavigationRequest(null);
    setExternalHighlightMatches([]);
    setHiddenEnhancedGenerationKey(null);
    controllerRef.current?.setQuery('');
  }, []);

  const highlightMatches = useMemo(() => {
    const merged = [...snapshot.results];
    for (const match of externalHighlightMatches) {
      if (
        !merged.some(
          (candidate) =>
            candidate.pageIndex === match.pageIndex &&
            candidate.normalizedStart === match.normalizedStart &&
            candidate.normalizedEnd === match.normalizedEnd,
        )
      ) {
        merged.push(match);
      }
    }
    return merged;
  }, [externalHighlightMatches, snapshot.results]);

  const activateExternalTarget = useCallback(
    async (target: KnowledgeExternalSearchTarget): Promise<boolean> => {
      const controller = controllerRef.current;
      if (!controller) return false;
      const activationGeneration = activationGenerationRef.current;
      const resolved = await controller.resolveExternalMatch(target);
      if (
        !resolved ||
        activationGenerationRef.current !== activationGeneration ||
        controllerRef.current !== controller
      ) {
        return false;
      }
      setActiveResultId(null);
      activeResultRef.current = null;
      publishResolvedMatch(resolved);
      return true;
    },
    [publishResolvedMatch],
  );

  const cancelExternalActivation = useCallback(() => {
    activationGenerationRef.current += 1;
  }, []);

  const hideEnhancedResults = useCallback(
    (generationKey: string) => {
      if (!generationKey || generationKey !== passageSearch.generationKey) return;
      setHiddenEnhancedGenerationKey(generationKey);
    },
    [passageSearch.generationKey],
  );

  return {
    query,
    snapshot,
    results,
    highlightMatches,
    enhancedUnavailable: passageSearch.state === 'unavailable',
    enhancedGenerationKey: passageSearch.generationKey,
    activeResultIndex,
    activeResult,
    navigationRequest,
    setQuery: updateQuery,
    activateResult,
    activateNext,
    activatePrevious,
    clear,
    activateExternalTarget,
    cancelExternalActivation,
    hideEnhancedResults,
  };
}
