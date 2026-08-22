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
import {
  KNOWLEDGE_SEARCH_MAX_EXCERPT_TEXT,
  normalizeKnowledgeSearchQuery,
  type KnowledgeSearchResult,
} from '@shared/knowledgeSearch';

export type KnowledgeCategoryGroup = {
  category: string;
  documents: KnowledgeDocumentRecord[];
};

export type KnowledgeCatalogInput = {
  documents: KnowledgeDocumentRecord[];
  categories: KnowledgeCategoryRecord[];
  query: string;
  categoryId: string;
  documentType: KnowledgeDocumentType | 'all';
  sort: 'recent' | 'title';
};

export type KnowledgeCatalogView = {
  sopGroups: Array<{ category: KnowledgeCategoryRecord; documents: KnowledgeDocumentRecord[] }>;
  cheatsheets: KnowledgeDocumentRecord[];
  total: number;
};

type LocalMatch = {
  highlightText: string;
  normalizedStart: number;
  normalizedEnd: number;
};

function localMatch(
  value: string,
  normalizedQuery: string,
  queryTerms: readonly string[],
): LocalMatch | null {
  const normalizedValue = normalizeKnowledgeSearchQuery(value);
  const phraseStart = normalizedValue.indexOf(normalizedQuery);
  if (phraseStart >= 0) {
    return {
      highlightText: normalizedValue.slice(phraseStart, phraseStart + normalizedQuery.length),
      normalizedStart: phraseStart,
      normalizedEnd: phraseStart + normalizedQuery.length,
    };
  }
  if (!queryTerms.every((term) => normalizedValue.includes(term))) return null;
  const firstTerm = queryTerms[0];
  if (!firstTerm) return null;
  const start = normalizedValue.indexOf(firstTerm);
  return {
    highlightText: normalizedValue.slice(start, start + firstTerm.length),
    normalizedStart: start,
    normalizedEnd: start + firstTerm.length,
  };
}

function boundedLocalExcerpt(value: string): string {
  const excerpt = value.trim().replace(/\s+/g, ' ');
  if (excerpt.length <= KNOWLEDGE_SEARCH_MAX_EXCERPT_TEXT) return excerpt;
  return `${excerpt.slice(0, KNOWLEDGE_SEARCH_MAX_EXCERPT_TEXT - 1).trimEnd()}…`;
}

function localResult(
  document: KnowledgeDocumentRecord,
  match: LocalMatch,
  heading: KnowledgeDocumentRecord['outline'][number] | null,
  excerpt: string,
  score: number,
): KnowledgeSearchResult {
  return {
    id: `local-${document.id}-${heading?.id ?? 'document'}`,
    documentId: document.id,
    checksum: document.checksum,
    title: document.displayTitle,
    fileName: document.fileName,
    category: document.category,
    categoryId: document.categoryId,
    documentType: document.documentType,
    headingId: heading?.id ?? null,
    heading: heading?.label ?? null,
    pageIndex: heading?.pageIndex ?? 0,
    passageNumber: 1,
    excerpt: boundedLocalExcerpt(excerpt),
    matchKind: 'exact',
    highlightText: match.highlightText,
    normalizedStart: match.normalizedStart,
    normalizedEnd: match.normalizedEnd,
    score,
  };
}

export function buildLocalKnowledgeSearchResults(
  documents: readonly KnowledgeDocumentRecord[],
  rawQuery: string,
): KnowledgeSearchResult[] {
  const normalizedQuery = normalizeKnowledgeSearchQuery(rawQuery);
  if (!normalizedQuery) return [];
  const queryTerms = normalizedQuery.split(' ').filter(Boolean);
  const results: KnowledgeSearchResult[] = [];
  const destinations = new Set<string>();
  const append = (result: KnowledgeSearchResult) => {
    const key = JSON.stringify([
      result.documentId,
      result.pageIndex,
      result.normalizedStart,
      result.normalizedEnd,
    ]);
    if (destinations.has(key)) return;
    destinations.add(key);
    results.push(result);
  };

  for (const document of documents) {
    if (document.lifecycleState !== 'active') continue;
    const metadata = [document.displayTitle, document.fileName, document.category];
    const metadataMatch =
      metadata.map((value) => localMatch(value, normalizedQuery, queryTerms)).find(Boolean) ??
      localMatch(metadata.join(' '), normalizedQuery, queryTerms);
    if (metadataMatch) {
      append(
        localResult(
          document,
          metadataMatch,
          null,
          [document.displayTitle, document.category, document.fileName].join(' · '),
          500,
        ),
      );
    }
    for (const heading of document.outline) {
      const headingMatch = localMatch(heading.label, normalizedQuery, queryTerms);
      if (!headingMatch) continue;
      append(localResult(document, headingMatch, heading, heading.label, 490));
    }
  }
  return results;
}

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
    sopGroups: [...groups.values()]
      .map((group) => ({ ...group, documents: group.documents.toSorted(documentComparator) }))
      .toSorted((left, right) => compareKnowledgeCategories(left.category, right.category)),
    cheatsheets: filtered
      .filter(({ documentType }) => documentType === 'cheatsheet')
      .toSorted(documentComparator),
    total: filtered.length,
  };
}
