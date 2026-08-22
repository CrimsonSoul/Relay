import { act, renderHook } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeSearchResult } from '@shared/knowledgeSearch';
import type {
  KnowledgeDocumentSearchMatch,
  KnowledgeDocumentSearchSnapshot,
} from '../knowledgeDocumentSearch';
import type { KnowledgePdfSession } from '../KnowledgePdfViewer';
import {
  useKnowledgeDocumentSearch,
  type KnowledgeDocumentSearchControllerFactory,
} from '../useKnowledgeDocumentSearch';
import { useKnowledgePassageSearch } from '../useKnowledgePassageSearch';

vi.mock('../useKnowledgePassageSearch', () => ({ useKnowledgePassageSearch: vi.fn() }));

const useKnowledgePassageSearchMock = vi.mocked(useKnowledgePassageSearch);

function session(documentId: string, checksumCharacter: string): KnowledgePdfSession {
  return {
    pdf: { numPages: 3 } as PDFDocumentProxy,
    documentId,
    checksum: checksumCharacter.repeat(64),
    generation: checksumCharacter === 'a' ? 1 : 2,
  };
}

function searchMatch(index: number): KnowledgeDocumentSearchMatch {
  return {
    id: `0:${index}:0`,
    pageIndex: 0,
    matchIndex: index,
    snippet: `lane match ${index}`,
    sectionLabel: 'Recovery',
    normalizedStart: index,
    normalizedEnd: index + 4,
    textItemRange: { start: 0, end: 0 },
    domRange: {
      start: { itemIndex: 0, itemOffset: index },
      end: { itemIndex: 0, itemOffset: index + 4 },
    },
  };
}

function fuzzyResult(
  id: string,
  overrides: Partial<KnowledgeSearchResult> = {},
): KnowledgeSearchResult {
  return {
    id,
    documentId: 'guide',
    checksum: 'a'.repeat(64),
    title: 'Guide',
    fileName: 'Guide.pdf',
    category: 'Operations',
    categoryId: null,
    documentType: 'sop',
    headingId: null,
    heading: 'Recovery',
    pageIndex: 0,
    passageNumber: 1,
    excerpt: 'Start failover procedure now',
    matchKind: 'fuzzy',
    highlightText: 'failover',
    normalizedStart: 10,
    normalizedEnd: 18,
    score: 100,
    ...overrides,
  };
}

function fakeController(
  results: KnowledgeDocumentSearchMatch[],
  resolvedExternalMatch: KnowledgeDocumentSearchMatch | null = null,
) {
  let listener: ((snapshot: KnowledgeDocumentSearchSnapshot) => void) | null = null;
  let currentResults = results;
  const snapshot = (): KnowledgeDocumentSearchSnapshot => ({
    query: 'lane',
    normalizedQuery: 'lane',
    state: 'ready',
    results: currentResults,
    completedPages: 3,
    totalPages: 3,
    failedPageIndices: [],
    searchablePageCount: 3,
  });
  const controller = {
    subscribe: vi.fn((next: (snapshot: KnowledgeDocumentSearchSnapshot) => void) => {
      listener = next;
      return vi.fn();
    }),
    getSnapshot: vi.fn(snapshot),
    setQuery: vi.fn(),
    setCurrentPage: vi.fn(),
    resolveExternalMatch: vi.fn(async () => resolvedExternalMatch),
    dispose: vi.fn(),
  };
  return {
    controller,
    publish: (nextResults: KnowledgeDocumentSearchMatch[] = currentResults) => {
      currentResults = nextResults;
      listener?.(snapshot());
    },
  };
}

