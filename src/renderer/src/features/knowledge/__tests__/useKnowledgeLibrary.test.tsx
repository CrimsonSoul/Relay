import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import { useCollection } from '../../../hooks/useCollection';
import { useKnowledgeLibrary } from '../useKnowledgeLibrary';

vi.mock('../../../hooks/useCollection', () => ({ useCollection: vi.fn() }));

const useCollectionMock = vi.mocked(useCollection);

function validRecord(): KnowledgeDocumentRecord {
  return {
    id: 'doc-1',
    sourceKey: 'General/Guide.pdf',
    category: 'General',
    title: 'Guide',
    fileName: 'Guide.pdf',
    pdf: 'Guide.pdf',
    checksum: 'a'.repeat(64),
    byteSize: 1024,
    pageCount: 2,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: '2026-07-14T12:00:00.000Z',
    indexedAt: '2026-07-14T12:00:00.000Z',
    created: '2026-07-14T12:00:00.000Z',
    updated: '2026-07-14T12:00:00.000Z',
  };
}

describe('useKnowledgeLibrary', () => {
  beforeEach(() => {
    useCollectionMock.mockReset();
  });

  it('uses the protected collection with deterministic sorting and discards invalid cache data', () => {
    const documentRefetch = vi.fn(async () => undefined);
    const categoryRefetch = vi.fn(async () => undefined);
    useCollectionMock.mockImplementation((name) => ({
      data:
        name === 'knowledge_documents'
          ? ([
              validRecord(),
              {
                ...validRecord(),
                id: 'trashed',
                lifecycleState: 'trashed',
                trashedByAccountId: 'publisher',
                trashedByName: 'Paris',
                trashedAt: '2026-07-20T12:00:00.000Z',
              },
              { ...validRecord(), id: 'bad', checksum: 'not-a-checksum' },
            ] as never)
          : ([
              {
                id: 'category-general',
                name: 'General',
                normalizedName: 'general',
                sortOrder: 100,
                systemKey: '',
                revision: 1,
                created: '2026-07-14T12:00:00.000Z',
                updated: '2026-07-14T12:00:00.000Z',
              },
            ] as never),
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: name === 'knowledge_documents' ? documentRefetch : categoryRefetch,
    }));

    const { result } = renderHook(() => useKnowledgeLibrary());

    expect(useCollectionMock).toHaveBeenCalledWith('knowledge_documents', {
      sort: 'category,title,fileName',
    });
    expect(useCollectionMock).toHaveBeenCalledWith('knowledge_categories', {
      sort: 'sortOrder,name',
    });
    expect(result.current.documents.map((document) => document.id)).toEqual(['doc-1']);
    expect(result.current.categories.map((category) => category.id)).toEqual(['category-general']);
  });

  it('forwards disabled state to both backing collections', () => {
    useCollectionMock.mockReturnValue({
      data: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: false,
      refetch: vi.fn(async () => undefined),
    });

    renderHook(() => useKnowledgeLibrary({ enabled: false }));

    expect(useCollectionMock).toHaveBeenNthCalledWith(1, 'knowledge_documents', {
      sort: 'category,title,fileName',
      enabled: false,
    });
    expect(useCollectionMock).toHaveBeenNthCalledWith(2, 'knowledge_categories', {
      sort: 'sortOrder,name',
      enabled: false,
    });
  });
});
