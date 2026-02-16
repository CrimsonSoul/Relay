import React from 'react';
import { SearchInput } from './SearchInput';
import { TactileButton } from './TactileButton';

type SortOption = { value: string; label: string };

type ListToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  sortDirection: 'asc' | 'desc';
  onToggleSortDirection: () => void;
  sortKey?: string;
  sortOptions?: SortOption[];
  onSortKeyChange?: (key: string) => void;
  children?: React.ReactNode;
};

export const ListToolbar: React.FC<ListToolbarProps> = ({
  search,
  onSearchChange,
  placeholder = 'Search...',
  sortDirection,
  onToggleSortDirection,
  sortKey,
  sortOptions,
  onSortKeyChange,
  children,
}) => {
  return (
    <div className="list-toolbar">
      <SearchInput
        placeholder={placeholder}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {children}
      {sortOptions && sortOptions.length > 0 && onSortKeyChange ? (
        <div className="list-toolbar-sort">
          <span className="list-toolbar-sort-label">Sort By</span>
          <select
            className="list-toolbar-sort-select"
            value={sortKey}
            onChange={(e) => onSortKeyChange(e.target.value)}
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <TactileButton
            onClick={onToggleSortDirection}
            title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
            className="list-toolbar-sort-dir"
            icon={
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline
                  points={sortDirection === 'asc' ? '19 12 12 19 5 12' : '19 12 12 5 5 12'}
                />
              </svg>
            }
          />
        </div>
      ) : (
        <TactileButton
          onClick={onToggleSortDirection}
          title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
          className="list-toolbar-sort-dir"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points={sortDirection === 'asc' ? '19 12 12 19 5 12' : '19 12 12 5 5 12'} />
            </svg>
          }
        />
      )}
    </div>
  );
};
