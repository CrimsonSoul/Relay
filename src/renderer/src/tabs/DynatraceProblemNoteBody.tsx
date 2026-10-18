import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MAX_DYNATRACE_NOC_NOTE_LENGTH } from '@shared/dynatraceProblems';
import { getErrorMessage } from '@shared/types';

type Mode = 'view' | 'edit' | 'confirm-delete';

type DynatraceProblemNoteBodyProps = {
  /** The saved text, used to seed the editor. */
  text: string;
  /** The note as it normally reads (plain text or a ticket reference). */
  children: ReactNode;
  /** Names the note in button labels, e.g. "note by Ryan Bledsoe, Oct 16, 9:21 PM". */
  label: string;
  disabled: boolean;
  onEdit: (text: string) => Promise<void>;
  onDelete: () => Promise<void>;
  /** A deleted note leaves the list; the parent moves focus somewhere that still exists. */
  onDeleted?: () => void;
};

/**
 * A NOC note with Edit and Delete. Notes sync to Dynatrace and Infra Health, so both actions
 * say so and send the change there instead of only changing Relay.
 */
export function DynatraceProblemNoteBody({
  text,
  children,
  label,
  disabled,
  onEdit,
  onDelete,
  onDeleted,
}: Readonly<DynatraceProblemNoteBodyProps>) {
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  /** Which view-mode button gets focus back when an edit or delete confirmation closes. */
  const restoreFocus = useRef<'edit' | 'delete' | null>(null);

  useEffect(() => {
    if (mode === 'edit') editorRef.current?.focus();
    if (mode === 'confirm-delete') keepButtonRef.current?.focus();
    if (mode === 'view' && restoreFocus.current) {
      (restoreFocus.current === 'delete' ? deleteButtonRef : editButtonRef).current?.focus();
      restoreFocus.current = null;
    }
  }, [mode]);

  const close = (returnTo: 'edit' | 'delete' = 'edit') => {
    restoreFocus.current = returnTo;
    setError('');
    setMode('view');
  };

  const run = async (action: () => Promise<void>, after: () => void) => {
    setSaving(true);
    setError('');
    try {
      await action();
      after();
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  // Both confirmation buttons take Escape, so it cancels wherever focus sits in the confirmation.
  const cancelDeleteOnEscape = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Escape' || saving) return;
    event.preventDefault();
    event.stopPropagation();
    close('delete');
  };

  const save = () => {
    // Ctrl/Cmd+Enter reaches here too, so it honours the same gate as the Save button.
    if (saving || disabled) return;
    if (draft.trim() === text.trim()) return close();
    return run(
      () => onEdit(draft),
      () => close(),
    );
  };

  if (mode === 'edit') {
    return (
      <div className="dt-problem-note-composer dt-problem-note__editor">
        <textarea
          ref={editorRef}
          aria-label={`Edit ${label}`}
          value={draft}
          maxLength={MAX_DYNATRACE_NOC_NOTE_LENGTH}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void save();
            }
          }}
        />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="dt-problem-note__actions">
          <span className="dt-problem-note__hint">Updates the note in Dynatrace too</span>
          <button type="button" disabled={saving} onClick={() => close()}>
            Cancel
          </button>
          <button type="button" disabled={saving || disabled} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      {mode === 'confirm-delete' ? (
        <div // NOSONAR - labelled ARIA group; <fieldset> would add form-control semantics.
          className="dt-problem-note__actions"
          role="group"
          aria-label={`Confirm delete of ${label}`}
        >
          <span className="dt-problem-note__hint">
            Delete this note? It is removed in Dynatrace and Infra Health too.
          </span>
          <button
            ref={keepButtonRef}
            type="button"
            onKeyDown={cancelDeleteOnEscape}
            disabled={saving}
            onClick={() => close('delete')}
          >
            Keep
          </button>
          <button
            type="button"
            className="dt-problem-note__danger"
            onKeyDown={cancelDeleteOnEscape}
            aria-label={`Delete ${label}`}
            disabled={saving || disabled}
            onClick={() => void run(onDelete, () => onDeleted?.())}
          >
            {saving ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      ) : (
        <div className="dt-problem-note__actions">
          <button
            ref={editButtonRef}
            type="button"
            aria-label={`Edit ${label}`}
            disabled={disabled}
            onClick={() => {
              setDraft(text);
              setMode('edit');
            }}
          >
            Edit
          </button>
          <button
            ref={deleteButtonRef}
            type="button"
            aria-label={`Delete ${label}`}
            disabled={disabled}
            onClick={() => setMode('confirm-delete')}
          >
            Delete
          </button>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
