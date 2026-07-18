import { useCallback, useMemo } from 'react';
import type { RecordModel } from 'pocketbase';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_CATEGORIES_COLLECTION,
  compareKnowledgeCategories,
  normalizeKnowledgeCategoryRecord,
  normalizeKnowledgeDocumentRecord,
  type KnowledgeCategoryRecord,
  type KnowledgeDocumentRecord,
} from '@shared/knowledge';
import { useCollection } from '../../hooks/useCollection';

export function useKnowledgeLibrary(): {
  documents: KnowledgeDocumentRecord[];
  categories: KnowledgeCategoryRecord[];
  loading: boolean;
  error: string | null;
  hasLoadedSnapshot: boolean;
  refetch: () => Promise<void>;
} {
  const documentCollection = useCollection<KnowledgeDocumentRecord & RecordModel>(
    KNOWLEDGE_DOCUMENTS_COLLECTION,
    { sort: 'category,title,fileName' },
  );
  const categoryCollection = useCollection<KnowledgeCategoryRecord & RecordModel>(
    KNOWLEDGE_CATEGORIES_COLLECTION,
    { sort: 'sortOrder,name' },
  );
  const documents = useMemo(
    () =>
      documentCollection.data
        .map(normalizeKnowledgeDocumentRecord)
        .filter((document): document is KnowledgeDocumentRecord => document !== null),
    [documentCollection.data],
  );
  const categories = useMemo(
    () =>
      categoryCollection.data
        .map(normalizeKnowledgeCategoryRecord)
        .filter((category): category is KnowledgeCategoryRecord => category !== null)
        .toSorted(compareKnowledgeCategories),
    [categoryCollection.data],
  );
  const refetch = useCallback(async () => {
    await Promise.all([documentCollection.refetch(), categoryCollection.refetch()]);
  }, [categoryCollection, documentCollection]);

  return {
    documents,
    categories,
    loading: documentCollection.loading || categoryCollection.loading,
    error: documentCollection.error || categoryCollection.error,
    hasLoadedSnapshot: documentCollection.hasLoadedSnapshot && categoryCollection.hasLoadedSnapshot,
    refetch,
  };
}
