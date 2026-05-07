import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { StandaloneNote, NoteColor } from '@shared/ipc';
import { NOTE_COLORS } from '../../hooks/useNotepad';
import { TactileButton } from '../../components/TactileButton';

interface NoteEditorProps {
  isOpen: boolean;
  note?: StandaloneNote; // undefined = creating new
  onSave: (data: { title: string; content: string; color: NoteColor; tags: string[] }) => void;
  onClose: () => void;
  onDelete?: () => void;
  variant?: 'modal' | 'panel';
}

function getEditorLabel(variant: 'modal' | 'panel', note?: StandaloneNote): string {
  if (variant === 'panel') {
    return note ? 'Edit note in detail panel' : 'Create note in detail panel';
  }

  return note ? 'Edit note' : 'New note';
}

export const NoteEditor: React.FC<NoteEditorProps> = ({
  isOpen,
  note,
  onSave,
  onClose,
  onDelete,
  variant = 'modal',
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [color, setColor] = useState<NoteColor>('amber');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset form when opening
  useEffect(() => {
    if (isOpen) {
      setTitle(note?.title || '');
      setContent(note?.content || '');
      setColor(note?.color || 'amber');
      setTags(note?.tags || []);
      setTagInput('');
      // Focus title on next frame
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [isOpen, note]);

  // Auto-grow textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(360, textareaRef.current.scrollHeight)}px`;
    }
  }, [content]);

  const handleSave = useCallback(() => {
    if (!title.trim() && !content.trim()) return;
    onSave({ title: title.trim(), content: content.trim(), color, tags });
  }, [title, content, color, tags, onSave]);

  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
        e.preventDefault();
        const newTag = tagInput.trim().toLowerCase();
        if (!tags.includes(newTag)) {
          setTags([...tags, newTag]);
        }
        setTagInput('');
      } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
        setTags(tags.slice(0, -1));
      }
    },
    [tagInput, tags],
  );

  const removeTag = useCallback(
    (tag: string) => {
      setTags(tags.filter((t) => t !== tag));
    },
    [tags],
  );

  // Handle Enter key in textarea for bullet continuation
  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const ta = textareaRef.current;
        if (!ta) return;
        const start = ta.selectionStart;
        const before = content.slice(0, start);
        const after = content.slice(ta.selectionEnd);
        const lineStart = before.lastIndexOf('\n') + 1;
        const currentLine = before.slice(lineStart);

        // If current line is an empty bullet, clear it
        if (/^- $/.test(currentLine)) {
          e.preventDefault();
          const newContent = content.slice(0, lineStart) + after;
          setContent(newContent);
          requestAnimationFrame(() => {
            ta.setSelectionRange(lineStart, lineStart);
          });
          return;
        }

        // If current line is a bullet with text, continue with new bullet
        if (/^- .+/.test(currentLine)) {
          e.preventDefault();
          const insertion = '\n- ';
          const newContent = before + insertion + after;
          setContent(newContent);
          requestAnimationFrame(() => {
            const pos = start + insertion.length;
            ta.setSelectionRange(pos, pos);
          });
          return;
        }
      }
    },
    [content],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    },
    [onClose, handleSave],
  );

  const handleContentKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      handleTextareaKeyDown(e);
      if (!e.isDefaultPrevented()) {
        handleKeyDown(e);
      }
    },
    [handleKeyDown, handleTextareaKeyDown],
  );

  const handleTagInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      handleTagKeyDown(e);
      if (!e.isDefaultPrevented()) {
        handleKeyDown(e);
      }
    },
    [handleKeyDown, handleTagKeyDown],
  );

  if (!isOpen) return null;

  const editorLabel = getEditorLabel(variant, note);

  const editorContent = (
    <div className={`note-editor-inner${variant === 'panel' ? ' note-editor-inner--panel' : ''}`}>
      <button
        type="button"
        className={`modal-close-generic note-editor-close hover-bg${
          variant === 'panel' ? ' note-editor-close--panel' : ''
        }`}
        onClick={onClose}
        aria-label="Close"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div className="note-editor-body">
        {/* Title */}
        <input
          ref={titleRef}
          className="note-editor-title"
          type="text"
          placeholder="Note title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={variant === 'panel' ? handleKeyDown : undefined}
          maxLength={200}
        />

        {/* Content */}
        <textarea
          ref={textareaRef}
          className="note-editor-content"
          placeholder="Write something..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={variant === 'panel' ? handleContentKeyDown : handleTextareaKeyDown}
        />

        {/* Tags */}
        <div className="note-editor-tags">
          <div className="note-editor-tag-list">
            {tags.map((tag) => (
              <span key={tag} className="note-editor-tag">
                {tag}
                <button
                  className="note-editor-tag-remove"
                  onClick={() => removeTag(tag)}
                  aria-label={`Remove tag ${tag}`}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </span>
            ))}
            <input
              className="note-editor-tag-input"
              type="text"
              placeholder={tags.length === 0 ? 'Add tags...' : ''}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={variant === 'panel' ? handleTagInputKeyDown : handleTagKeyDown}
            />
          </div>
        </div>

        {/* Color picker */}
        <div className="note-editor-color-picker">
          <span className="note-editor-color-label">Color</span>
          <div className="note-editor-color-swatches">
            {NOTE_COLORS.map((c) => (
              <button
                key={c.value}
                className={`note-editor-color-swatch${color === c.value ? ' is-selected' : ''}`}
                style={{ backgroundColor: c.hex }}
                onClick={() => setColor(c.value)}
                aria-label={c.label}
                title={c.label}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="note-editor-footer">
        <div className="note-editor-footer-left">
          {note && onDelete && (
            <TactileButton variant="danger" size="sm" onClick={onDelete}>
              Delete
            </TactileButton>
          )}
        </div>
        <div className="note-editor-footer-right">
          <TactileButton variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </TactileButton>
          <TactileButton
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!title.trim() && !content.trim()}
          >
            {note ? 'Save' : 'Create'}
          </TactileButton>
        </div>
      </div>

      {variant === 'modal' && (
        <div className="note-editor-hint">
          <kbd className="kbd-key">
            {navigator.userAgent?.includes('Mac') ? '\u2318' : 'Ctrl'}+{'\u23CE'}
          </kbd>{' '}
          Save
        </div>
      )}
    </div>
  );

  if (variant === 'panel') {
    return (
      <form
        className="note-editor-container note-editor-container--panel"
        aria-label={editorLabel}
        onSubmit={(event) => event.preventDefault()}
      >
        {editorContent}
      </form>
    );
  }

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="modal-overlay animate-fade-in" onMouseDown={onClose}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <dialog
        open
        className="note-editor-container animate-scale-in"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        aria-label={editorLabel}
      >
        {editorContent}
      </dialog>
    </div>,
    document.body,
  );
};
