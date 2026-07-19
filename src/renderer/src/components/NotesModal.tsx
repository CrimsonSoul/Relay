import React, { useState, useEffect, useRef } from 'react';
import type { NoteEntry } from '@shared/ipc';
import { TagBadge } from './notes/TagBadge';
import { TagInput } from './notes/TagInput';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | null = null;

    if (isOpen) {
      setNote(existingNote?.note || '');
      setTags(existingNote?.tags || []);
      setTagInput('');
      focusTimer = setTimeout(() => textareaRef.current?.focus(), 50);
    }

    return () => {
      if (focusTimer) {
        clearTimeout(focusTimer);
      }
    };
  }, [isOpen, existingNote]);

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
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
          <TactileButton type="button" onClick={onClose} disabled={saving}>
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
  );
};
