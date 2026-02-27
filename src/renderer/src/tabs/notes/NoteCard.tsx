import React, { useState, useCallback } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { StandaloneNote } from '@shared/ipc';
import { NoteContentRenderer } from './NoteContentRenderer';

interface NoteCardProps {
  note: StandaloneNote;
  isDragActive: boolean;
  isDropTarget: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

interface NoteCardOverlayProps {
  note: StandaloneNote;
  width?: number;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const NoteCard: React.FC<NoteCardProps> = React.memo(
  ({ note, isDragActive, isDropTarget, onClick, onContextMenu }) => {
    const [copied, setCopied] = useState(false);

    const {
      attributes,
      listeners,
      setNodeRef: setDragRef,
    } = useDraggable({
      id: note.id,
    });

    const { setNodeRef: setDropRef } = useDroppable({
      id: note.id,
      disabled: isDragActive,
    });

    // Merge drag + drop refs onto the same DOM node
    const setNodeRef = useCallback(
      (node: HTMLElement | null) => {
        setDragRef(node);
        setDropRef(node);
      },
      [setDragRef, setDropRef],
    );

    const handleCopy = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        const text = [note.title, note.content].filter(Boolean).join('\n\n');
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      },
      [note.title, note.content],
    );

    const classNames = [
      'note-card',
      `note-card--${note.color}`,
      'animate-card-entrance',
      isDragActive ? 'note-card--dragging' : '',
      isDropTarget ? 'note-card--drop-target' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        ref={setNodeRef}
        data-note-id={note.id}
        className={classNames}
        {...attributes}
        {...listeners}
        onClick={onClick}
        onContextMenu={onContextMenu}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        aria-label={`Note: ${note.title || 'Untitled'}`}
      >
        <div className="note-card-header">
          <div className="note-card-drag-handle" role="presentation">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
              <circle cx="9" cy="5" r="2" />
              <circle cx="15" cy="5" r="2" />
              <circle cx="9" cy="12" r="2" />
              <circle cx="15" cy="12" r="2" />
              <circle cx="9" cy="19" r="2" />
              <circle cx="15" cy="19" r="2" />
            </svg>
          </div>
          <div className="note-card-actions">
            <button
              className={`note-card-copy${copied ? ' is-copied' : ''}`}
              onClick={handleCopy}
              aria-label="Copy note contents"
              title={copied ? 'Copied!' : 'Copy'}
            >
              {copied ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="note-card-body">
          <h3 className="note-card-title">{note.title || 'Untitled'}</h3>
          {note.content && (
            <NoteContentRenderer content={note.content} className="note-card-content" />
          )}
        </div>

        <div className="note-card-footer">
          {note.tags.length > 0 && (
            <div className="note-card-tags">
              {note.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="note-card-tag">
                  {tag}
                </span>
              ))}
              {note.tags.length > 3 && (
                <span className="note-card-tag note-card-tag--more">+{note.tags.length - 3}</span>
              )}
            </div>
          )}
          <span className="note-card-time">{timeAgo(note.updatedAt)}</span>
        </div>
      </div>
    );
  },
);

NoteCard.displayName = 'NoteCard';

export const NoteCardOverlay: React.FC<NoteCardOverlayProps> = ({ note, width }) => {
  const style: React.CSSProperties | undefined = width ? { width } : undefined;

  return (
    <div style={style} className={`note-card note-card--${note.color} note-card--overlay`}>
      <div className="note-card-header">
        <div className="note-card-drag-handle" role="presentation" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
            <circle cx="9" cy="5" r="2" />
            <circle cx="15" cy="5" r="2" />
            <circle cx="9" cy="12" r="2" />
            <circle cx="15" cy="12" r="2" />
            <circle cx="9" cy="19" r="2" />
            <circle cx="15" cy="19" r="2" />
          </svg>
        </div>
      </div>

      <div className="note-card-body">
        <h3 className="note-card-title">{note.title || 'Untitled'}</h3>
        {note.content && (
          <NoteContentRenderer content={note.content} className="note-card-content" />
        )}
      </div>

      <div className="note-card-footer">
        {note.tags.length > 0 && (
          <div className="note-card-tags">
            {note.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="note-card-tag">
                {tag}
              </span>
            ))}
            {note.tags.length > 3 && (
              <span className="note-card-tag note-card-tag--more">+{note.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
