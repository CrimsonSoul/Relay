import React, { useState, useRef, useEffect } from 'react';
import { TactileButton } from '../../components/TactileButton';

export type SearchPopoverProps = {
  isSearching: boolean;
  loc: {
    manualInput: string;
    setManualInput: (val: string) => void;
    error: string | null;
  };
  handleManualSearch: () => void;
};

export const WeatherSearchPopover: React.FC<SearchPopoverProps> = ({
  isSearching,
  loc,
  handleManualSearch,
}) => {
  const [showSearchPopover, setShowSearchPopover] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showSearchPopover) {
      searchInputRef.current?.focus();
    }
  }, [showSearchPopover]);

  useEffect(() => {
    if (!showSearchPopover) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (searchPopoverRef.current && !searchPopoverRef.current.contains(e.target as Node)) {
        setShowSearchPopover(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSearchPopover]);

  const handleSearchSubmit = () => {
    if (loc.manualInput.trim()) {
      handleManualSearch();
      setShowSearchPopover(false);
    }
  };

  return (
    <div className="weather-search-popover-anchor" ref={searchPopoverRef}>
      <TactileButton
        onClick={() => setShowSearchPopover(!showSearchPopover)}
        variant={showSearchPopover ? 'primary' : 'ghost'}
        title="Search"
        aria-label="Search city"
        disabled={isSearching}
        icon={
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        }
      />
      {showSearchPopover && (
        <div className="animate-slide-down weather-search-popover">
          {loc.error && (
            <div className="weather-error-badge">
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
                <title>Error</title>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{loc.error}</span>
            </div>
          )}
          <input
            ref={searchInputRef}
            className="weather-search-popover-input"
            type="text"
            placeholder={isSearching ? 'Searching...' : 'Search city...'}
            value={loc.manualInput}
            onChange={(e) => loc.setManualInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearchSubmit();
              if (e.key === 'Escape') setShowSearchPopover(false);
            }}
            disabled={isSearching}
          />
        </div>
      )}
    </div>
  );
};
