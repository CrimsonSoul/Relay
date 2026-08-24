import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
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
  it('owns the transition from a catalog request into reader navigation state', () => {
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
      expect(result.current.openDocument({ documentId: 'guide', headingId: 'restart' })).toBe(true);
    });

    expect(result.current.view).toBe('reader');
    expect(result.current.selectedDocument?.id).toBe('guide');
    expect(result.current.activeHeading?.id).toBe('restart');
    expect(result.current.target).toMatchObject({ pageIndex: 1, top: 200 });
    expect(onClearLibraryQuery).toHaveBeenCalledOnce();
    expect(onCloseLibraryDrawer).toHaveBeenCalledOnce();
  });
});
