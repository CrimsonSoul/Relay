import { useMemo } from 'react';
import type { RecordModel } from 'pocketbase';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  normalizeKnowledgeDocumentRecord,
  type KnowledgeDocumentRecord,
} from '@shared/knowledge';
import { useCollection } from '../../hooks/useCollection';

export function useKnowledgeLibrary(): {
  documents: KnowledgeDocumentRecord[];
  loading: boolean;
  error: string | null;
  hasLoadedSnapshot: boolean;
  refetch: () => Promise<void>;
} {
  const collection = useCollection<KnowledgeDocumentRecord & RecordModel>(
    KNOWLEDGE_DOCUMENTS_COLLECTION,
    { sort: 'category,title,fileName' },
  );
  const documents = useMemo(
    () =>
      collection.data
        .map(normalizeKnowledgeDocumentRecord)
        .filter((document): document is KnowledgeDocumentRecord => document !== null),
    [collection.data],
  );

  return { ...collection, documents };
}
