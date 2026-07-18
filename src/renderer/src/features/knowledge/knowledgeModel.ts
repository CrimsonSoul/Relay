import type {
  KnowledgeCategoryRecord,
  KnowledgeDocumentRecord,
  KnowledgeDocumentType,
} from '@shared/knowledge';
import {
  compareKnowledgeCategories,
  compareKnowledgeDocuments,
  knowledgeCategoryKey,
  normalizeKnowledgeSearchText,
} from '@shared/knowledge';

export type KnowledgeCategoryGroup = {
  category: string;
  documents: KnowledgeDocumentRecord[];
};

export type KnowledgeCatalogInput = {
  documents: KnowledgeDocumentRecord[];
  categories: KnowledgeCategoryRecord[];
  query: string;
  categoryId: string | 'all';
  documentType: KnowledgeDocumentType | 'all';
  sort: 'recent' | 'title';
};

export type KnowledgeCatalogView = {
  recent: KnowledgeDocumentRecord[];
  sopGroups: Array<{ category: KnowledgeCategoryRecord; documents: KnowledgeDocumentRecord[] }>;
  cheatsheets: KnowledgeDocumentRecord[];
  total: number;
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

function legacyCategory(document: KnowledgeDocumentRecord): KnowledgeCategoryRecord {
  const name = document.category.trim() || 'Uncategorized';
  return {
    id: `legacy-${knowledgeCategoryKey(name).replaceAll(/[^a-z0-9]+/g, '-')}`,
    name,
    normalizedName: knowledgeCategoryKey(name),
    sortOrder: Number.MAX_SAFE_INTEGER,
    systemKey: '',
    revision: 0,
    created: document.created,
    updated: document.updated,
  };
}

export function buildKnowledgeCatalog(input: KnowledgeCatalogInput): KnowledgeCatalogView {
  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  const categoryFor = (document: KnowledgeDocumentRecord) =>
    (document.categoryId ? categoryById.get(document.categoryId) : undefined) ??
    input.categories.find(
      ({ normalizedName }) => normalizedName === knowledgeCategoryKey(document.category),
    ) ??
    legacyCategory(document);
  const filtered = input.documents.filter((document) => {
    if (document.lifecycleState !== 'active' || !knowledgeDocumentMatches(document, input.query)) {
      return false;
    }
    if (input.documentType !== 'all' && document.documentType !== input.documentType) return false;
    return input.categoryId === 'all' || categoryFor(document).id === input.categoryId;
  });
  const byRecent = (left: KnowledgeDocumentRecord, right: KnowledgeDocumentRecord) =>
    right.updated.localeCompare(left.updated) || compareKnowledgeDocuments(left, right);
  const documentComparator = input.sort === 'recent' ? byRecent : compareKnowledgeDocuments;
  const groups = new Map<
    string,
    { category: KnowledgeCategoryRecord; documents: KnowledgeDocumentRecord[] }
  >();
  for (const document of filtered) {
    if (document.documentType !== 'sop') continue;
    const category = categoryFor(document);
    const group = groups.get(category.id) ?? { category, documents: [] };
    group.documents.push(document);
    groups.set(category.id, group);
  }
  return {
    recent: filtered.toSorted(byRecent).slice(0, 4),
    sopGroups: [...groups.values()]
      .map((group) => ({ ...group, documents: group.documents.toSorted(documentComparator) }))
      .toSorted((left, right) => compareKnowledgeCategories(left.category, right.category)),
    cheatsheets: filtered
      .filter(({ documentType }) => documentType === 'cheatsheet')
      .toSorted(documentComparator),
    total: filtered.length,
  };
}
