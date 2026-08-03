import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type {
  KnowledgeCategoryRecord,
  KnowledgeDocumentType,
  KnowledgeManagementDocumentView,
} from '@shared/knowledge';
import { SearchInput } from '../../../components/SearchInput';
import { TactileButton } from '../../../components/TactileButton';
import type { useKnowledgeManagement } from '../useKnowledgeManagement';

type KnowledgeManagementController = ReturnType<typeof useKnowledgeManagement>;
type Draft = { title: string; categoryId: string; documentType: KnowledgeDocumentType };
type DraftErrors = Partial<Record<'title' | 'categoryId', string>>;
type RetryFocusIntent = { documentId: string; operationId: number; settled: boolean };

const SEARCH_READINESS_LABELS = {
  pending: 'Indexing search',
  ready: 'Search ready',
  failed: 'Search needs retry',
} as const;

function formatDate(value: string | null): string {
  if (!value) return 'Unknown time';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function matchesDocument(document: KnowledgeManagementDocumentView, query: string): boolean {
  const text =
    `${document.displayTitle} ${document.fileName} ${document.category}`.toLocaleLowerCase('en');
  return query
    .trim()
    .toLocaleLowerCase('en')
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => text.includes(term));
}

function EmptyPanel({ children }: Readonly<{ children: string }>) {
  return <div className="knowledge-management-empty">{children}</div>;
}

type KnowledgeDocumentsSectionProps = {
  active: boolean;
  management: KnowledgeManagementController;
  documents: KnowledgeManagementDocumentView[];
  categories: KnowledgeCategoryRecord[];
  query: string;
  setQuery: (query: string) => void;
  sectionContentRef: RefObject<HTMLDivElement | null>;
  openUploads: (notice: string) => void;
};

