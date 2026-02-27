import React from 'react';
import { TactileButton } from '../../components/TactileButton';
import type { FontSize } from './types';

interface NoteToolbarProps {
  allTags: string[];
  activeTag: string | null;
  onTagClick: (tag: string | null) => void;
  fontSize: FontSize;
  onFontSizeChange: (size: FontSize) => void;
  onNewNote: () => void;
  noteCount: number;
}

const FONT_SIZES: { value: FontSize; label: string }[] = [
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' },
];

export const NoteToolbar: React.FC<NoteToolbarProps> = ({
  allTags,
  activeTag,
  onTagClick,
  fontSize,
  onFontSizeChange,
  onNewNote,
  noteCount,
}) => {
  return (
    <div className="note-toolbar">
      <div className="note-toolbar-row">
        {/* Font size toggle */}
        <div className="note-toolbar-fontsize">
          <span className="note-toolbar-fontsize-label">Aa</span>
          <div className="note-toolbar-fontsize-toggle">
            {FONT_SIZES.map((fs) => (
              <button
                key={fs.value}
                className={`note-toolbar-fontsize-btn${fontSize === fs.value ? ' is-active' : ''}`}
                onClick={() => onFontSizeChange(fs.value)}
                aria-label={`Font size ${fs.label}`}
                title={`Font size ${fs.label}`}
              >
                {fs.label}
              </button>
            ))}
          </div>
        </div>

        {/* New Note */}
        <TactileButton
          variant="primary"
          size="sm"
          onClick={onNewNote}
          className="note-toolbar-new-btn"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Note
        </TactileButton>
      </div>

      {/* Tag filter pills */}
      {allTags.length > 0 && (
        <div className="note-toolbar-tags">
          <button
            className={`note-toolbar-tag-pill${activeTag === null ? ' is-active' : ''}`}
            onClick={() => onTagClick(null)}
          >
            All ({noteCount})
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              className={`note-toolbar-tag-pill${activeTag === tag ? ' is-active' : ''}`}
              onClick={() => onTagClick(activeTag === tag ? null : tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
