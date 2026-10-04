import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  KnowledgeCategoryRecord,
  KnowledgeDocumentRecord,
  KnowledgeDocumentType,
} from '@shared/knowledge';
import {
  isKnowledgeSearchQueryEligible,
  isKnowledgeSearchQueryWithinCodePointLimit,
  normalizeKnowledgeSearchQuery,
} from '@shared/knowledgeSearch';
import { TabPageHeader } from '../../components/tab-chrome/TabChrome';
import { TactileButton } from '../../components/TactileButton';
import { SearchInput } from '../../components/SearchInput';
import {
  buildKnowledgeCatalog,
  buildLocalKnowledgeSearchResults,
  type KnowledgeCatalogView,
} from './knowledgeModel';
import { KnowledgeCheatsheetRow } from './KnowledgeCheatsheetRow';
import { KnowledgePassageResultList } from './KnowledgePassageResultList';
import { KnowledgeSopCard } from './KnowledgeSopCard';
import type { KnowledgeOpenRequest } from './knowledgeNavigation';
import { KNOWLEDGE_SUBTITLES } from './knowledgeWorkspaceNavigation';
import { useKnowledgePassageSearch } from './useKnowledgePassageSearch';

function resultDestinationKey(result: {
  documentId: string;
  pageIndex: number;
  normalizedStart: number;
  normalizedEnd: number;
}): string {
  return JSON.stringify([
    result.documentId,
    result.pageIndex,
    result.normalizedStart,
    result.normalizedEnd,
  ]);
}

function KnowledgeCoverCatalog({
  catalog,
  onOpenDocument,
}: Readonly<{
  catalog: KnowledgeCatalogView;
  onOpenDocument: (request: KnowledgeOpenRequest) => void;
}>) {
  return (
    <>
      {catalog.sopGroups.length > 0 && (
        <section className="knowledge-catalog__sops" aria-labelledby="sop-manuals-title">
          <h2 id="sop-manuals-title" className="knowledge-catalog__section-heading">
            SOP manuals
          </h2>
          {catalog.sopGroups.map((group) => (
            <section
              key={group.category.id}
              className="knowledge-sop-group"
              aria-labelledby={`category-${group.category.id}`}
            >
              <div className="knowledge-sop-group__heading">
                <h3 id={`category-${group.category.id}`}>{group.category.name}</h3>
                <span>{group.documents.length}</span>
              </div>
              <div className="knowledge-sop-grid">
                {group.documents.map((document) => (
                  <KnowledgeSopCard
                    key={document.id}
                    document={document}
                    onOpen={(documentId) => onOpenDocument({ documentId })}
                  />
                ))}
              </div>
            </section>
          ))}
        </section>
      )}

      {catalog.cheatsheets.length > 0 && (
        <section className="knowledge-catalog__cheatsheets" aria-labelledby="quick-guides-title">
          <h2 id="quick-guides-title" className="knowledge-catalog__section-heading">
            Quick guides
          </h2>
          <div className="knowledge-cheatsheet-list">
            {catalog.cheatsheets.map((document) => (
              <KnowledgeCheatsheetRow
                key={document.id}
                document={document}
                onOpen={(documentId) => onOpenDocument({ documentId })}
              />
            ))}
          </div>
        </section>
      )}

      {/* Mounted empty (and out of flow) so the no-match message is announced when it arrives. */}
      <div className={catalog.total === 0 ? 'knowledge-catalog__empty' : 'sr-only'} role="status">
        {catalog.total === 0 && (
          <>
            <strong>No documents match these filters.</strong>
            <span>Try a broader search or select all categories and types.</span>
          </>
        )}
      </div>
    </>
  );
}

