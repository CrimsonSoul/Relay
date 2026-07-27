import React, { useState, useEffect, useRef } from 'react';
import type { NoteEntry } from '@shared/ipc';
import { TagBadge } from './notes/TagBadge';
import { TagInput } from './notes/TagInput';
import { ConfirmModal } from './ConfirmModal';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';

function sameTags(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

type NotesModalProps = {
  isOpen: boolean;
  onClose: () => void;
  entityType: 'contact' | 'server';
  entityId: string;
  entityName: string;
  existingNote?: NoteEntry;
  onSave: (note: string, tags: string[]) => Promise<boolean | undefined>;
};

export const NotesModal: React.FC<NotesModalProps> = ({
  isOpen,
  onClose,
  entityType,
  entityId,
  entityName,
  existingNote,
  onSave,
}) => {
  const [note, setNote] = useState(existingNote?.note || '');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(existingNote?.tags || []);
  const [saving, setSaving] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Which entity the draft was seeded from, or null while closed.
  const seededEntityRef = useRef<string | null>(null);
  // Mirrors the seeded values so "is this draft dirty?" never reads stale state.
  // Seeded from the same source as the state above, because a modal that mounts
  // already open settles without the seeding effect re-rendering anything.
  const baselineRef = useRef<{ note: string; tags: string[] }>({
    note: existingNote?.note || '',
    tags: existingNote?.tags || [],
  });

  // Seed the draft once per open, keyed by the entity rather than by the
  // `existingNote` object. `useNotes` rebuilds every NoteEntry from scratch on
  // any notes realtime event, so keying on the object meant a teammate editing
  // an unrelated note wiped whatever this operator was mid-sentence on.
  useEffect(() => {
    if (!isOpen) {
      seededEntityRef.current = null;
      return;
    }
    if (seededEntityRef.current === entityId) return;

    seededEntityRef.current = entityId;
    baselineRef.current = { note: existingNote?.note || '', tags: existingNote?.tags || [] };
    setNote(baselineRef.current.note);
    setTags(baselineRef.current.tags);
    setTagInput('');
  }, [isOpen, entityId, existingNote]);

  useEffect(() => {
    if (!isOpen) return;
    const focusTimer = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, [isOpen]);

  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const success = await onSave(note.trim(), tags);
      if (success) {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const isDirty =
    note !== baselineRef.current.note ||
    tagInput.trim().length > 0 ||
    !sameTags(tags, baselineRef.current.tags);

  // Escape, the backdrop and Cancel all discard the draft outright. Confirm
  // first when there is something to lose — a note is typed, not re-derivable.
  const handleRequestClose = () => {
    if (isDirty) {
      setDiscardPrompt(true);
      return;
    }
    onClose();
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleRequestClose}
        title={entityType === 'contact' ? 'Contact Notes' : 'Server Notes'}
        subtitle={entityName}
        variant="standard"
        bodyClassName="notes-modal-body"
        dismissible={!saving}
        dialogProps={{
          'data-entity-id': entityId,
        }}
        footer={
          <>
            <TactileButton type="button" onClick={handleRequestClose} disabled={saving}>
              Cancel
            </TactileButton>
            <TactileButton type="button" onClick={handleSave} loading={saving} variant="primary">
              {saving ? 'Saving...' : 'Save Notes'}
            </TactileButton>
          </>
        }
      >
        <div className="notes-textarea-wrapper">
          <label className="modal-label" htmlFor="note-textarea">
            Note
          </label>
          <textarea
            id="note-textarea"
            ref={textareaRef}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={`Add a note about this ${entityType}...`}
            className="modal-textarea"
          />
        </div>
        <div className="notes-tags">
          <label className="modal-label" htmlFor="tag-input-field">
            Tags
          </label>
          {tags.length > 0 && (
            <div className="tag-list">
              {tags.map((tag) => (
                <TagBadge key={tag} tag={tag} onRemove={handleRemoveTag} />
              ))}
            </div>
          )}
          <TagInput
            id="tag-input-field"
            value={tagInput}
            onChange={setTagInput}
            onAdd={handleAddTag}
            onKeyDown={handleKeyDown}
          />
        </div>
      </Modal>
      <ConfirmModal
        isOpen={discardPrompt}
        onClose={() => setDiscardPrompt(false)}
        onConfirm={onClose}
        title="Discard note changes?"
        message="This note has unsaved edits. Closing now discards them."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        isDanger
      />
    </>
  );
};
