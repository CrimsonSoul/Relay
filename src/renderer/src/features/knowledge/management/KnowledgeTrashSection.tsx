import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeManagementDocumentView } from '@shared/knowledge';
import { TactileButton } from '../../../components/TactileButton';
import type { useKnowledgeManagement } from '../useKnowledgeManagement';

type KnowledgeManagementController = ReturnType<typeof useKnowledgeManagement>;

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

function EmptyPanel({ children }: Readonly<{ children: string }>) {
  return <div className="knowledge-management-empty">{children}</div>;
}

type KnowledgeTrashSectionProps = {
  active: boolean;
  management: KnowledgeManagementController;
  trash: KnowledgeManagementDocumentView[];
};

export function KnowledgeTrashSection({
  active,
  management,
  trash,
}: Readonly<KnowledgeTrashSectionProps>) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const snapshot = management.snapshot;

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

  if (!active || !snapshot) return null;

  return (
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
            <form // NOSONAR - this inline, non-modal confirmation must retain form submission semantics and must not enter the native dialog top layer.
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
                Confirm your password{' '}
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
  );
}
