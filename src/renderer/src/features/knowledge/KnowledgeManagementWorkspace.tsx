import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  knowledgeCategoryKey,
  type KnowledgeCategoryRecord,
  type KnowledgeDocumentType,
  type KnowledgeManagementErrorCode,
  type KnowledgeManagementDocumentView,
  type KnowledgeManagementUploadView,
  type KnowledgeUploadQueueItemState,
  type KnowledgeUploadQueueItemView,
} from '@shared/knowledge';
import { TactileButton } from '../../components/TactileButton';
import { SearchInput } from '../../components/SearchInput';
import { useKnowledgeManagement } from './useKnowledgeManagement';
import { KnowledgeCategoryManager } from './KnowledgeCategoryManager';

type Section = 'documents' | 'categories' | 'uploads' | 'trash';
type Draft = { title: string; categoryId: string; documentType: KnowledgeDocumentType };
type DraftErrors = Partial<Record<'title' | 'categoryId', string>>;
type UploadDraft = {
  title: string;
  category: string;
  documentType: KnowledgeDocumentType;
};
type RetryFocusIntent = { documentId: string; operationId: number; settled: boolean };

const NEW_CATEGORY_VALUE = '__new_category__';

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 KB';
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1_024))} KB`;
}

const QUEUE_STATE_LABELS: Record<KnowledgeUploadQueueItemState, string> = {
  planning: 'Preparing',
  paused: 'Paused',
  queued: 'Queued',
  uploading: 'Uploading',
  assembling: 'Processing',
  validating: 'Checking',
  extracting: 'Indexing',
  ready: 'Ready to publish',
  failed: 'Needs attention',
  cancelled: 'Cancelled',
  published: 'Published',
  'paused-network': 'Waiting for network',
  'source-required': 'Source file needed',
};

const QUEUE_ERROR_LABELS: Record<KnowledgeManagementErrorCode, string> = {
  offline: 'Network unavailable',
  unauthorized: 'Publisher sign-in required',
  'invalid-file': 'Invalid PDF',
  'upload-failed': 'Transfer failed',
  'validation-failed': 'PDF validation failed',
  'encrypted-pdf': 'Password-protected PDF',
  'too-large': 'PDF exceeds 50 MiB',
  'too-many-pages': 'PDF exceeds 1,000 pages',
  'extraction-timeout': 'Indexing timed out',
  'duplicate-file-name': 'Duplicate filename',
  'checksum-mismatch': 'File checksum mismatch',
  'insufficient-storage': 'Server storage is low',
  'source-required': 'Original PDF must be reselected',
  conflict: 'Upload changed on the server',
  'not-found': 'Upload no longer exists',
  'server-error': 'Server could not process this PDF',
};

function queueProgress(item: KnowledgeUploadQueueItemView): number {
  return Math.min(100, Math.round((item.acknowledgedBytes / item.byteSize) * 100));
}

function effectiveQueueState(
  item: KnowledgeUploadQueueItemView,
  uploads: KnowledgeManagementUploadView[],
): KnowledgeUploadQueueItemState {
  const serverState = uploads.find(({ id }) => id === item.uploadId)?.state;
  return serverState ?? item.state;
}

function selectedUploadCategory(categories: KnowledgeCategoryRecord[], selectedId: string): string {
  if (selectedId === NEW_CATEGORY_VALUE) return '';
  return categories.find(({ id }) => id === selectedId)?.name ?? '';
}

function matchesDocument(document: KnowledgeManagementDocumentView, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('en');
  return (
    !normalized ||
    `${document.displayTitle} ${document.fileName} ${document.category}`
      .toLocaleLowerCase('en')
      .includes(normalized)
  );
}

function EmptyPanel({ children }: Readonly<{ children: string }>) {
  return <div className="knowledge-management-empty">{children}</div>;
}

type WorkspaceProps = {
  onExit: () => void;
  onLibraryChanged?: () => void | Promise<void>;
};

export function KnowledgeManagementWorkspace({
  onExit,
  onLibraryChanged,
}: Readonly<WorkspaceProps>) {
  const management = useKnowledgeManagement(onLibraryChanged);
  const [section, setSection] = useState<Section>('documents');
  const sectionRef = useRef<Section>('documents');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>({
    title: '',
    categoryId: '',
    documentType: 'sop',
  });
  const [editErrors, setEditErrors] = useState<DraftErrors>({});
  const editTitleRef = useRef<HTMLInputElement>(null);
  const editCategoryRef = useRef<HTMLSelectElement>(null);
  const sectionContentRef = useRef<HTMLDivElement>(null);
  const sectionScrollPositionsRef = useRef<Record<Section, number>>({
    documents: 0,
    categories: 0,
    uploads: 0,
    trash: 0,
  });
  const focusSectionAfterChangeRef = useRef(false);
  const documentsHeadingRef = useRef<HTMLHeadingElement>(null);
  const retryFocusOperationRef = useRef(0);
  const [uploadDrafts, setUploadDrafts] = useState<Record<string, UploadDraft>>({});
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelBatchConfirmation, setCancelBatchConfirmation] = useState(false);
  const [discardUploadId, setDiscardUploadId] = useState<string | null>(null);
  const [retryFocusIntent, setRetryFocusIntent] = useState<RetryFocusIntent | null>(null);
  const restoreBatchCancelFocusRef = useRef(false);
  const discardFocusIntentRef = useRef<{
    uploadId: string;
    target: 'keep' | 'trigger' | 'after';
  } | null>(null);
  const snapshot = management.snapshot;
  const documents = useMemo(() => snapshot?.documents.items ?? [], [snapshot]);
  const trash = snapshot?.trash.items ?? [];
  const uploads = useMemo(
    () =>
      snapshot?.uploads.items.filter(
        ({ state }) => state !== 'published' && state !== 'cancelled',
      ) ?? [],
    [snapshot],
  );
  const queueItems = management.uploadQueue.items.filter(
    ({ state }) => state !== 'published' && state !== 'cancelled',
  );
  const uploadBatchId = management.uploadQueue.activeBatchId ?? queueItems[0]?.batchId ?? null;
  const uploadQueueHasActiveItems = queueItems.some(
    (item) =>
      !['ready', 'published', 'cancelled', 'failed'].includes(effectiveQueueState(item, uploads)),
  );
  const uploadQueueHasPausedItems = queueItems.some(({ state }) =>
    ['paused', 'paused-network'].includes(state),
  );
  const filteredDocuments = documents.filter((document) => matchesDocument(document, query));
  const searchableDocumentCount = documents.filter(
    ({ searchIndexState }) => searchIndexState === 'ready',
  ).length;
  const categories = snapshot?.categories ?? [];

  useEffect(() => {
    if (cancelBatchConfirmation || !restoreBatchCancelFocusRef.current) return;
    restoreBatchCancelFocusRef.current = false;
    document.querySelector<HTMLButtonElement>('[data-cancel-batch-trigger]')?.focus();
  }, [cancelBatchConfirmation]);

  useEffect(() => {
    const intent = discardFocusIntentRef.current;
    if (!intent) return;
    const buttons = [
      ...globalThis.document.querySelectorAll<HTMLButtonElement>('[data-discard-upload-id]'),
    ];
    let target: HTMLElement | null | undefined;
    if (intent.target === 'after') {
      target =
        buttons.find(
          (button) =>
            button.dataset.discardRole === 'trigger' &&
            button.dataset.discardUploadId !== intent.uploadId,
        ) ?? sectionContentRef.current;
    } else {
      target = buttons.find(
        (button) =>
          button.dataset.discardUploadId === intent.uploadId &&
          button.dataset.discardRole === intent.target,
      );
    }
    if (!target) return;
    discardFocusIntentRef.current = null;
    target.focus();
  }, [discardUploadId, uploads]);

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
  }, [retryFocusIntent]);

  useLayoutEffect(() => {
    sectionRef.current = section;
    const content = sectionContentRef.current;
    if (!content) return;
    content.scrollTop = sectionScrollPositionsRef.current[section];
    if (focusSectionAfterChangeRef.current) {
      focusSectionAfterChangeRef.current = false;
      content.focus();
    }
  }, [section]);

  const openSection = (next: Section, focus = false) => {
    const currentSection = sectionRef.current;
    const content = sectionContentRef.current;
    if (content) sectionScrollPositionsRef.current[currentSection] = content.scrollTop;
    if (next === currentSection) {
      if (focus) content?.focus();
      return;
    }
    sectionRef.current = next;
    focusSectionAfterChangeRef.current = focus;
    setSection(next);
  };

  const selectSection = (next: Section) => {
    openSection(next, true);
    setNotice(null);
    setCancelBatchConfirmation(false);
    setDiscardUploadId(null);
    discardFocusIntentRef.current = null;
  };

  const stagePdfs = async () => {
    const result = await management.stagePdfs();
    if (result.ok && result.uploads.length > 0) {
      openSection('uploads');
      setNotice(`${result.uploads.length} PDF${result.uploads.length === 1 ? '' : 's'} queued.`);
    }
  };

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
    openSection('uploads');
    setNotice(
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

  const publishUpload = async (upload: KnowledgeManagementUploadView) => {
    const draft = uploadDrafts[upload.id] ?? {
      title: upload.proposedTitle || upload.fileName.replace(/\.pdf$/i, ''),
      category: upload.proposedCategory || 'General',
      documentType: 'sop',
    };
    await management.publish(upload.id, draft.title, draft.category, draft.documentType);
  };

  const permanentlyDelete = async (document: KnowledgeManagementDocumentView) => {
    if (await management.deletePermanently(document.id, document.revision, password)) {
      setDeleteId(null);
      setPassword('');
    }
  };

  const closeDeleteConfirmation = useCallback((documentId: string) => {
    setDeleteId(null);
    setPassword('');
    queueMicrotask(() => {
      const trigger = [
        ...globalThis.document.querySelectorAll<HTMLButtonElement>('[data-delete-document-id]'),
      ].find((button) => button.dataset.deleteDocumentId === documentId);
      trigger?.focus();
    });
  }, []);

  useEffect(() => {
    if (!deleteId) return undefined;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const confirmation = [
        ...globalThis.document.querySelectorAll<HTMLFormElement>('[data-document-id]'),
      ].find((form) => form.dataset.documentId === deleteId);
      if (!confirmation) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDeleteConfirmation(deleteId);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [
        ...confirmation.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled])',
        ),
      ];
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    globalThis.document.addEventListener('keydown', handleKeyDown);
    return () => globalThis.document.removeEventListener('keydown', handleKeyDown);
  }, [closeDeleteConfirmation, deleteId]);

  const toggleDocumentSelection = (documentId: string, selected: boolean) => {
    setSelectedDocumentIds((current) =>
      selected ? [...current, documentId] : current.filter((id) => id !== documentId),
    );
  };

  const counts: Record<Section, number> = {
    documents: documents.length,
    categories: categories.length,
    uploads: new Set([
      ...uploads.map(({ id }) => id),
      ...queueItems.map((item) => item.uploadId ?? item.id),
    ]).size,
    trash: trash.length,
  };

  if (!management.canManage) {
    return (
      <div className="knowledge-management knowledge-management--access-lost">
        <header className="knowledge-management__header">
          <div>
            <span className="knowledge-tab__kicker">Protected publisher workspace</span>
            <h1>Manage Wiki</h1>
            <p>Stage, review, publish, and recover PDF guides shared across the Relay team.</p>
          </div>
          <div className="knowledge-management__header-actions">
            <TactileButton size="sm" onClick={onExit}>
              Return to library
            </TactileButton>
          </div>
        </header>
        <div className="knowledge-management__access-lost" role="alert">
          <span className="knowledge-tab__kicker">Protected access required</span>
          <h2>Publisher access ended</h2>
          <p>{management.error ?? 'Sign in again from Settings to continue managing the Wiki.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="knowledge-management">
      <header className="knowledge-management__header">
        <div>
          <span className="knowledge-tab__kicker">Protected publisher workspace</span>
          <h1>Manage Wiki</h1>
          <p>Stage, review, publish, and recover PDF guides shared across the Relay team.</p>
        </div>
        <div className="knowledge-management__header-actions">
          <span className="knowledge-management__role">
            SIGNED · {snapshot?.mode ?? 'CONNECTING'}
          </span>
          <TactileButton size="sm" onClick={onExit}>
            Return to library
          </TactileButton>
          <TactileButton
            size="sm"
            variant="primary"
            onClick={() => void stagePdfs()}
            loading={management.busy === 'upload'}
          >
            Add PDFs
          </TactileButton>
        </div>
      </header>

      {(management.error || notice) && (
        <div
          className={`knowledge-management__feedback ${management.error ? 'is-error' : ''}`}
          role={management.error ? 'alert' : 'status'}
        >
          <span>{management.error ?? notice}</span>
          <button
            type="button"
            onClick={() => {
              management.clearError();
              setNotice(null);
            }}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      )}

      {snapshot?.mode === 'recovery-required' && (
        <div className="knowledge-management__recovery" role="alert">
          The managed library needs server recovery before documents can be changed.
        </div>
      )}

      <div className="knowledge-management__workspace">
        <nav className="knowledge-management__rail" aria-label="Knowledge management">
          {(['documents', 'categories', 'uploads', 'trash'] as const).map((id) => (
            <button
              type="button"
              aria-current={section === id ? 'page' : undefined}
              aria-label={`${id[0]!.toUpperCase()}${id.slice(1)} ${counts[id]}`}
              className={section === id ? 'is-active' : ''}
              key={id}
              onClick={() => selectSection(id)}
            >
              <span>{id}</span>
              <strong>{counts[id]}</strong>
            </button>
          ))}
        </nav>

        <div
          ref={sectionContentRef}
          className="knowledge-management__content"
          tabIndex={-1}
          aria-label={`${section[0]!.toUpperCase()}${section.slice(1)} management section`}
        >
          {!snapshot && (
            <EmptyPanel>
              {management.loading ? 'Loading managed library…' : 'Managed library unavailable.'}
            </EmptyPanel>
          )}

          {snapshot && section === 'documents' && (
            <>
              <div className="knowledge-management-section-heading knowledge-management-section-heading--documents">
                <h2 ref={documentsHeadingRef} tabIndex={-1}>
                  Documents
                </h2>
                {searchableDocumentCount !== documents.length && (
                  <span className="knowledge-management__searchable-count" role="status">
                    {searchableDocumentCount} of {documents.length} searchable
                  </span>
                )}
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
                  <EmptyPanel>No documents match this view.</EmptyPanel>
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
                            onChange={(event) =>
                              toggleDocumentSelection(document.id, event.target.checked)
                            }
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
                          Display title
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
                          Category
                          <select
                            className="tactile-input"
                            ref={editCategoryRef}
                            aria-invalid={editErrors.categoryId ? true : undefined}
                            aria-describedby={
                              editErrors.categoryId
                                ? `knowledge-category-error-${document.id}`
                                : undefined
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
                          Document type
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
                {!query && snapshot.documents.nextCursor && (
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
          )}

          {snapshot && section === 'categories' && (
            <KnowledgeCategoryManager
              categories={categories}
              documents={documents}
              busy={management.busy}
              createCategory={management.createCategory}
              setCategoryName={management.setCategoryName}
              setCategoryOrder={management.setCategoryOrder}
              deleteCategory={management.deleteCategory}
            />
          )}

          {snapshot && section === 'uploads' && (
            <div className="knowledge-management-list">
              {queueItems.length > 0 && (
                <section className="knowledge-upload-queue" aria-labelledby="upload-queue-title">
                  <div className="knowledge-upload-queue__summary">
                    <div>
                      <span className="knowledge-tab__kicker">Transfer status</span>
                      <h2 id="upload-queue-title">Upload queue</h2>
                      <p>
                        {queueItems.length} PDF{queueItems.length === 1 ? '' : 's'} ·{' '}
                        {formatBytes(management.uploadQueue.acknowledgedBytes)} of{' '}
                        {formatBytes(management.uploadQueue.totalBytes)} transferred
                      </p>
                    </div>
                    <div className="knowledge-upload-queue__summary-actions">
                      {management.uploadQueue.restartRecovery && (
                        <span className="knowledge-upload-queue__recovery">
                          Restored after restart
                        </span>
                      )}
                      {uploadBatchId && uploadQueueHasActiveItems && (
                        <>
                          {uploadQueueHasPausedItems ? (
                            <TactileButton
                              size="sm"
                              onClick={() => void management.resumeUploadBatch(uploadBatchId)}
                            >
                              Resume all
                            </TactileButton>
                          ) : (
                            <TactileButton
                              size="sm"
                              onClick={() => void management.pauseUploadBatch(uploadBatchId)}
                            >
                              Pause all
                            </TactileButton>
                          )}
                          {cancelBatchConfirmation ? (
                            <>
                              <TactileButton
                                size="sm"
                                onClick={() => {
                                  restoreBatchCancelFocusRef.current = true;
                                  setCancelBatchConfirmation(false);
                                }}
                              >
                                Keep upload
                              </TactileButton>
                              <TactileButton
                                size="sm"
                                variant="danger"
                                onClick={() => {
                                  void management.cancelUploadBatch(uploadBatchId);
                                  setCancelBatchConfirmation(false);
                                }}
                              >
                                Confirm cancel
                              </TactileButton>
                            </>
                          ) : (
                            <TactileButton
                              size="sm"
                              variant="danger"
                              className="knowledge-management__danger-outline"
                              data-cancel-batch-trigger
                              onClick={() => setCancelBatchConfirmation(true)}
                            >
                              Cancel batch
                            </TactileButton>
                          )}
                        </>
                      )}
                    </div>
                    <progress
                      aria-label="Batch upload progress"
                      max={management.uploadQueue.totalBytes || 1}
                      value={management.uploadQueue.acknowledgedBytes}
                    />
                  </div>
                  <div className="knowledge-upload-queue__files">
                    {queueItems.map((item) => {
                      const id = item.uploadId ?? item.id;
                      const queuedUpload = uploads.find((upload) => upload.id === id);
                      const state = queuedUpload?.state ?? item.state;
                      const progress = queueProgress(item);
                      const requiresAction = Boolean(
                        queuedUpload?.duplicateDocumentId && state === 'ready',
                      );
                      return (
                        <article className="knowledge-upload-file" key={item.id}>
                          <div className="knowledge-upload-file__state">
                            <span
                              className={`knowledge-management-status is-${
                                requiresAction ? 'action-required' : state
                              }`}
                            >
                              {requiresAction ? 'Action required' : QUEUE_STATE_LABELS[state]}
                            </span>
                            <strong>{item.fileName}</strong>
                            <span className="knowledge-upload-file__size">
                              {formatBytes(item.byteSize)}
                            </span>
                            {item.safeError && (
                              <span className="knowledge-upload-file__issue">
                                {QUEUE_ERROR_LABELS[item.safeError]}
                              </span>
                            )}
                          </div>
                          <div className="knowledge-upload-file__progress">
                            <progress
                              aria-label={`${item.fileName} upload progress`}
                              max={item.byteSize}
                              value={item.acknowledgedBytes}
                            />
                            <span>{progress}%</span>
                          </div>
                          <div className="knowledge-upload-file__actions">
                            {['failed', 'paused-network'].includes(state) && (
                              <TactileButton
                                size="sm"
                                aria-label={`Retry ${item.fileName}`}
                                loading={management.busy === `retry:${id}`}
                                onClick={() => void management.retryUpload(id)}
                              >
                                Retry
                              </TactileButton>
                            )}
                            {state === 'source-required' && (
                              <TactileButton
                                size="sm"
                                aria-label={`Reselect ${item.fileName}`}
                                loading={management.busy === `reselect:${id}`}
                                onClick={() => void management.reselectUploadSource(id)}
                              >
                                Reselect PDF
                              </TactileButton>
                            )}
                            {!['ready', 'published', 'cancelled'].includes(state) && (
                              <TactileButton
                                size="sm"
                                variant="danger"
                                className="knowledge-management__danger-outline"
                                aria-label={`Cancel ${item.fileName}`}
                                loading={management.busy === `cancel:${id}`}
                                onClick={() => void management.cancelUpload(id)}
                              >
                                Cancel
                              </TactileButton>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
              {uploads.length > 0 && (
                <div className="knowledge-management-section-heading">
                  <span className="knowledge-tab__kicker">Review</span>
                  <h2>Upload review</h2>
                </div>
              )}
              {uploads.length === 0 && queueItems.length === 0 && (
                <EmptyPanel>No uploads queued or awaiting review. Add PDFs to begin.</EmptyPanel>
              )}
              {uploads.map((upload) => {
                const duplicate =
                  upload.replacementDocument ??
                  documents.find(({ id }) => id === upload.duplicateDocumentId);
                const proposedDraft = uploadDrafts[upload.id] ?? {
                  title: upload.proposedTitle || upload.fileName.replace(/\.pdf$/i, ''),
                  category: upload.proposedCategory || 'General',
                  documentType: 'sop',
                };
                const draft = duplicate
                  ? {
                      title: duplicate.displayTitle,
                      category: duplicate.category,
                      documentType: duplicate.documentType,
                    }
                  : proposedDraft;
                const selectedCategory = categories.find(
                  ({ id, normalizedName }) =>
                    id === duplicate?.categoryId ||
                    normalizedName === knowledgeCategoryKey(draft.category),
                );
                const hasReplacementIntent = Boolean(upload.duplicateDocumentId);
                const replacementUnavailable = hasReplacementIntent && !duplicate;
                const requiresAction = Boolean(hasReplacementIntent && upload.state === 'ready');
                let statusLabel: string = upload.state;
                if (requiresAction) {
                  statusLabel = replacementUnavailable
                    ? 'Replacement unavailable'
                    : 'Replacement ready';
                }
                return (
                  <article
                    className="knowledge-management-row knowledge-management-row--upload"
                    key={upload.id}
                  >
                    <div className="knowledge-management-row__identity">
                      <span
                        className={`knowledge-management-status is-${
                          requiresAction ? 'action-required' : upload.state
                        }`}
                      >
                        {statusLabel}
                      </span>
                      <h2>{upload.fileName}</h2>
                      <p>
                        {formatBytes(upload.byteSize)} · {upload.pageCount ?? '—'} pages ·{' '}
                        {upload.outlineCount} headings
                      </p>
                      {requiresAction && (
                        <p className="knowledge-management-row__duplicate" role="status">
                          <span
                            className="knowledge-management-row__duplicate-marker"
                            aria-hidden="true"
                          />
                          {duplicate
                            ? `This PDF will replace ${duplicate.displayTitle}.`
                            : 'The document selected for replacement is no longer available. Discard this upload and try again.'}
                        </p>
                      )}
                      {duplicate && (
                        <p className="knowledge-management-row__replacement-note">
                          Replacing it keeps its existing title, category, and document type.
                        </p>
                      )}
                    </div>
                    <div className="knowledge-management-row__editor">
                      <label>
                        Display title
                        <input
                          className="tactile-input"
                          value={draft.title}
                          disabled={hasReplacementIntent}
                          onChange={(event) =>
                            setUploadDrafts((current) => ({
                              ...current,
                              [upload.id]: { ...proposedDraft, title: event.target.value },
                            }))
                          }
                        />
                      </label>
                      <label>
                        Category
                        <select
                          className="tactile-input"
                          value={selectedCategory?.id ?? NEW_CATEGORY_VALUE}
                          disabled={hasReplacementIntent}
                          onChange={(event) => {
                            const category = selectedUploadCategory(categories, event.target.value);
                            setUploadDrafts((current) => ({
                              ...current,
                              [upload.id]: {
                                ...proposedDraft,
                                category,
                              },
                            }));
                          }}
                        >
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                          <option value={NEW_CATEGORY_VALUE}>Create new category…</option>
                        </select>
                      </label>
                      {!hasReplacementIntent && !selectedCategory && (
                        <label>
                          New category name
                          <input
                            className="tactile-input"
                            value={draft.category}
                            onChange={(event) =>
                              setUploadDrafts((current) => ({
                                ...current,
                                [upload.id]: {
                                  ...proposedDraft,
                                  category: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      )}
                      <label>
                        Document type
                        <select
                          className="tactile-input"
                          name={`knowledge-upload-document-type-${upload.id}`}
                          autoComplete="off"
                          value={draft.documentType}
                          disabled={hasReplacementIntent}
                          onChange={(event) =>
                            setUploadDrafts((current) => ({
                              ...current,
                              [upload.id]: {
                                ...proposedDraft,
                                documentType: event.target.value as KnowledgeDocumentType,
                              },
                            }))
                          }
                        >
                          <option value="sop">SOP Manual</option>
                          <option value="cheatsheet">Quick Guide</option>
                        </select>
                      </label>
                    </div>
                    <div className="knowledge-management-row__actions">
                      {duplicate && (
                        <TactileButton
                          size="sm"
                          variant="primary"
                          disabled={upload.state !== 'ready'}
                          loading={management.busy === `replace:${duplicate.id}`}
                          onClick={() =>
                            void management.replace(upload.id, duplicate.id, duplicate.revision)
                          }
                        >
                          Replace existing
                        </TactileButton>
                      )}
                      {!duplicate && !hasReplacementIntent && (
                        <TactileButton
                          size="sm"
                          variant="primary"
                          disabled={upload.state !== 'ready' || !draft.category.trim()}
                          loading={management.busy === `publish:${upload.id}`}
                          onClick={() => void publishUpload(upload)}
                        >
                          Publish
                        </TactileButton>
                      )}
                      {discardUploadId === upload.id ? (
                        <>
                          <TactileButton
                            size="sm"
                            data-discard-upload-id={upload.id}
                            data-discard-role="keep"
                            aria-label={`Keep ${upload.fileName}`}
                            onClick={() => {
                              discardFocusIntentRef.current = {
                                uploadId: upload.id,
                                target: 'trigger',
                              };
                              setDiscardUploadId(null);
                            }}
                          >
                            Keep upload
                          </TactileButton>
                          <TactileButton
                            size="sm"
                            variant="danger"
                            aria-label={`Confirm discard ${upload.fileName}`}
                            loading={management.busy === `cancel:${upload.id}`}
                            onClick={async () => {
                              const discarded = await management.cancelUpload(upload.id);
                              if (!discarded) return;
                              discardFocusIntentRef.current = {
                                uploadId: upload.id,
                                target: 'after',
                              };
                              setDiscardUploadId(null);
                              setUploadDrafts((current) => {
                                const next = { ...current };
                                delete next[upload.id];
                                return next;
                              });
                            }}
                          >
                            Discard upload
                          </TactileButton>
                        </>
                      ) : (
                        <TactileButton
                          size="sm"
                          variant="danger"
                          className="knowledge-management__danger-outline"
                          data-discard-upload-id={upload.id}
                          data-discard-role="trigger"
                          aria-label={`Discard ${upload.fileName}`}
                          onClick={() => {
                            discardFocusIntentRef.current = {
                              uploadId: upload.id,
                              target: 'keep',
                            };
                            setDiscardUploadId(upload.id);
                          }}
                        >
                          Discard upload
                        </TactileButton>
                      )}
                    </div>
                  </article>
                );
              })}
              {snapshot.uploads.nextCursor && (
                <div className="knowledge-management-more">
                  <TactileButton
                    size="sm"
                    loading={management.busy === 'more:uploads'}
                    onClick={() => void management.loadMore('uploads')}
                  >
                    Load more uploads
                  </TactileButton>
                </div>
              )}
            </div>
          )}

          {snapshot && section === 'trash' && (
            <div className="knowledge-management-list">
              {trash.length === 0 && (
                <EmptyPanel>Trash is empty. Nothing is deleted automatically.</EmptyPanel>
              )}
              {trash.map((document) => (
                <article className="knowledge-management-row" key={document.id}>
                  <div className="knowledge-management-row__identity">
                    <span className="knowledge-management-status is-trashed">trashed</span>
                    <h2>{document.displayTitle}</h2>
                    <p>
                      {document.fileName} · {document.category}
                    </p>
                  </div>
                  <div className="knowledge-management-row__meta">
                    <span>Trashed by {document.trashedByName}</span>
                    <span>{formatDate(document.trashedAt)}</span>
                  </div>
                  {deleteId === document.id ? (
                    <form
                      className="knowledge-management-row__delete"
                      role="dialog"
                      aria-modal="false"
                      aria-label={`Delete ${document.displayTitle}`}
                      data-document-id={document.id}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void permanentlyDelete(document);
                      }}
                    >
                      <label>
                        Confirm your password
                        <input
                          className="tactile-input"
                          type="password"
                          autoComplete="current-password"
                          autoFocus
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </label>
                      <TactileButton size="sm" onClick={() => closeDeleteConfirmation(document.id)}>
                        Cancel
                      </TactileButton>
                      <TactileButton type="submit" size="sm" variant="danger" disabled={!password}>
                        Delete permanently
                      </TactileButton>
                    </form>
                  ) : (
                    <div className="knowledge-management-row__actions">
                      <TactileButton
                        size="sm"
                        variant="primary"
                        onClick={() =>
                          void management.restore({
                            documentId: document.id,
                            expectedRevision: document.revision,
                          })
                        }
                      >
                        Restore
                      </TactileButton>
                      <TactileButton
                        size="sm"
                        variant="danger"
                        className="knowledge-management__danger-outline"
                        data-delete-document-id={document.id}
                        onClick={() => setDeleteId(document.id)}
                      >
                        Delete permanently
                      </TactileButton>
                    </div>
                  )}
                </article>
              ))}
              {snapshot.trash.nextCursor && (
                <div className="knowledge-management-more">
                  <TactileButton
                    size="sm"
                    loading={management.busy === 'more:trash'}
                    onClick={() => void management.loadMore('trash')}
                  >
                    Load more trash
                  </TactileButton>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
