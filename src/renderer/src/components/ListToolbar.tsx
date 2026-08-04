import React, { useId } from 'react';
import { TactileButton } from './TactileButton';

type SortOption = { value: string; label: string };

type ListToolbarProps = {
  sortDirection: 'asc' | 'desc';
  onToggleSortDirection: () => void;
  sortKey?: string;
  sortOptions?: SortOption[];
  onSortKeyChange?: (key: string) => void;
  sortLabel?: string;
  disabled?: boolean;
  children?: React.ReactNode;
};

export const ListToolbar: React.FC<ListToolbarProps> = ({
  sortDirection,
  onToggleSortDirection,
  sortKey,
  sortOptions,
  onSortKeyChange,
  sortLabel = 'Sort by',
  disabled = false,
  children,
}) => {
  const sortId = useId();
  const directionAction = sortDirection === 'asc' ? 'Sort descending' : 'Sort ascending';

  return (
    <div className="list-toolbar list-toolbar--sort-only">
      {children}
      {sortOptions && sortOptions.length > 0 && onSortKeyChange ? (
        <div className="list-toolbar-sort">
          <label htmlFor={sortId} className="list-toolbar-sort-label">
            {sortLabel}
          </label>
          <select
            id={sortId}
            className="list-toolbar-sort-select"
            value={sortKey}
            onChange={(e) => onSortKeyChange(e.target.value)}
            disabled={disabled}
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <TactileButton
            onClick={onToggleSortDirection}
            aria-label={directionAction}
            title={directionAction}
            className="list-toolbar-sort-dir"
            disabled={disabled}
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
                aria-hidden="true"
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
          aria-label={directionAction}
          title={directionAction}
          className="list-toolbar-sort-dir"
          disabled={disabled}
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
              aria-hidden="true"
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
