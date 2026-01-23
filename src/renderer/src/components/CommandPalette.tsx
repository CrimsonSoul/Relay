import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Contact, Server, BridgeGroup } from "@shared/ipc";
import { useCommandSearch, SearchResult } from "../hooks/useCommandSearch";
import { ContactIcon, GroupIcon, ServerIcon, ActionIcon } from "./command-palette/CommandIcons";

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
    case "contact":
      return <ContactIcon name={result.title} />;
    case "group":
      return <GroupIcon />;
    case "server":
      return <ServerIcon />;
    case "action":
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
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useCommandSearch(debouncedQuery, contacts, servers, groups);

  // Focus input when opened
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selected = resultsRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      selected?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, selectedIndex, onClose, handleSelect]
  );

  // Handle result selection
  const handleSelect = useCallback(
    (result: SearchResult) => {
      switch (result.type) {
        case "contact": {
          const contact = result.data as Contact;
          onAddContactToBridge(contact.email);
          break;
        }
        case "group": {
          const group = result.data as BridgeGroup;
          onToggleGroup(group.id);
          break;
        }
        case "server": {
          onNavigateToTab("Servers");
          break;
        }
        case "action": {
          const action = result.data as { action: string; tab?: string; value?: string };
          if (action.action === "navigate" && action.tab) {
            onNavigateToTab(action.tab);
          } else if (action.action === "create-contact") {
            // If value is provided (from email search), pass it to the handler if possible, 
            // but currently onOpenAddContact doesn't take args. 
            // The user only asked for the trigger. The Modal will open empty or we can improve this later.
            // Wait, I should update the prop to accept an optional email.
            onOpenAddContact(action.value);
          } else if (action.action === "add-manual" && action.value) {
            onAddContactToBridge(action.value);
          }
          break;
        }
      }
      onClose();
    },
    [onAddContactToBridge, onToggleGroup, onNavigateToTab, onClose, onOpenAddContact]
  );

  if (!isOpen) return null;

  return createPortal(
    <div
      className="animate-fade-in"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        justifyContent: "center",
        paddingTop: "15vh",
        zIndex: 10002,
      }}
      onClick={onClose}
    >
      <div
        className="animate-slide-down"
        style={{
          width: "100%",
          maxWidth: "560px",
          background: "var(--color-bg-surface-opaque)",
          borderRadius: "12px",
          border: "1px solid var(--color-border-medium)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          height: "fit-content",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div style={{ padding: "16px", borderBottom: "1px solid var(--color-border-subtle)" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ position: "absolute", left: "12px", pointerEvents: "none" }}
            >
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
              style={{
                width: "100%",
                padding: "12px 12px 12px 44px",
                fontSize: "16px",
                background: "rgba(0, 0, 0, 0.5)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "8px",
                color: "var(--color-text-primary)",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
            <div
              style={{
                position: "absolute",
                right: "12px",
                fontSize: "11px",
                color: "var(--color-text-tertiary)",
                background: "var(--color-bg-app)",
                padding: "2px 6px",
                borderRadius: "4px",
                border: "1px solid var(--color-border-subtle)",
              }}
            >
              ESC
            </div>
          </div>
        </div>

        {/* Results */}
        <div
          ref={resultsRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px",
          }}
        >
          {results.length === 0 ? (
            <div
              style={{
                padding: "32px",
                textAlign: "center",
                color: "var(--color-text-tertiary)",
              }}
            >
              No results found
            </div>
          ) : (
            results.map((result, index) => (
              <div
                key={result.id}
                data-index={index}
                onClick={() => handleSelect(result)}
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  background: index === selectedIndex ? "rgba(255, 255, 255, 0.08)" : "transparent",
                  transition: "background 0.1s ease",
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div style={{ flexShrink: 0 }}>
                  <RenderIcon result={result} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {result.title}
                  </div>
                  {result.subtitle && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--color-text-tertiary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {result.subtitle}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--color-text-tertiary)",
                    textTransform: "capitalize",
                  }}
                >
                  {result.type}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--color-border-subtle)",
            display: "flex",
            gap: "16px",
            fontSize: "11px",
            color: "var(--color-text-tertiary)",
          }}
        >
          <span>
            <kbd style={kbdStyle}>↑↓</kbd> Navigate
          </span>
          <span>
            <kbd style={kbdStyle}>↵</kbd> Select
          </span>
          <span>
            <kbd style={kbdStyle}>esc</kbd> Close
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
};

const kbdStyle: React.CSSProperties = {
  background: "var(--color-bg-surface)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "3px",
  padding: "1px 4px",
  fontFamily: "inherit",
  fontSize: "10px",
};