export function KnowledgeLibrary({
  documents,
  categories,
  canManage,
  onManage,
  onOpenDocument,
}: Readonly<{
  documents: KnowledgeDocumentRecord[];
  categories: KnowledgeCategoryRecord[];
  canManage: boolean;
  onManage: () => void;
  onOpenDocument: (request: KnowledgeOpenRequest) => void;
}>) {
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [documentType, setDocumentType] = useState<KnowledgeDocumentType | 'all'>('all');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const activeQuery = query.trim().length > 0;
  const normalizedQuery = useMemo(() => normalizeKnowledgeSearchQuery(query), [query]);
  const catalog = useMemo(
    () =>
      buildKnowledgeCatalog({
        documents,
        categories,
        query: activeQuery ? '' : query,
        categoryId,
        documentType,
        sort,
      }),
    [activeQuery, categories, categoryId, documentType, documents, query, sort],
  );
  const filteredDocuments = useMemo(
    () => [...catalog.sopGroups.flatMap((group) => group.documents), ...catalog.cheatsheets],
    [catalog.cheatsheets, catalog.sopGroups],
  );
  const documentsById = useMemo(
    () => new Map(filteredDocuments.map((document) => [document.id, document])),
    [filteredDocuments],
  );
  const localResults = useMemo(
    () => buildLocalKnowledgeSearchResults(filteredDocuments, query),
    [filteredDocuments, query],
  );
  const passageSearch = useKnowledgePassageSearch({
    query,
    scope: { kind: 'all' },
    categoryId: categoryId === 'all' ? null : categoryId,
    documentType: documentType === 'all' ? null : documentType,
    enabled: activeQuery,
  });
  const searchInputIdentity = JSON.stringify([normalizedQuery, categoryId, documentType]);
  const observedGeneration = useRef<{
    generationKey: string;
    inputIdentity: string;
  } | null>(null);
  useEffect(() => {
    if (passageSearch.state !== 'loading' || !passageSearch.generationKey) return;
    observedGeneration.current = {
      generationKey: passageSearch.generationKey,
      inputIdentity: searchInputIdentity,
    };
  }, [passageSearch.generationKey, passageSearch.state, searchInputIdentity]);
  const generationMatchesInput =
    observedGeneration.current === null ||
    (observedGeneration.current.generationKey === passageSearch.generationKey &&
      observedGeneration.current.inputIdentity === searchInputIdentity);
  const enhancedEligible =
    activeQuery &&
    isKnowledgeSearchQueryWithinCodePointLimit(query) &&
    isKnowledgeSearchQueryWithinCodePointLimit(normalizedQuery) &&
    isKnowledgeSearchQueryEligible(normalizedQuery);
  const currentReadyResponse =
    passageSearch.state === 'ready' &&
    generationMatchesInput &&
    passageSearch.response?.requestId === passageSearch.generationKey &&
    passageSearch.response.normalizedQuery === normalizedQuery
      ? passageSearch.response
      : null;
  const enhancedUnavailable = passageSearch.state === 'unavailable' && generationMatchesInput;
  const settled = !enhancedEligible || currentReadyResponse !== null || enhancedUnavailable;
  let searchIdentity = `local:${searchInputIdentity}`;
  if (enhancedEligible) {
    const generationKey =
      generationMatchesInput || currentReadyResponse ? passageSearch.generationKey : 'pending';
    searchIdentity = `${normalizedQuery}:${generationKey}`;
  }
  const enhancedResults = useMemo(() => {
    const seen = new Set(localResults.map(resultDestinationKey));
    return (currentReadyResponse?.results ?? []).filter((result) => {
      if (!documentsById.has(result.documentId)) return false;
      const key = resultDestinationKey(result);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [currentReadyResponse, documentsById, localResults]);

  return (
    <main className="knowledge-catalog" aria-labelledby="knowledge-catalog-title">
      <TabPageHeader
        title="Wiki"
        subtitle={KNOWLEDGE_SUBTITLES.wiki}
        headingId="knowledge-catalog-title"
        headingLevel={1}
        className="knowledge-catalog__header"
        metadata={
          <span className="knowledge-catalog__header-meta">
            <span>{documents.length} documents</span>
            {canManage && (
              <TactileButton variant="secondary" onClick={onManage}>
                Manage Wiki
              </TactileButton>
            )}
          </span>
        }
      />

      <div className="knowledge-catalog__filters" aria-label="Wiki filters">
        <div className="knowledge-catalog__search scoped-search-control">
          <SearchInput
            type="search"
            aria-label="Search Wiki"
            placeholder="Search Wiki"
            className="scoped-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label>
          <span>Category</span>
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Type</span>
          <select
            value={documentType}
            onChange={(event) =>
              setDocumentType(event.target.value as KnowledgeDocumentType | 'all')
            }
          >
            <option value="all">All types</option>
            <option value="sop">SOP manuals</option>
            <option value="cheatsheet">Quick guides</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as 'recent' | 'title')}
          >
            <option value="recent">Recently updated</option>
            <option value="title">Title</option>
          </select>
        </label>
      </div>

      {activeQuery ? (
        <KnowledgePassageResultList
          documentsById={documentsById}
          localResults={localResults}
          enhancedResults={enhancedResults}
          loading={passageSearch.state === 'loading'}
          unavailable={enhancedUnavailable}
          searchIdentity={searchIdentity}
          settled={settled}
          onOpen={onOpenDocument}
        />
      ) : (
        <KnowledgeCoverCatalog catalog={catalog} onOpenDocument={onOpenDocument} />
      )}
    </main>
  );
}
