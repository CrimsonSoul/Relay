import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { NoteEntry } from '@shared/ipc';
import { TagBadge } from './notes/TagBadge';
import { TagInput } from './notes/TagInput';

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
    if (isOpen) {
      setNote(existingNote?.note || '');
      setTags(existingNote?.tags || []);
      setTagInput('');
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
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

  if (!isOpen) return null;

  return createPortal(
    <button
      className="modal-overlay animate-fade-in"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      aria-label="Close modal backdrop"
      type="button"
    >
      <div
        className="modal-container animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-icon-wrapper">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>Notes Icon</title>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div id="notes-modal-title" className="modal-title-main">
              {entityType === 'contact' ? 'Contact Notes' : 'Server Notes'}
            </div>
            <div className="modal-title-sub">{entityName}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="modal-close-btn"
            aria-label="Close modal"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>Close</title>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="modal-content">
          {/* Note textarea */}
          <div style={{ marginBottom: '16px' }}>
            <label className="modal-label" htmlFor="note-textarea">
              Note
            </label>
            <textarea
              id="note-textarea"
              ref={textareaRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`Add a note about this ${entityType}...`}
              className="modal-textarea"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="modal-label" htmlFor="tag-input-field">
              Tags
            </label>

            {/* Tag list */}
            {tags.length > 0 && (
              <div className="tag-list">
                {tags.map((tag) => (
                  <TagBadge key={tag} tag={tag} onRemove={handleRemoveTag} />
                ))}
              </div>
            )}

            {/* Tag input */}
            <TagInput
              id="tag-input-field"
              value={tagInput}
              onChange={setTagInput}
              onAdd={handleAddTag}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button type="button" onClick={onClose} className="btn-cancel">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn-save">
            {saving ? 'Saving...' : 'Save Notes'}
          </button>
        </div>
      </div>
    </button>,
    document.body,
  );
};
