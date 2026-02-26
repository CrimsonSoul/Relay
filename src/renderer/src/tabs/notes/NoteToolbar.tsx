import React from 'react';
import { TactileButton } from '../../components/TactileButton';
import type { NoteSort, SortKey, FontSize } from './types';

interface NoteToolbarProps {
  allTags: string[];
  activeTag: string | null;
  onTagClick: (tag: string | null) => void;
  sort: NoteSort;
  onSortChange: (sort: NoteSort) => void;
  fontSize: FontSize;
  onFontSizeChange: (size: FontSize) => void;
  onNewNote: () => void;
  noteCount: number;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'updatedAt', label: 'Updated' },
  { value: 'createdAt', label: 'Created' },
  { value: 'title', label: 'Title' },
  { value: 'color', label: 'Color' },
];

const FONT_SIZES: { value: FontSize; label: string }[] = [
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' },
];

export const NoteToolbar: React.FC<NoteToolbarProps> = ({
  allTags,
  activeTag,
  onTagClick,
  sort,
  onSortChange,
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

        {/* Sort */}
        <div className="note-toolbar-sort">
          <span className="note-toolbar-sort-label">SORT BY</span>
          <select
            className="note-toolbar-sort-select"
            value={sort.key}
            onChange={(e) => onSortChange({ ...sort, key: e.target.value as SortKey })}
            aria-label="Sort notes by"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            className="note-toolbar-sort-dir"
            onClick={() =>
              onSortChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
            }
            aria-label={sort.direction === 'asc' ? 'Sort descending' : 'Sort ascending'}
            title={sort.direction === 'asc' ? 'Ascending' : 'Descending'}
          >
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
              {sort.direction === 'asc' ? (
                <path d="M12 19V5M5 12l7-7 7 7" />
              ) : (
                <path d="M12 5v14M19 12l-7 7-7-7" />
              )}
            </svg>
          </button>
        </div>

        {/* New Note */}
        <TactileButton variant="primary" size="sm" onClick={onNewNote}>
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
