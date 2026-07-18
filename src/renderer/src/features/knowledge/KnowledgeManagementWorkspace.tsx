import { useMemo, useState } from 'react';
import type {
  KnowledgeAuditAction,
  KnowledgeManagementErrorCode,
  KnowledgeManagementDocumentView,
  KnowledgeManagementUploadView,
  KnowledgeUploadQueueItemState,
  KnowledgeUploadQueueItemView,
} from '@shared/knowledge';
import { TactileButton } from '../../components/TactileButton';
import { useKnowledgeManagement } from './useKnowledgeManagement';

type Section = 'documents' | 'uploads' | 'trash' | 'audit';
type Draft = { title: string; category: string };

const ACTION_LABELS: Record<KnowledgeAuditAction, string> = {
  'upload-validated': 'Validated upload',
  published: 'Published document',
  replaced: 'Replaced PDF',
  'title-changed': 'Changed title',
  'category-changed': 'Moved document',
  'category-renamed': 'Renamed category',
  trashed: 'Moved to trash',
  restored: 'Restored document',
  deleted: 'Deleted permanently',
  'upload-expired': 'Expired staged upload',
  'migration-completed': 'Completed migration',
  'recovery-completed': 'Completed recovery',
};

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
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>({ title: '', category: '' });
  const [uploadDrafts, setUploadDrafts] = useState<Record<string, Draft>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [categoryFrom, setCategoryFrom] = useState('');
  const [categoryTo, setCategoryTo] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelBatchConfirmation, setCancelBatchConfirmation] = useState(false);
  const snapshot = management.snapshot;
  const documents = useMemo(() => snapshot?.documents.items ?? [], [snapshot]);
  const trash = snapshot?.trash.items ?? [];
  const uploads = snapshot?.uploads.items.filter(({ state }) => state !== 'published') ?? [];
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
  const categories = useMemo(
    () =>
      [...new Set(documents.map(({ category }) => category))].toSorted((left, right) =>
        left.localeCompare(right),
      ),
    [documents],
  );

  const selectSection = (next: Section) => {
    setSection(next);
    setNotice(null);
    setCancelBatchConfirmation(false);
    if (next === 'audit') void management.readAudit();
  };

  const stagePdfs = async () => {
    const result = await management.stagePdfs();
    if (result.ok && result.uploads.length > 0) {
      setSection('uploads');
      setNotice(`${result.uploads.length} PDF${result.uploads.length === 1 ? '' : 's'} queued.`);
    }
  };

  const beginEdit = (document: KnowledgeManagementDocumentView) => {
    setEditingId(document.id);
    setEditDraft({ title: document.displayTitle, category: document.category });
  };

  const saveEdit = async (document: KnowledgeManagementDocumentView) => {
    let revision = document.revision;
    if (editDraft.title.trim() !== document.displayTitle) {
      if (!(await management.setTitle(document.id, revision, editDraft.title))) return;
      revision += 1;
    }
    if (editDraft.category.trim() !== document.category) {
      if (!(await management.setCategory(document.id, revision, editDraft.category))) return;
    }
    setEditingId(null);
  };

  const replacePdf = async (document: KnowledgeManagementDocumentView) => {
    const result = await management.stagePdfs();
    if (!result.ok) return;
    setSection('uploads');
    setNotice(
      result.uploads.length === 1
        ? `Replacement for ${document.displayTitle} queued. Use Replace existing when it is ready.`
        : 'PDFs queued. Each duplicate filename can replace its existing document when ready.',
    );
  };

  const renameCategory = async () => {
    const revisions = Object.fromEntries(
      documents
        .filter(({ category }) => category === categoryFrom)
        .map(({ id, revision }) => [id, revision]),
    );
    if (await management.renameCategory(categoryFrom, categoryTo, revisions)) {
      setCategoryFrom('');
      setCategoryTo('');
    }
  };

  const publishUpload = async (upload: KnowledgeManagementUploadView) => {
    const draft = uploadDrafts[upload.id] ?? {
      title: upload.proposedTitle || upload.fileName.replace(/\.pdf$/i, ''),
      category: upload.proposedCategory || 'General',
    };
    await management.publish(upload.id, draft.title, draft.category);
  };

  const permanentlyDelete = async (document: KnowledgeManagementDocumentView) => {
    if (await management.deletePermanently(document.id, document.revision, password)) {
      setDeleteId(null);
      setPassword('');
    }
  };

  const counts: Record<Section, number> = {
    documents: documents.length,
    uploads: new Set([
      ...uploads.map(({ id }) => id),
      ...queueItems.map((item) => item.uploadId ?? item.id),
    ]).size,
    trash: trash.length,
    audit: management.auditEvents.length,
  };

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
          {(['documents', 'uploads', 'trash', 'audit'] as const).map((id) => (
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

        <div className="knowledge-management__content">
          {!snapshot && (
            <EmptyPanel>
              {management.loading ? 'Loading managed library…' : 'Managed library unavailable.'}
            </EmptyPanel>
          )}

          {snapshot && section === 'documents' && (
            <>
              <div className="knowledge-management__toolbar">
                <label className="knowledge-management__search">
                  <span>Search</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Title, PDF, or category"
                  />
                </label>
                {categories.length > 0 && (
                  <div className="knowledge-management__category-tool">
                    <select
                      aria-label="Category to rename"
                      value={categoryFrom}
                      onChange={(event) => setCategoryFrom(event.target.value)}
                    >
                      <option value="">Rename category…</option>
                      {categories.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                    <input
                      aria-label="New category name"
                      value={categoryTo}
                      onChange={(event) => setCategoryTo(event.target.value)}
                      placeholder="New name"
                    />
                    <TactileButton
                      size="sm"
                      disabled={!categoryFrom || !categoryTo.trim()}
                      onClick={() => void renameCategory()}
                    >
                      Rename
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
                      <span className="knowledge-management-row__type">
                        PDF · {document.pageCount} pages
                      </span>
                      <h2>{document.displayTitle}</h2>
                      <p>{document.fileName}</p>
                    </div>
                    {editingId === document.id ? (
                      <div className="knowledge-management-row__editor">
                        <label>
                          Display title
                          <input
                            value={editDraft.title}
                            onChange={(event) =>
                              setEditDraft((draft) => ({ ...draft, title: event.target.value }))
                            }
                          />
                        </label>
                        <label>
                          Category
                          <input
                            value={editDraft.category}
                            onChange={(event) =>
                              setEditDraft((draft) => ({ ...draft, category: event.target.value }))
                            }
                          />
                        </label>
                        <div>
                          <TactileButton size="sm" onClick={() => setEditingId(null)}>
                            Cancel
                          </TactileButton>
                          <TactileButton
                            size="sm"
                            variant="primary"
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
                            loading={management.busy === `replace:${document.id}`}
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
                          <TactileButton
                            size="sm"
                            variant="danger"
                            className={
                              cancelBatchConfirmation ? '' : 'knowledge-management__danger-outline'
                            }
                            onClick={() => {
                              if (!cancelBatchConfirmation) {
                                setCancelBatchConfirmation(true);
                                return;
                              }
                              void management.cancelUploadBatch(uploadBatchId);
                              setCancelBatchConfirmation(false);
                            }}
                          >
                            {cancelBatchConfirmation ? 'Confirm cancel' : 'Cancel batch'}
                          </TactileButton>
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
                      const state = effectiveQueueState(item, uploads);
                      const id = item.uploadId ?? item.id;
                      const progress = queueProgress(item);
                      return (
                        <article className="knowledge-upload-file" key={item.id}>
                          <div className="knowledge-upload-file__state">
                            <span className={`knowledge-management-status is-${state}`}>
                              {QUEUE_STATE_LABELS[state]}
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
                const draft = uploadDrafts[upload.id] ?? {
                  title: upload.proposedTitle || upload.fileName.replace(/\.pdf$/i, ''),
                  category: upload.proposedCategory || 'General',
                };
                const duplicate = documents.find(({ id }) => id === upload.duplicateDocumentId);
                return (
                  <article
                    className="knowledge-management-row knowledge-management-row--upload"
                    key={upload.id}
                  >
                    <div className="knowledge-management-row__identity">
                      <span className={`knowledge-management-status is-${upload.state}`}>
                        {upload.state}
                      </span>
                      <h2>{upload.fileName}</h2>
                      <p>
                        {formatBytes(upload.byteSize)} · {upload.pageCount ?? '—'} pages ·{' '}
                        {upload.outlineCount} headings
                      </p>
                    </div>
                    <div className="knowledge-management-row__editor">
                      <label>
                        Display title
                        <input
                          value={draft.title}
                          onChange={(event) =>
                            setUploadDrafts((current) => ({
                              ...current,
                              [upload.id]: { ...draft, title: event.target.value },
                            }))
                          }
                        />
                      </label>
                      <label>
                        Category
                        <input
                          value={draft.category}
                          onChange={(event) =>
                            setUploadDrafts((current) => ({
                              ...current,
                              [upload.id]: { ...draft, category: event.target.value },
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="knowledge-management-row__actions">
                      {upload.duplicateDocumentId && (
                        <span className="knowledge-management-row__warning">
                          Filename already exists
                        </span>
                      )}
                      {duplicate ? (
                        <TactileButton
                          size="sm"
                          variant="primary"
                          disabled={upload.state !== 'ready'}
                          loading={management.busy === `replace:${duplicate.id}`}
                          onClick={() =>
                            void management.replace(
                              upload.id,
                              duplicate.id,
                              duplicate.revision,
                              draft.title,
                              draft.category,
                            )
                          }
                        >
                          Replace existing
                        </TactileButton>
                      ) : (
                        <TactileButton
                          size="sm"
                          variant="primary"
                          disabled={upload.state !== 'ready' || Boolean(upload.duplicateDocumentId)}
                          loading={management.busy === `publish:${upload.id}`}
                          onClick={() => void publishUpload(upload)}
                        >
                          Publish
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
                      onSubmit={(event) => {
                        event.preventDefault();
                        void permanentlyDelete(document);
                      }}
                    >
                      <label>
                        Confirm your password
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </label>
                      <TactileButton
                        size="sm"
                        onClick={() => {
                          setDeleteId(null);
                          setPassword('');
                        }}
                      >
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

          {snapshot && section === 'audit' && (
            <div className="knowledge-management-list knowledge-management-list--audit">
              {management.auditEvents.length === 0 && (
                <EmptyPanel>No audit events in the retained history.</EmptyPanel>
              )}
              {management.auditEvents.map((event) => (
                <article className="knowledge-audit-row" key={event.id}>
                  <span className="knowledge-audit-row__mark" aria-hidden="true" />
                  <div>
                    <h2>{ACTION_LABELS[event.action]}</h2>
                    <p>{event.title || event.fileName || event.category || 'Wiki'}</p>
                  </div>
                  <div>
                    <strong>{event.actorDisplayName}</strong>
                    <span>{formatDate(event.occurredAt)}</span>
                  </div>
                </article>
              ))}
              {management.auditNextCursor && (
                <div className="knowledge-management-more">
                  <TactileButton
                    size="sm"
                    loading={management.busy === 'more:audit'}
                    onClick={() => void management.loadMoreAudit()}
                  >
                    Load more activity
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