export function KnowledgeDocumentsSection({
  active,
  management,
  documents,
  categories,
  query,
  setQuery,
  sectionContentRef,
  openUploads,
}: Readonly<KnowledgeDocumentsSectionProps>) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>({
    title: '',
    categoryId: '',
    documentType: 'sop',
  });
  const [editErrors, setEditErrors] = useState<DraftErrors>({});
  const editTitleRef = useRef<HTMLInputElement>(null);
  const editCategoryRef = useRef<HTMLSelectElement>(null);
  const documentsHeadingRef = useRef<HTMLHeadingElement>(null);
  const retryFocusOperationRef = useRef(0);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [retryFocusIntent, setRetryFocusIntent] = useState<RetryFocusIntent | null>(null);
  const snapshot = management.snapshot;
  const filteredDocuments = useMemo(
    () => documents.filter((document) => matchesDocument(document, query)),
    [documents, query],
  );
  const searchableDocumentCount = documents.filter(
    ({ searchIndexState }) => searchIndexState === 'ready',
  ).length;

  useEffect(() => {
    if (!retryFocusIntent?.settled) return;
    const retryButton = [
      ...globalThis.document.querySelectorAll<HTMLButtonElement>('[data-search-retry-document-id]'),
    ].find((button) => button.dataset.searchRetryDocumentId === retryFocusIntent.documentId);
    const readiness = [
      ...globalThis.document.querySelectorAll<HTMLElement>('[data-search-readiness-document-id]'),
    ].find((status) => status.dataset.searchReadinessDocumentId === retryFocusIntent.documentId);
    const target =
      retryButton ?? readiness ?? documentsHeadingRef.current ?? sectionContentRef.current;
    target?.focus();
    setRetryFocusIntent((current) =>
      current?.operationId === retryFocusIntent.operationId ? null : current,
    );
  }, [retryFocusIntent, sectionContentRef]);

  const beginEdit = (document: KnowledgeManagementDocumentView) => {
    setEditingId(document.id);
    setEditDraft({
      title: document.displayTitle,
      categoryId:
        document.categoryId ??
        categories.find(
          ({ normalizedName }) =>
            normalizedName === document.category.trim().toLocaleLowerCase('en-US'),
        )?.id ??
        '',
      documentType: document.documentType,
    });
    setEditErrors({});
  };

  const saveEdit = async (document: KnowledgeManagementDocumentView) => {
    const nextErrors: DraftErrors = {};
    const trimmedTitle = editDraft.title.trim();
    if (!trimmedTitle) nextErrors.title = 'Enter a display title.';
    if (!editDraft.categoryId) nextErrors.categoryId = 'Choose a category.';
    setEditErrors(nextErrors);
    if (nextErrors.title) {
      editTitleRef.current?.focus();
      return;
    }
    if (nextErrors.categoryId) {
      editCategoryRef.current?.focus();
      return;
    }
    if (
      !(await management.setDocumentMetadata(
        document,
        trimmedTitle,
        editDraft.categoryId,
        editDraft.documentType,
      ))
    )
      return;
    setEditingId(null);
    setEditErrors({});
  };

  const replacePdf = async (document: KnowledgeManagementDocumentView) => {
    const result = await management.stagePdfs(document.id);
    if (!result.ok) return;
    openUploads(
      result.uploads.length === 1
        ? `Replacement for ${document.displayTitle} queued. Use Replace existing when it is ready.`
        : 'PDFs queued. Each duplicate filename can replace its existing document when ready.',
    );
  };

  const retrySearchIndex = async (documentId: string) => {
    const operationId = retryFocusOperationRef.current + 1;
    retryFocusOperationRef.current = operationId;
    setRetryFocusIntent({ documentId, operationId, settled: false });
    try {
      await management.retrySearchIndex(documentId);
    } finally {
      setRetryFocusIntent((current) =>
        current?.operationId === operationId ? { ...current, settled: true } : current,
      );
    }
  };

  const toggleDocumentSelection = (documentId: string, selected: boolean) => {
    setSelectedDocumentIds((current) =>
      selected ? [...current, documentId] : current.filter((id) => id !== documentId),
    );
  };

  if (!active || !snapshot) return null;

  return (
    <>
      <div className="knowledge-management-section-heading knowledge-management-section-heading--documents">
        <h2 ref={documentsHeadingRef} tabIndex={-1}>
          Documents
        </h2>
        {searchableDocumentCount !== documents.length && (
          <output className="knowledge-management__searchable-count">
            {searchableDocumentCount} of {documents.length} searchable
          </output>
        )}
        <output className="knowledge-management__searchable-count">
          {filteredDocuments.length} shown · {documents.length} loaded
          {snapshot.documents.nextCursor ? ' · more available' : ''}
        </output>
      </div>
      <div className="knowledge-management__toolbar">
        <div className="knowledge-management__search scoped-search-control">
          <SearchInput
            type="search"
            aria-label="Search managed documents"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title, PDF, or category"
            className="scoped-search-input"
          />
        </div>
        {categories.length > 0 && (
          <div className="knowledge-management__category-tool">
            <select
              className="tactile-input"
              aria-label="Bulk category"
              value={bulkCategoryId}
              onChange={(event) => setBulkCategoryId(event.target.value)}
            >
              <option value="">Move selected to…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <TactileButton
              size="sm"
              disabled={!bulkCategoryId || selectedDocumentIds.length === 0}
              loading={management.busy === 'documents:category'}
              onClick={() => {
                const selected = documents
                  .filter(({ id }) => selectedDocumentIds.includes(id))
                  .map(({ id, revision }) => ({
                    documentId: id,
                    expectedRevision: revision,
                  }));
                void management
                  .assignDocumentCategories(bulkCategoryId, selected)
                  .then((changed) => {
                    if (changed) setSelectedDocumentIds([]);
                  });
              }}
            >
              Move {selectedDocumentIds.length || ''}
            </TactileButton>
          </div>
        )}
      </div>
      <div className="knowledge-management-list">
        {filteredDocuments.length === 0 && (
          <EmptyPanel>
            {snapshot.documents.nextCursor
              ? 'No loaded documents match this view. Load more documents to keep searching.'
              : 'No documents match this view.'}
          </EmptyPanel>
        )}
        {filteredDocuments.map((document) => (
          <article className="knowledge-management-row" key={document.id}>
            <div className="knowledge-management-row__identity">
              <div className="knowledge-management-row__eyebrow">
                <label className="knowledge-management-row__select">
                  <input
                    type="checkbox"
                    aria-label={`Select ${document.displayTitle}`}
                    checked={selectedDocumentIds.includes(document.id)}
                    onChange={(event) => toggleDocumentSelection(document.id, event.target.checked)}
                  />
                  <span>Select</span>
                </label>
                <span className="knowledge-management-row__type">
                  {document.documentType === 'cheatsheet' ? 'QUICK GUIDE' : 'SOP MANUAL'} ·{' '}
                  {document.pageCount} pages
                </span>
              </div>
              <h2>{document.displayTitle}</h2>
              <p>{document.fileName}</p>
              <div className="knowledge-management-row__search">
                <span
                  className={`knowledge-search-readiness is-${document.searchIndexState}`}
                  data-search-readiness-document-id={document.id}
                  tabIndex={-1}
                >
                  {SEARCH_READINESS_LABELS[document.searchIndexState]}
                </span>
                {document.searchIndexState === 'failed' && (
                  <TactileButton
                    size="sm"
                    className="knowledge-search-readiness__retry"
                    aria-label={`Retry search for ${document.displayTitle}`}
                    data-search-retry-document-id={document.id}
                    loading={management.busy === `search-index:${document.id}`}
                    onClick={() => void retrySearchIndex(document.id)}
                  >
                    Retry
                  </TactileButton>
                )}
              </div>
            </div>
            {editingId === document.id ? (
              <div className="knowledge-management-row__editor">
                <label>
                  Display title{' '}
                  <input
                    className="tactile-input"
                    ref={editTitleRef}
                    aria-invalid={editErrors.title ? true : undefined}
                    aria-describedby={
                      editErrors.title ? `knowledge-title-error-${document.id}` : undefined
                    }
                    value={editDraft.title}
                    onChange={(event) => {
                      setEditDraft((draft) => ({ ...draft, title: event.target.value }));
                      if (editErrors.title && event.target.value.trim()) {
                        setEditErrors((current) => ({ ...current, title: undefined }));
                      }
                    }}
                  />
                  {editErrors.title && (
                    <span
                      id={`knowledge-title-error-${document.id}`}
                      className="knowledge-management-field-error"
                      role="alert"
                    >
                      {editErrors.title}
                    </span>
                  )}
                </label>
                <label>
                  Category{' '}
                  <select
                    className="tactile-input"
                    ref={editCategoryRef}
                    aria-invalid={editErrors.categoryId ? true : undefined}
                    aria-describedby={
                      editErrors.categoryId ? `knowledge-category-error-${document.id}` : undefined
                    }
                    value={editDraft.categoryId}
                    onChange={(event) => {
                      setEditDraft((draft) => ({
                        ...draft,
                        categoryId: event.target.value,
                      }));
                      if (editErrors.categoryId && event.target.value) {
                        setEditErrors((current) => ({
                          ...current,
                          categoryId: undefined,
                        }));
                      }
                    }}
                  >
                    <option value="">Choose category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  {editErrors.categoryId && (
                    <span
                      id={`knowledge-category-error-${document.id}`}
                      className="knowledge-management-field-error"
                      role="alert"
                    >
                      {editErrors.categoryId}
                    </span>
                  )}
                </label>
                <label>
                  Document type{' '}
                  <select
                    className="tactile-input"
                    value={editDraft.documentType}
                    onChange={(event) =>
                      setEditDraft((draft) => ({
                        ...draft,
                        documentType: event.target.value as KnowledgeDocumentType,
                      }))
                    }
                  >
                    <option value="sop">SOP Manual</option>
                    <option value="cheatsheet">Quick Guide</option>
                  </select>
                </label>
                <div>
                  <TactileButton
                    size="sm"
                    onClick={() => {
                      setEditingId(null);
                      setEditErrors({});
                    }}
                  >
                    Cancel
                  </TactileButton>
                  <TactileButton
                    size="sm"
                    variant="primary"
                    loading={management.busy === `metadata:${document.id}`}
                    onClick={() => void saveEdit(document)}
                  >
                    Save changes
                  </TactileButton>
                </div>
              </div>
            ) : (
              <>
                <div className="knowledge-management-row__meta">
                  <span>{document.category}</span>
                  <span>Published by {document.publishedByName || 'Relay migration'}</span>
                  <span>{formatDate(document.publishedAt)}</span>
                </div>
                <div className="knowledge-management-row__actions">
                  <TactileButton size="sm" onClick={() => beginEdit(document)}>
                    Edit
                  </TactileButton>
                  <TactileButton
                    size="sm"
                    onClick={() => void replacePdf(document)}
                    loading={management.busy === 'upload'}
                  >
                    Replace PDF
                  </TactileButton>
                  <TactileButton
                    size="sm"
                    variant="danger"
                    className="knowledge-management__danger-outline"
                    onClick={() =>
                      void management.trash({
                        documentId: document.id,
                        expectedRevision: document.revision,
                      })
                    }
                  >
                    Trash
                  </TactileButton>
                </div>
              </>
            )}
          </article>
        ))}
        {snapshot.documents.nextCursor && (
          <div className="knowledge-management-more">
            <TactileButton
              size="sm"
              loading={management.busy === 'more:documents'}
              onClick={() => void management.loadMore('documents')}
            >
              Load more documents
            </TactileButton>
          </div>
        )}
      </div>
    </>
  );
}
