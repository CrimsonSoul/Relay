import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import {
  compareKnowledgeCategories,
  compareKnowledgeDocuments,
  normalizeKnowledgeSearchText,
} from '@shared/knowledge';

export type KnowledgeCategoryGroup = {
  category: string;
  documents: KnowledgeDocumentRecord[];
};

export function knowledgeDocumentMatches(
  document: KnowledgeDocumentRecord,
  rawQuery: string,
): boolean {
  const query = normalizeKnowledgeSearchText(rawQuery);
  if (!query) return true;
  const searchableText = normalizeKnowledgeSearchText(
    [
      document.category,
      document.displayTitle,
      document.fileName,
      ...document.outline.map((node) => node.label),
    ].join(' '),
  );
  return query.split(' ').every((term) => searchableText.includes(term));
}

export function buildKnowledgeLibrary(
  documents: readonly KnowledgeDocumentRecord[],
  query = '',
): KnowledgeCategoryGroup[] {
  const grouped = new Map<string, KnowledgeDocumentRecord[]>();
  for (const document of documents) {
    if (document.lifecycleState !== 'active') continue;
    if (!knowledgeDocumentMatches(document, query)) continue;
    const category = document.category.trim() || 'General';
    const categoryDocuments = grouped.get(category) ?? [];
    categoryDocuments.push(document);
    grouped.set(category, categoryDocuments);
  }

  return [...grouped]
    .map(([category, categoryDocuments]) => ({
      category,
      documents: categoryDocuments.toSorted(compareKnowledgeDocuments),
    }))
    .toSorted((left, right) => compareKnowledgeCategories(left.category, right.category));
}

export function findKnowledgeDocument(
  library: readonly KnowledgeCategoryGroup[],
  documentId: string | null,
): KnowledgeDocumentRecord | null {
  if (!documentId) return library[0]?.documents[0] ?? null;
  for (const group of library) {
    const selected = group.documents.find((document) => document.id === documentId);
    if (selected) return selected;
  }
  return null;
}
