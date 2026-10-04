import React, { type ReactNode } from 'react';
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
  showNotesFilter?: boolean;
  showTagFilters?: boolean;
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
  showNotesFilter = true,
  showTagFilters = true,
}) => {
  const showTags = showTagFilters && availableTags.length > 0;

  return (
    <div className="list-filters" role="toolbar" aria-label="List filters">
      {showNotesFilter && (
        <FilterToggle
          pressed={hasNotesFilter}
          onClick={onToggleHasNotes}
          tooltip="Show items with notes"
        >
          Has Notes
        </FilterToggle>
      )}

      {extraFilters.map((filter) => (
        <FilterToggle
          key={filter.key}
          pressed={activeExtras.has(filter.key)}
          onClick={() => onToggleExtra(filter.key)}
          tooltip={`Show items where ${filter.label.toLowerCase()}`}
        >
          {filter.label}
        </FilterToggle>
      ))}

      {showTags && <span className="list-filters-divider" />}

      {showTags &&
        availableTags.map((tag) => (
          <FilterToggle
            key={tag}
            pressed={selectedTags.has(tag)}
            onClick={() => onToggleTag(tag)}
            tooltip={`Filter by #${tag}`}
          >
            #{tag}
          </FilterToggle>
        ))}

      {isAnyFilterActive && (
        <TactileButton
          size="sm"
          variant="ghost"
          onClick={onClearAll}
          tooltip="Clear Filters"
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

type FilterToggleProps = {
  pressed: boolean;
  onClick: () => void;
  tooltip: string;
  children: ReactNode;
};

/**
 * A filter is a toggle, not a command: its one state indicator is a leading box, empty when off
 * and filled with a check when on (shape, not colour alone), mirrored by `aria-pressed`. No
 * decorative icon sits beside it, so each chip carries exactly a box and a label.
 */
function FilterToggle({ pressed, onClick, tooltip, children }: Readonly<FilterToggleProps>) {
  return (
    <TactileButton
      size="sm"
      className="list-filter-toggle"
      active={pressed}
      aria-pressed={pressed}
      onClick={onClick}
      tooltip={tooltip}
      icon={<FilterCheckGlyph checked={pressed} />}
    >
      {children}
    </TactileButton>
  );
}

function FilterCheckGlyph({ checked }: Readonly<{ checked: boolean }>) {
  return (
    <svg
      className={checked ? 'list-filter-toggle__check is-checked' : 'list-filter-toggle__check'}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="list-filter-toggle__box" x="1.5" y="1.5" width="13" height="13" rx="1" />
      {checked && <polyline className="list-filter-toggle__mark" points="4.5 8.5 7 11 11.5 5.5" />}
    </svg>
  );
}
