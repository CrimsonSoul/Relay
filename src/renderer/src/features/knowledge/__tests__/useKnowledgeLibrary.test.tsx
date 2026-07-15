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
    const refetch = vi.fn(async () => undefined);
    useCollectionMock.mockReturnValue({
      data: [validRecord(), { ...validRecord(), id: 'bad', checksum: 'not-a-checksum' }] as never,
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch,
    });

    const { result } = renderHook(() => useKnowledgeLibrary());

    expect(useCollectionMock).toHaveBeenCalledWith('knowledge_documents', {
      sort: 'category,title,fileName',
    });
    expect(result.current.documents.map((document) => document.id)).toEqual(['doc-1']);
    expect(result.current.refetch).toBe(refetch);
  });
});
