import React from 'react';
import { SizeSegmentedControl } from '../../components/SizeSegmentedControl';
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

const FONT_SIZES = [
  { id: 'sm', label: 'Small', shortLabel: 'S' },
  { id: 'md', label: 'Medium', shortLabel: 'M' },
  { id: 'lg', label: 'Large', shortLabel: 'L' },
] as const;

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
        <SizeSegmentedControl<FontSize>
          ariaLabel="Notes text size"
          value={fontSize}
          onChange={onFontSizeChange}
          options={FONT_SIZES}
          titleSuffix="notes text"
          className="note-toolbar-fontsize"
        />

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
          NEW NOTE
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
