import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../useKnowledgeDocumentSearch', () => ({
  useKnowledgeDocumentSearch: () => ({
    query: '',
    snapshot: { state: 'idle', results: [] },
    results: [],
    highlightMatches: [],
    enhancedUnavailable: false,
    enhancedGenerationKey: '',
    activeResultIndex: -1,
    activeResult: null,
    navigationRequest: null,
    setQuery: vi.fn(),
    activateResult: vi.fn(),
    activateNext: vi.fn(),
    activatePrevious: vi.fn(),
    clear: vi.fn(),
    activateExternalTarget: vi.fn(async () => false),
    cancelExternalActivation: vi.fn(),
    hideEnhancedResults: vi.fn(),
  }),
}));

import { useKnowledgeReaderNavigation } from '../useKnowledgeReaderNavigation';
import {
  acknowledgeKnowledgeDocumentOpen,
  getPendingKnowledgeDocumentOpen,
  requestKnowledgeDocumentOpen,
} from '../knowledgeNavigation';

function guide(): KnowledgeDocumentRecord {
  return {
    id: 'guide',
    sourceKey: 'Operations/Guide.pdf',
    category: 'Operations',
    categoryId: null,
    documentType: 'sop',
    title: 'Guide',
    displayTitle: 'Guide',
    fileName: 'Guide.pdf',
    pdf: 'Guide.pdf',
    cover: null,
    checksum: 'a'.repeat(64),
    byteSize: 1024,
    pageCount: 3,
    outline: [{ id: 'restart', label: 'Restart', level: 1, pageIndex: 1, top: 200 }],
    outlineSource: 'native',
    sourceModifiedAt: '2026-08-23T12:00:00.000Z',
    indexedAt: '2026-08-23T12:00:00.000Z',
    searchIndexState: 'ready',
    searchIndexChecksum: 'a'.repeat(64),
    searchIndexVersion: 1,
    searchIndexedAt: '2026-08-23T12:00:00.000Z',
    searchIndexError: null,
    lifecycleState: 'active',
    revision: 1,
    publishedByAccountId: 'publisher',
    publishedByName: 'Publisher',
    publishedAt: '2026-08-23T12:00:00.000Z',
    trashedByAccountId: null,
    trashedByName: null,
    trashedAt: null,
    created: '2026-08-23T12:00:00.000Z',
    updated: '2026-08-23T12:00:00.000Z',
  };
}

describe('useKnowledgeReaderNavigation', () => {
  afterEach(() => {
    const pending = getPendingKnowledgeDocumentOpen();
    if (pending) acknowledgeKnowledgeDocumentOpen(pending.documentId);
    showToast.mockReset();
  });

  it('owns the transition from an external open request into reader navigation state', () => {
    const document = guide();
    const onClearLibraryQuery = vi.fn();
    const onCloseLibraryDrawer = vi.fn();
    const { result } = renderHook(() =>
      useKnowledgeReaderNavigation({
        documents: [document],
        loading: false,
        error: null,
        hasLoadedSnapshot: true,
        refetch: vi.fn(async () => undefined),
        onClearLibraryQuery,
        onCloseLibraryDrawer,
      }),
    );

    act(() => {
      requestKnowledgeDocumentOpen({ documentId: 'guide', headingId: 'restart' });
    });

    expect(result.current.view).toBe('reader');
    expect(result.current.selectedDocument?.id).toBe('guide');
    expect(result.current.activeHeading?.id).toBe('restart');
    expect(result.current.target).toMatchObject({ pageIndex: 1, top: 200 });
    expect(onClearLibraryQuery).toHaveBeenCalledOnce();
    expect(onCloseLibraryDrawer).toHaveBeenCalledOnce();
    expect(getPendingKnowledgeDocumentOpen()).toBeNull();
  });

  it('expires a pending open once a refreshed snapshot confirms the document is absent', async () => {
    const refetch = vi.fn(async () => undefined);
    requestKnowledgeDocumentOpen({ documentId: 'removed-guide' });
    const { result } = renderHook(() =>
      useKnowledgeReaderNavigation({
        documents: [guide()],
        loading: false,
        error: null,
        hasLoadedSnapshot: true,
        refetch,
        onClearLibraryQuery: vi.fn(),
        onCloseLibraryDrawer: vi.fn(),
      }),
    );

    expect(refetch).toHaveBeenCalledOnce();
    await waitFor(() => expect(getPendingKnowledgeDocumentOpen()).toBeNull());
    expect(showToast).toHaveBeenCalledWith('Wiki document not found.', 'error');
    expect(result.current.view).toBe('catalog');
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps a pending open while the library is still loading or failed', () => {
    const refetch = vi.fn(async () => undefined);
    requestKnowledgeDocumentOpen({ documentId: 'later-guide' });
    const { rerender } = renderHook(
      ({ loading, error }: { loading: boolean; error: string | null }) =>
        useKnowledgeReaderNavigation({
          documents: [],
          loading,
          error,
          hasLoadedSnapshot: true,
          refetch,
          onClearLibraryQuery: vi.fn(),
          onCloseLibraryDrawer: vi.fn(),
        }),
      { initialProps: { loading: true, error: null as string | null } },
    );
    rerender({ loading: false, error: 'offline' });

    expect(refetch).not.toHaveBeenCalled();
    expect(getPendingKnowledgeDocumentOpen()).toMatchObject({ documentId: 'later-guide' });
  });
});