describe('useKnowledgeDocumentSearch', () => {
  beforeEach(() => {
    useKnowledgePassageSearchMock.mockReturnValue({
      state: 'idle',
      generationKey: '',
      response: null,
      error: null,
    });
  });

  it('creates one controller per session identity and disposes it on replacement', () => {
    const firstHarness = fakeController([]);
    const secondHarness = fakeController([]);
    const createController = vi
      .fn<KnowledgeDocumentSearchControllerFactory>()
      .mockReturnValueOnce(firstHarness.controller)
      .mockReturnValueOnce(secondHarness.controller);
    const first = session('guide', 'a');
    const second = session('guide', 'b');
    const { result, rerender } = renderHook(
      ({ activeSession }) => useKnowledgeDocumentSearch(activeSession, [], 0, createController),
      { initialProps: { activeSession: first } },
    );
    act(() => result.current.setQuery('lane'));

    rerender({ activeSession: second });

    expect(firstHarness.controller.dispose).toHaveBeenCalledOnce();
    expect(createController).toHaveBeenCalledTimes(2);
    expect(result.current.query).toBe('');
    expect(result.current.activeResultIndex).toBe(-1);
    expect(result.current.navigationRequest).toBeNull();
  });

  it('cycles active matches forward and backward without changing the query', () => {
    const harness = fakeController(Array.from({ length: 3 }, (_, index) => searchMatch(index)));
    const createController = vi.fn<KnowledgeDocumentSearchControllerFactory>(
      () => harness.controller,
    );
    const { result } = renderHook(() =>
      useKnowledgeDocumentSearch(session('guide', 'a'), [], 0, createController),
    );
    act(() => harness.publish());

    act(() => result.current.activateNext());
    expect(result.current.activeResultIndex).toBe(0);
    expect(result.current.query).toBe('');
    const firstRequestKey = result.current.navigationRequest?.key;

    act(() => result.current.activatePrevious());
    expect(result.current.activeResultIndex).toBe(2);
    expect(result.current.navigationRequest?.result.id).toBe(searchMatch(2).id);
    expect(result.current.navigationRequest?.key).toBeGreaterThan(firstRequestKey ?? -1);
  });

  it('issues a fresh navigation request when the same result is activated again', async () => {
    const harness = fakeController([searchMatch(0)]);
    const createController = vi.fn<KnowledgeDocumentSearchControllerFactory>(
      () => harness.controller,
    );
    const { result } = renderHook(() =>
      useKnowledgeDocumentSearch(session('guide', 'a'), [], 1, createController),
    );
    act(() => harness.publish());

    await act(async () => result.current.activateResult(0));
    const firstKey = result.current.navigationRequest?.key ?? -1;
    await act(async () => result.current.activateResult(0));

    expect(result.current.navigationRequest?.key).toBeGreaterThan(firstKey);
    expect(harness.controller.setCurrentPage).toHaveBeenCalledWith(1);
  });

  it('clears query and active navigation without disposing the session', async () => {
    const harness = fakeController([searchMatch(0)]);
    const createController = vi.fn<KnowledgeDocumentSearchControllerFactory>(
      () => harness.controller,
    );
    const { result } = renderHook(() =>
      useKnowledgeDocumentSearch(session('guide', 'a'), [], 0, createController),
    );
    act(() => harness.publish());
    act(() => result.current.setQuery('lane'));
    await act(async () => result.current.activateResult(0));

    act(() => result.current.clear());

    expect(result.current.query).toBe('');
    expect(result.current.activeResultIndex).toBe(-1);
    expect(result.current.navigationRequest).toBeNull();
    expect(harness.controller.setQuery).toHaveBeenLastCalledWith('');
    expect(harness.controller.dispose).not.toHaveBeenCalled();
  });

  it('keeps local exact matches first and retains only deduplicated fuzzy rows', () => {
    const localExact = searchMatch(0);
    localExact.normalizedStart = 10;
    localExact.normalizedEnd = 18;
    const harness = fakeController([localExact]);
    const createController = vi.fn<KnowledgeDocumentSearchControllerFactory>(
      () => harness.controller,
    );
    useKnowledgePassageSearchMock.mockReturnValue({
      state: 'ready',
      generationKey: 'generation-1',
      response: {
        ok: true,
        requestId: 'request-1',
        availability: 'ready',
        normalizedQuery: 'failover',
        results: [
          fuzzyResult('enhanced-exact', { matchKind: 'exact' }),
          fuzzyResult('enhanced-token', { matchKind: 'tokens' }),
          fuzzyResult('enhanced-prefix', { matchKind: 'prefix' }),
          fuzzyResult('duplicate-fuzzy'),
          fuzzyResult('unique-fuzzy', {
            pageIndex: 1,
            normalizedStart: 4,
            normalizedEnd: 12,
          }),
          fuzzyResult('repeat-unique-fuzzy', {
            pageIndex: 1,
            normalizedStart: 4,
            normalizedEnd: 12,
          }),
        ],
      },
      error: null,
    });
    const { result } = renderHook(() =>
      useKnowledgeDocumentSearch(session('guide', 'a'), [], 0, createController),
    );
    act(() => harness.publish());
    act(() => result.current.setQuery('failover'));

    expect(result.current.results.map(({ source }) => source)).toEqual(['local-exact', 'fuzzy']);
    expect(result.current.results.map(({ id }) => id)).toEqual([
      `local:${localExact.id}`,
      'fuzzy:unique-fuzzy',
    ]);
    expect(result.current.highlightMatches).toEqual([localExact]);
  });

  it('keeps local exact search usable when enhanced search is unavailable', () => {
    const localExact = searchMatch(0);
    const harness = fakeController([localExact]);
    const createController = vi.fn<KnowledgeDocumentSearchControllerFactory>(
      () => harness.controller,
    );
    useKnowledgePassageSearchMock.mockReturnValue({
      state: 'unavailable',
      generationKey: 'generation-offline',
      response: null,
      error: 'unavailable',
    });
    const { result } = renderHook(() =>
      useKnowledgeDocumentSearch(session('guide', 'a'), [], 0, createController),
    );
    act(() => harness.publish());

    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0]?.source).toBe('local-exact');
    expect(result.current.enhancedUnavailable).toBe(true);
  });

  it('cycles arrow navigation across the merged exact and fuzzy result array', async () => {
    const canonicalMatch = searchMatch(4);
    canonicalMatch.pageIndex = 1;
    const harness = fakeController([searchMatch(0)], canonicalMatch);
    const createController = vi.fn<KnowledgeDocumentSearchControllerFactory>(
      () => harness.controller,
    );
    useKnowledgePassageSearchMock.mockReturnValue({
      state: 'ready',
      generationKey: 'generation-merged-navigation',
      response: {
        ok: true,
        requestId: 'request-merged-navigation',
        availability: 'ready',
        normalizedQuery: 'failvoer',
        results: [fuzzyResult('fuzzy-navigation', { pageIndex: 1 })],
      },
      error: null,
    });
    const { result } = renderHook(() =>
      useKnowledgeDocumentSearch(session('guide', 'a'), [], 0, createController),
    );
    act(() => harness.publish());
    act(() => result.current.setQuery('failvoer'));

    act(() => result.current.activatePrevious());

    await vi.waitFor(() => expect(result.current.activeResultIndex).toBe(1));
    expect(harness.controller.resolveExternalMatch).toHaveBeenCalledOnce();
  });

  it('resolves a fuzzy activation to a canonical highlight and navigation request', async () => {
    const canonicalMatch = searchMatch(9);
    canonicalMatch.pageIndex = 1;
    const harness = fakeController([], canonicalMatch);
    harness.controller.resolveExternalMatch.mockImplementation(async () => {
      harness.publish();
      return canonicalMatch;
    });
    const createController = vi.fn<KnowledgeDocumentSearchControllerFactory>(
      () => harness.controller,
    );
    useKnowledgePassageSearchMock.mockReturnValue({
      state: 'ready',
      generationKey: 'generation-2',
      response: {
        ok: true,
        requestId: 'request-2',
        availability: 'ready',
        normalizedQuery: 'failvoer',
        results: [fuzzyResult('fuzzy-activation', { pageIndex: 1 })],
      },
      error: null,
    });
    const { result } = renderHook(() =>
      useKnowledgeDocumentSearch(session('guide', 'a'), [], 0, createController),
    );
    act(() => result.current.setQuery('failvoer'));

    await act(async () => result.current.activateResult(0));

    expect(harness.controller.resolveExternalMatch).toHaveBeenCalledWith(
      expect.objectContaining({ pageIndex: 1, highlightText: 'failover' }),
    );
    expect(result.current.highlightMatches).toContainEqual(canonicalMatch);
    expect(result.current.navigationRequest?.result).toEqual(canonicalMatch);
    expect(result.current.activeResultIndex).toBe(0);
  });

  it('rejects a stale fuzzy resolution after the query changes', async () => {
    let resolveMatch!: (match: KnowledgeDocumentSearchMatch | null) => void;
    const harness = fakeController([]);
    harness.controller.resolveExternalMatch.mockImplementation(
      () => new Promise((resolve) => (resolveMatch = resolve)),
    );
    const createController = vi.fn<KnowledgeDocumentSearchControllerFactory>(
      () => harness.controller,
    );
    useKnowledgePassageSearchMock.mockReturnValue({
      state: 'ready',
      generationKey: 'generation-3',
      response: {
        ok: true,
        requestId: 'request-3',
        availability: 'ready',
        normalizedQuery: 'failvoer',
        results: [fuzzyResult('stale-fuzzy')],
      },
      error: null,
    });
    const { result } = renderHook(() =>
      useKnowledgeDocumentSearch(session('guide', 'a'), [], 0, createController),
    );
    act(() => result.current.setQuery('failvoer'));

    let activation!: Promise<void>;
    act(() => {
      activation = result.current.activateResult(0);
    });
    act(() => result.current.setQuery('new query'));
    await act(async () => {
      resolveMatch(searchMatch(8));
      await activation;
    });

    expect(result.current.navigationRequest).toBeNull();
    expect(result.current.highlightMatches).toEqual([]);
  });

  it('keeps a selected fuzzy result stable when progressive exact results are prepended', async () => {
    const canonicalMatch = searchMatch(8);
    canonicalMatch.pageIndex = 1;
    const harness = fakeController([], canonicalMatch);
    const createController = vi.fn<KnowledgeDocumentSearchControllerFactory>(
      () => harness.controller,
    );
    useKnowledgePassageSearchMock.mockReturnValue({
      state: 'ready',
      generationKey: 'generation-stable-id',
      response: {
        ok: true,
        requestId: 'request-stable-id',
        availability: 'ready',
        normalizedQuery: 'failvoer',
        results: [fuzzyResult('stable-fuzzy', { pageIndex: 1 })],
      },
      error: null,
    });
    const { result } = renderHook(() =>
      useKnowledgeDocumentSearch(session('guide', 'a'), [], 0, createController),
    );
    act(() => result.current.setQuery('failvoer'));
    await act(async () => result.current.activateResult(0));

    act(() => harness.publish([searchMatch(0)]));

    expect(result.current.activeResultIndex).toBe(1);
    expect(result.current.activeResult).toMatchObject({
      id: 'fuzzy:stable-fuzzy',
      source: 'fuzzy',
    });
    expect(result.current.navigationRequest?.result).toBe(canonicalMatch);
  });

  it('remaps an overlapped selected fuzzy row to its progressive exact replacement', async () => {
    const canonicalMatch = searchMatch(8);
    canonicalMatch.normalizedStart = 10;
    canonicalMatch.normalizedEnd = 18;
    const harness = fakeController([], canonicalMatch);
    const createController = vi.fn<KnowledgeDocumentSearchControllerFactory>(
      () => harness.controller,
    );
    useKnowledgePassageSearchMock.mockReturnValue({
      state: 'ready',
      generationKey: 'generation-replaced-id',
      response: {
        ok: true,
        requestId: 'request-replaced-id',
        availability: 'ready',
        normalizedQuery: 'failvoer',
        results: [fuzzyResult('replaced-fuzzy')],
      },
      error: null,
    });
    const { result } = renderHook(() =>
      useKnowledgeDocumentSearch(session('guide', 'a'), [], 0, createController),
    );
    act(() => result.current.setQuery('failvoer'));
    await act(async () => result.current.activateResult(0));
    const exactReplacement = searchMatch(2);
    exactReplacement.normalizedStart = 10;
    exactReplacement.normalizedEnd = 18;

    act(() => harness.publish([exactReplacement]));

    await vi.waitFor(() => expect(result.current.activeResult?.source).toBe('local-exact'));
    expect(result.current.activeResultIndex).toBe(0);
    expect(result.current.navigationRequest?.result).toBe(exactReplacement);
    expect(result.current.highlightMatches).toContain(exactReplacement);
  });

  it('hides a failed enhanced generation and recovers on a new same-query response', async () => {
    const exact = searchMatch(0);
    const harness = fakeController([exact], searchMatch(4));
    const createController = vi.fn<KnowledgeDocumentSearchControllerFactory>(
      () => harness.controller,
    );
    const passageModel = (generationKey: string, id: string) => ({
      state: 'ready' as const,
      generationKey,
      response: {
        ok: true as const,
        requestId: `request-${generationKey}`,
        availability: 'ready' as const,
        normalizedQuery: 'failvoer',
        results: [fuzzyResult(id, { pageIndex: 1 })],
      },
      error: null,
    });
    useKnowledgePassageSearchMock.mockReturnValue(passageModel('generation-one', 'fuzzy-one'));
    const { result, rerender } = renderHook(() =>
      useKnowledgeDocumentSearch(session('guide', 'a'), [], 0, createController),
    );
    act(() => harness.publish());
    act(() => result.current.setQuery('failvoer'));
    await act(async () => result.current.activateResult(1));

    act(() => result.current.hideEnhancedResults('generation-one'));

    expect(result.current.enhancedGenerationKey).toBe('generation-one');
    expect(result.current.results.map(({ source }) => source)).toEqual(['local-exact']);
    await vi.waitFor(() => expect(result.current.activeResultIndex).toBe(-1));
    expect(result.current.navigationRequest).toBeNull();

    useKnowledgePassageSearchMock.mockReturnValue(passageModel('generation-two', 'fuzzy-two'));
    rerender();

    expect(result.current.enhancedGenerationKey).toBe('generation-two');
    expect(result.current.results.map(({ source }) => source)).toEqual(['local-exact', 'fuzzy']);
  });
});
