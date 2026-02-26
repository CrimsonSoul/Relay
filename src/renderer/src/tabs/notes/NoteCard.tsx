import React, { useState, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { StandaloneNote } from '@shared/ipc';
import { NoteContentRenderer } from './NoteContentRenderer';

interface NoteCardProps {
  note: StandaloneNote;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onTogglePin: () => void;
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
  ({ note, onClick, onContextMenu, onTogglePin }) => {
    const [copied, setCopied] = useState(false);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: note.id,
    });

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

    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
      zIndex: isDragging ? 10 : undefined,
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`note-card note-card--${note.color}${note.pinned ? ' note-card--pinned' : ''}`}
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
          <div
            className="note-card-drag-handle"
            role="presentation"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
              <circle cx="9" cy="5" r="2" />
              <circle cx="15" cy="5" r="2" />
              <circle cx="9" cy="12" r="2" />
              <circle cx="15" cy="12" r="2" />
              <circle cx="9" cy="19" r="2" />
              <circle cx="15" cy="19" r="2" />
            </svg>
          </div>
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
          {note.pinned && (
            <button
              className="note-card-pin is-pinned"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              aria-label="Unpin note"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M16 2L14.5 3.5L18 7L19.5 5.5C20.5 4.5 20.5 3 19.5 2C18.5 1 17 1 16 2Z" />
                <path d="M12.5 5.5L5 13L7 15L3 21L9 17L11 19L18.5 11.5L12.5 5.5Z" />
              </svg>
            </button>
          )}
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
