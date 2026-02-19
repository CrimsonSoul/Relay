import React from 'react';
import { TactileButton } from './TactileButton';
import type { FilterDef } from '../hooks/useListFilters';

type ListFiltersProps = {
  hasNotesFilter: boolean;
  selectedTags: Set<string>;
  availableTags: string[];
  activeExtras: Set<string>;
  extraFilters: FilterDef<unknown>[];
  isAnyFilterActive: boolean;
  onToggleHasNotes: () => void;
  onToggleTag: (tag: string) => void;
  onToggleExtra: (key: string) => void;
  onClearAll: () => void;
};

export const ListFilters: React.FC<ListFiltersProps> = ({
  hasNotesFilter,
  selectedTags,
  availableTags,
  activeExtras,
  extraFilters,
  isAnyFilterActive,
  onToggleHasNotes,
  onToggleTag,
  onToggleExtra,
  onClearAll,
}) => {
  const showTags = availableTags.length > 0;

  return (
    <div className="list-filters" role="toolbar" aria-label="List filters">
      <TactileButton
        size="sm"
        active={hasNotesFilter}
        aria-pressed={hasNotesFilter}
        onClick={onToggleHasNotes}
        icon={
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
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        }
      >
        Has Notes
      </TactileButton>

      {extraFilters.map((filter) => (
        <TactileButton
          key={filter.key}
          size="sm"
          active={activeExtras.has(filter.key)}
          aria-pressed={activeExtras.has(filter.key)}
          onClick={() => onToggleExtra(filter.key)}
          icon={filter.icon}
        >
          {filter.label}
        </TactileButton>
      ))}

      {showTags && <span className="list-filters-divider" />}

      {showTags &&
        availableTags.map((tag) => (
          <TactileButton
            key={tag}
            size="sm"
            active={selectedTags.has(tag)}
            aria-pressed={selectedTags.has(tag)}
            onClick={() => onToggleTag(tag)}
          >
            #{tag}
          </TactileButton>
        ))}

      {isAnyFilterActive && (
        <TactileButton
          size="sm"
          variant="ghost"
          onClick={onClearAll}
          icon={
            <svg
              width="12"
              height="12"
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
          }
        >
          Clear
        </TactileButton>
      )}
    </div>
  );
};
