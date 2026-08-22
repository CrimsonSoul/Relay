import { useCallback, useMemo, useRef } from 'react';
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

type KnowledgeLibraryOptions = {
  enabled?: boolean;
  retainSnapshotWhenDisabled?: boolean;
};

export function useKnowledgeLibrary(options: KnowledgeLibraryOptions = {}): {
  documents: KnowledgeDocumentRecord[];
  categories: KnowledgeCategoryRecord[];
  loading: boolean;
  error: string | null;
  hasLoadedSnapshot: boolean;
  refetch: () => Promise<void>;
} {
  const enabled = options.enabled ?? true;
  const enabledOption = options.enabled === undefined ? {} : { enabled };
  const documentCollection = useCollection<KnowledgeDocumentRecord & RecordModel>(
    KNOWLEDGE_DOCUMENTS_COLLECTION,
    { sort: 'category,title,fileName', ...enabledOption },
  );
  const categoryCollection = useCollection<KnowledgeCategoryRecord & RecordModel>(
    KNOWLEDGE_CATEGORIES_COLLECTION,
    { sort: 'sortOrder,name', ...enabledOption },
  );
  const currentDocuments = useMemo(
    () =>
      documentCollection.data
        .map(normalizeKnowledgeDocumentRecord)
        .filter(
          (document): document is KnowledgeDocumentRecord =>
            document !== null && document.lifecycleState === 'active',
        ),
    [documentCollection.data],
  );
  const currentCategories = useMemo(
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

  const retainedSnapshot = useRef({
    documents: currentDocuments,
    categories: currentCategories,
    hasLoadedSnapshot: false,
  });
  const hasLoadedSnapshot =
    documentCollection.hasLoadedSnapshot && categoryCollection.hasLoadedSnapshot;
  if (enabled && hasLoadedSnapshot && !documentCollection.error && !categoryCollection.error) {
    retainedSnapshot.current = {
      documents: currentDocuments,
      categories: currentCategories,
      hasLoadedSnapshot: true,
    };
  }
  const useRetainedSnapshot = !enabled && options.retainSnapshotWhenDisabled;

  return {
    documents: useRetainedSnapshot ? retainedSnapshot.current.documents : currentDocuments,
    categories: useRetainedSnapshot ? retainedSnapshot.current.categories : currentCategories,
    loading: useRetainedSnapshot ? false : documentCollection.loading || categoryCollection.loading,
    error: useRetainedSnapshot ? null : documentCollection.error || categoryCollection.error,
    hasLoadedSnapshot: useRetainedSnapshot
      ? retainedSnapshot.current.hasLoadedSnapshot
      : hasLoadedSnapshot,
    refetch,
  };
}
