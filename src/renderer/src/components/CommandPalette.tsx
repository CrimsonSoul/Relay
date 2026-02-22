import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Contact, Server, BridgeGroup } from '@shared/ipc';
import { useCommandSearch, SearchResult } from '../hooks/useCommandSearch';
import { ContactIcon, GroupIcon, ServerIcon, ActionIcon } from './command-palette/CommandIcons';

type CommandPaletteProps = {
  isOpen: boolean;
  onClose: () => void;
  contacts: Contact[];
  servers: Server[];
  groups: BridgeGroup[];
  onAddContactToBridge: (email: string) => void;
  onToggleGroup: (groupId: string) => void;
  onNavigateToTab: (tab: string) => void;
  onOpenAddContact: (email?: string) => void;
};

const RenderIcon: React.FC<{ result: SearchResult }> = ({ result }) => {
  switch (result.type) {
    case 'contact':
      return <ContactIcon name={result.title} />;
    case 'group':
      return <GroupIcon />;
    case 'server':
      return <ServerIcon />;
    case 'action':
      return <ActionIcon type={result.iconType} />;
    default:
      return null;
  }
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  contacts,
  servers,
  groups,
  onAddContactToBridge,
  onToggleGroup,
  onNavigateToTab,
  onOpenAddContact,
}) => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useCommandSearch(debouncedQuery, contacts, servers, groups);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [debouncedQuery]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selected = resultsRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Handle result selection (Moved before handleKeyDown to fix circular dependency)
  const handleSelect = useCallback(
    (result: SearchResult) => {
      switch (result.type) {
        case 'contact': {
          const contact = result.data as Contact;
          onAddContactToBridge(contact.email);
          break;
        }
        case 'group': {
          const group = result.data as BridgeGroup;
          onToggleGroup(group.id);
          break;
        }
        case 'server': {
          onNavigateToTab('Servers');
          break;
        }
        case 'action': {
          const action = result.data as { action: string; tab?: string; value?: string };
          if (action.action === 'navigate' && action.tab) {
            onNavigateToTab(action.tab);
          } else if (action.action === 'create-contact') {
            onOpenAddContact(action.value);
          } else if (action.action === 'add-manual' && action.value) {
            onAddContactToBridge(action.value);
          }
          break;
        }
      }
      onClose();
    },
    [onAddContactToBridge, onToggleGroup, onNavigateToTab, onClose, onOpenAddContact],
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, selectedIndex, onClose, handleSelect],
  );

  if (!isOpen) return null;

  return createPortal(
    <div className="command-palette-overlay animate-fade-in">
      <button
        type="button"
        className="overlay-hitbox"
        aria-label="Close command palette backdrop"
        onClick={onClose}
      />
      <dialog
        open
        className="command-palette-container animate-slide-down"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Search Input */}
        <div className="command-palette-search-wrapper">
          <div className="command-palette-input-container">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="command-palette-search-icon"
            >
              <title>Search Icon</title>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search contacts, groups..."
              className="command-palette-input"
              aria-label="Search command palette"
            />
            <div className="command-palette-esc-badge">ESC</div>
          </div>
        </div>

        {/* Results */}
        <ul ref={resultsRef} className="command-palette-results">
          {results.length === 0 ? (
            <li className="command-palette-empty">No results found</li>
          ) : (
            results.map((result, index) => (
              <li
                key={result.id}
                data-index={index}
                id={`command-result-${index}`}
                className={`command-palette-result-item ${index === selectedIndex ? 'is-selected' : ''}`}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <button
                  type="button"
                  onClick={() => handleSelect(result)}
                  className="command-palette-result-button"
                >
                  <div className="command-palette-result-icon">
                    <RenderIcon result={result} />
                  </div>
                  <div className="command-palette-result-info">
                    <div className="command-palette-result-title">{result.title}</div>
                    {result.subtitle && (
                      <div className="command-palette-result-subtitle">{result.subtitle}</div>
                    )}
                  </div>
                  <div className="command-palette-result-type">{result.type}</div>
                </button>
              </li>
            ))
          )}
        </ul>

        {/* Footer */}
        <div className="command-palette-footer">
          <span>
            <kbd className="kbd-key">↑↓</kbd> Navigate
          </span>
          <span>
            <kbd className="kbd-key">↵</kbd> Select
          </span>
          <span>
            <kbd className="kbd-key">esc</kbd> Close
          </span>
        </div>
      </dialog>
    </div>,
    document.body,
  );
};
