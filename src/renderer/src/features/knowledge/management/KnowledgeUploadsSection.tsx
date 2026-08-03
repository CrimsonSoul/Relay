import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  knowledgeCategoryKey,
  type KnowledgeCategoryRecord,
  type KnowledgeDocumentType,
  type KnowledgeManagementDocumentView,
  type KnowledgeManagementErrorCode,
  type KnowledgeManagementUploadView,
  type KnowledgeUploadQueueItemState,
  type KnowledgeUploadQueueItemView,
} from '@shared/knowledge';
import { TactileButton } from '../../../components/TactileButton';
import type { useKnowledgeManagement } from '../useKnowledgeManagement';

type KnowledgeManagementController = ReturnType<typeof useKnowledgeManagement>;
type UploadDraft = {
  title: string;
  category: string;
  documentType: KnowledgeDocumentType;
};

const NEW_CATEGORY_VALUE = '__new_category__';

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 KB';
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1_024))} KB`;
}

function queueProgress(item: KnowledgeUploadQueueItemView): number {
  return Math.min(100, Math.round((item.acknowledgedBytes / item.byteSize) * 100));
}

function effectiveQueueState(
  item: KnowledgeUploadQueueItemView,
  uploads: KnowledgeManagementUploadView[],
): KnowledgeUploadQueueItemState {
  const serverState = uploads.find(({ id }) => id === item.uploadId)?.state;
  if (
    ['paused', 'paused-network', 'source-required', 'failed'].includes(item.state) &&
    (!serverState || serverState === 'queued' || serverState === 'uploading')
  ) {
    return item.state;
  }
  return serverState ?? item.state;
}

function selectedUploadCategory(categories: KnowledgeCategoryRecord[], selectedId: string): string {
  if (selectedId === NEW_CATEGORY_VALUE) return '';
  return categories.find(({ id }) => id === selectedId)?.name ?? '';
}

function EmptyPanel({ children }: Readonly<{ children: string }>) {
  return <div className="knowledge-management-empty">{children}</div>;
}

type KnowledgeUploadsSectionProps = {
  active: boolean;
  management: KnowledgeManagementController;
  documents: KnowledgeManagementDocumentView[];
  categories: KnowledgeCategoryRecord[];
  sectionContentRef: RefObject<HTMLDivElement | null>;
};

export function KnowledgeUploadsSection({
  active,
  management,
  documents,
  categories,
  sectionContentRef,
}: Readonly<KnowledgeUploadsSectionProps>) {
  const [uploadDrafts, setUploadDrafts] = useState<Record<string, UploadDraft>>({});
  const [cancelBatchConfirmation, setCancelBatchConfirmation] = useState(false);
  const [discardUploadId, setDiscardUploadId] = useState<string | null>(null);
  const restoreBatchCancelFocusRef = useRef(false);
  const discardFocusIntentRef = useRef<{
    uploadId: string;
    target: 'keep' | 'trigger' | 'after';
  } | null>(null);
  const snapshot = management.snapshot;
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
      item.cancelPending ||
      !['ready', 'published', 'cancelled', 'failed'].includes(effectiveQueueState(item, uploads)),
  );
  const uploadQueueHasPendingCancellation = queueItems.some(({ cancelPending }) => cancelPending);
  const uploadQueueHasPausedItems = queueItems.some(
    ({ state, cancelPending }) => !cancelPending && ['paused', 'paused-network'].includes(state),
  );

  useEffect(() => {
    if (active) return;
    setCancelBatchConfirmation(false);
    setDiscardUploadId(null);
    discardFocusIntentRef.current = null;
  }, [active]);

  useEffect(() => {
    if (cancelBatchConfirmation || !restoreBatchCancelFocusRef.current) return;
    restoreBatchCancelFocusRef.current = false;
    globalThis.document.querySelector<HTMLButtonElement>('[data-cancel-batch-trigger]')?.focus();
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
  }, [discardUploadId, sectionContentRef, uploads]);

  const publishUpload = async (upload: KnowledgeManagementUploadView) => {
    const draft = uploadDrafts[upload.id] ?? {
      title: upload.proposedTitle || upload.fileName.replace(/\.pdf$/i, ''),
      category: upload.proposedCategory || 'General',
      documentType: 'sop',
    };
    await management.publish(upload.id, draft.title, draft.category, draft.documentType);
  };

  if (!active || !snapshot) return null;

  return (
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
                <span className="knowledge-upload-queue__recovery">Restored after restart</span>
              )}
              {uploadBatchId && uploadQueueHasActiveItems && !uploadQueueHasPendingCancellation && (
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
              const state = effectiveQueueState(item, uploads);
              const progress = queueProgress(item);
              const requiresAction = Boolean(
                !item.cancelPending && queuedUpload?.duplicateDocumentId && state === 'ready',
              );
              let stateModifier: string = state;
              let stateLabel = QUEUE_STATE_LABELS[state];
              if (item.cancelPending) {
                stateModifier = 'cancelling';
                stateLabel = 'Cancelling';
              } else if (requiresAction) {
                stateModifier = 'action-required';
                stateLabel = 'Action required';
              }
              return (
                <article className="knowledge-upload-file" key={item.id}>
                  <div className="knowledge-upload-file__state">
                    <span className={`knowledge-management-status is-${stateModifier}`}>
                      {stateLabel}
                    </span>
                    <strong>{item.fileName}</strong>
                    <span className="knowledge-upload-file__size">
                      {formatBytes(item.byteSize)}
                    </span>
                    {item.cancelPending && (
                      <span className="knowledge-upload-file__issue">
                        Waiting for server confirmation
                      </span>
                    )}
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
                    {!item.cancelPending && ['failed', 'paused-network'].includes(state) && (
                      <TactileButton
                        size="sm"
                        aria-label={`Retry ${item.fileName}`}
                        loading={management.busy === `retry:${id}`}
                        onClick={() => void management.retryUpload(id)}
                      >
                        Retry
                      </TactileButton>
                    )}
                    {!item.cancelPending && state === 'source-required' && (
                      <TactileButton
                        size="sm"
                        aria-label={`Reselect ${item.fileName}`}
                        loading={management.busy === `reselect:${id}`}
                        onClick={() => void management.reselectUploadSource(id)}
                      >
                        Reselect PDF
                      </TactileButton>
                    )}
                    {!item.cancelPending &&
                      !['ready', 'published', 'cancelled'].includes(state) && (
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
            id === duplicate?.categoryId || normalizedName === knowledgeCategoryKey(draft.category),
        );
        const hasReplacementIntent = Boolean(upload.duplicateDocumentId);
        const replacementUnavailable = hasReplacementIntent && !duplicate;
        const cancellationPending = queueItems.some(
          (item) => item.uploadId === upload.id && item.cancelPending,
        );
        const requiresAction = Boolean(
          !cancellationPending && hasReplacementIntent && upload.state === 'ready',
        );
        let statusLabel: string = upload.state;
        let statusModifier: string = upload.state;
        if (cancellationPending) {
          statusLabel = 'Cancelling';
          statusModifier = 'cancelling';
        } else if (requiresAction) {
          statusModifier = 'action-required';
          statusLabel = replacementUnavailable ? 'Replacement unavailable' : 'Replacement ready';
        }
        return (
          <article
            className="knowledge-management-row knowledge-management-row--upload"
            key={upload.id}
          >
            <div className="knowledge-management-row__identity">
              <span className={`knowledge-management-status is-${statusModifier}`}>
                {statusLabel}
              </span>
              <h2>{upload.fileName}</h2>
              <p>
                {formatBytes(upload.byteSize)} · {upload.pageCount ?? '—'} pages ·{' '}
                {upload.outlineCount} headings
              </p>
              {requiresAction && (
                <p className="knowledge-management-row__duplicate" role="status">
                  <span className="knowledge-management-row__duplicate-marker" aria-hidden="true" />
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
                Display title{' '}
                <input
                  className="tactile-input"
                  value={draft.title}
                  disabled={cancellationPending || hasReplacementIntent}
                  onChange={(event) =>
                    setUploadDrafts((current) => ({
                      ...current,
                      [upload.id]: { ...proposedDraft, title: event.target.value },
                    }))
                  }
                />
              </label>
              <label>
                Category{' '}
                <select
                  className="tactile-input"
                  value={selectedCategory?.id ?? NEW_CATEGORY_VALUE}
                  disabled={cancellationPending || hasReplacementIntent}
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
                  New category name{' '}
                  <input
                    className="tactile-input"
                    value={draft.category}
                    disabled={cancellationPending}
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
                Document type{' '}
                <select
                  className="tactile-input"
                  name={`knowledge-upload-document-type-${upload.id}`}
                  autoComplete="off"
                  value={draft.documentType}
                  disabled={cancellationPending || hasReplacementIntent}
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
                  disabled={cancellationPending || upload.state !== 'ready'}
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
                  disabled={
                    cancellationPending || upload.state !== 'ready' || !draft.category.trim()
                  }
                  loading={management.busy === `publish:${upload.id}`}
                  onClick={() => void publishUpload(upload)}
                >
                  Publish
                </TactileButton>
              )}
              {discardUploadId === upload.id && !cancellationPending ? (
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
                  disabled={cancellationPending}
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
  );
}
