import { useMemo, useState } from 'react';
import type {
  KnowledgeCategoryRecord,
  KnowledgeDocumentRecord,
  KnowledgeDocumentType,
} from '@shared/knowledge';
import { TactileButton } from '../../components/TactileButton';
import { buildKnowledgeCatalog } from './knowledgeModel';
import { KnowledgeCheatsheetRow } from './KnowledgeCheatsheetRow';
import { KnowledgeSopCard } from './KnowledgeSopCard';

function updatedLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Recently updated'
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
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
  onOpenDocument: (documentId: string) => void;
}>) {
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | 'all'>('all');
  const [documentType, setDocumentType] = useState<KnowledgeDocumentType | 'all'>('all');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const catalog = useMemo(
    () => buildKnowledgeCatalog({ documents, categories, query, categoryId, documentType, sort }),
    [categories, categoryId, documentType, documents, query, sort],
  );

  return (
    <main className="knowledge-catalog" aria-labelledby="knowledge-catalog-title">
      <header className="knowledge-catalog__header">
        <div>
          <h1 id="knowledge-catalog-title">Wiki</h1>
          <p>
            Operational procedures and fast-reference guides, organized for the response in front of
            you.
          </p>
        </div>
        <div className="knowledge-catalog__header-meta">
          <span>{documents.length} documents</span>
          {canManage && (
            <TactileButton variant="secondary" onClick={onManage}>
              Manage Wiki
            </TactileButton>
          )}
        </div>
      </header>

      <div className="knowledge-catalog__filters" aria-label="Wiki filters">
        <label className="knowledge-catalog__search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label="Search Wiki catalog"
            placeholder="Search guides and sections"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
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
            <option value="sop">SOP guides</option>
            <option value="cheatsheet">Cheatsheets</option>
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

      {catalog.recent.length > 0 && (
        <section className="knowledge-catalog__recent" aria-labelledby="knowledge-recent-title">
          <div className="knowledge-catalog__section-heading">
            <h2 id="knowledge-recent-title">Recently updated</h2>
            <span>Latest library changes</span>
          </div>
          <div className="knowledge-recent-shelf">
            {catalog.recent.map((document) => (
              <button
                key={document.id}
                type="button"
                className="knowledge-recent-item"
                aria-label={`Open ${document.displayTitle}`}
                onClick={() => onOpenDocument(document.id)}
              >
                <span data-type={document.documentType}>
                  {document.documentType === 'sop' ? 'SOP' : 'QS'}
                </span>
                <strong>{document.displayTitle}</strong>
                <small>{updatedLabel(document.updated)}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {catalog.sopGroups.length > 0 && (
        <section className="knowledge-catalog__sops" aria-labelledby="sop-guides-title">
          <div className="knowledge-catalog__section-heading">
            <h2 id="sop-guides-title">SOP guides</h2>
            <span>Complete procedures</span>
          </div>
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
                  <KnowledgeSopCard key={document.id} document={document} onOpen={onOpenDocument} />
                ))}
              </div>
            </section>
          ))}
        </section>
      )}

      {catalog.cheatsheets.length > 0 && (
        <section className="knowledge-catalog__cheatsheets" aria-labelledby="cheatsheets-title">
          <div className="knowledge-catalog__section-heading">
            <h2 id="cheatsheets-title">Cheatsheets</h2>
            <span>Fast reference</span>
          </div>
          <div className="knowledge-cheatsheet-list">
            {catalog.cheatsheets.map((document) => (
              <KnowledgeCheatsheetRow
                key={document.id}
                document={document}
                onOpen={onOpenDocument}
              />
            ))}
          </div>
        </section>
      )}

      {catalog.total === 0 && (
        <div className="knowledge-catalog__empty" role="status">
          <strong>No documents match these filters.</strong>
          <span>Try a broader search or select all categories and types.</span>
        </div>
      )}
    </main>
  );
}
