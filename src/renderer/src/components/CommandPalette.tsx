import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Contact, Server, BridgeGroup } from "@shared/ipc";
import { getColorForString } from "../utils/colors";

type ResultType = "contact" | "server" | "group" | "action";

type SearchResult = {
  id: string;
  type: ResultType;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  data: unknown;
};

type CommandPaletteProps = {
  isOpen: boolean;
  onClose: () => void;
  contacts: Contact[];
  servers: Server[];
  groups: BridgeGroup[];
  onAddContactToBridge: (email: string) => void;
  onToggleGroup: (groupId: string) => void;
  onNavigateToTab: (tab: string) => void;
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
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build search results
  const results = useMemo((): SearchResult[] => {
    if (!query.trim()) {
      // Show recent/default actions when empty
      return [
        {
          id: "action-compose",
          type: "action",
          title: "Go to Compose",
          subtitle: "Open bridge composition",
          icon: <ActionIcon type="compose" />,
          data: { action: "navigate", tab: "Compose" },
        },
        {
          id: "action-personnel",
          type: "action",
          title: "Go to On-Call Board",
          subtitle: "View current on-call assignments",
          icon: <ActionIcon type="personnel" />,
          data: { action: "navigate", tab: "Personnel" },
        },
        {
          id: "action-people",
          type: "action",
          title: "Go to People",
          subtitle: "Search contacts directory",
          icon: <ActionIcon type="people" />,
          data: { action: "navigate", tab: "People" },
        },
        {
          id: "action-weather",
          type: "action",
          title: "Go to Weather",
          subtitle: "Check current conditions",
          icon: <ActionIcon type="weather" />,
          data: { action: "navigate", tab: "Weather" },
        },
      ];
    }

    const lower = query.toLowerCase();
    const results: SearchResult[] = [];

    // Search groups first (most important for NOC workflow)
    groups.forEach((group) => {
      if (group.name.toLowerCase().includes(lower)) {
        results.push({
          id: `group-${group.id}`,
          type: "group",
          title: group.name,
          subtitle: `${group.contacts.length} member${group.contacts.length !== 1 ? "s" : ""}`,
          icon: <GroupIcon />,
          data: group,
        });
      }
    });

    // Search contacts
    contacts.forEach((contact) => {
      if (contact._searchString.includes(lower)) {
        results.push({
          id: `contact-${contact.email}`,
          type: "contact",
          title: contact.name || contact.email,
          subtitle: contact.name ? contact.email : contact.title || undefined,
          icon: <ContactIcon name={contact.name || contact.email} />,
          data: contact,
        });
      }
    });

    // Search servers
    servers.forEach((server) => {
      if (server._searchString.includes(lower)) {
        results.push({
          id: `server-${server.name}`,
          type: "server",
          title: server.name,
          subtitle: server.businessArea || server.owner || undefined,
          icon: <ServerIcon />,
          data: server,
        });
      }
    });

    return results.slice(0, 15); // Limit results
  }, [query, contacts, servers, groups]);

  // Reset selection when results change
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
    [results, selectedIndex, onClose]
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
          const action = result.data as { action: string; tab?: string };
          if (action.action === "navigate" && action.tab) {
            onNavigateToTab(action.tab);
          }
          break;
        }
      }
      onClose();
    },
    [onAddContactToBridge, onToggleGroup, onNavigateToTab, onClose]
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
        zIndex: 9999,
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
                background: "rgba(0, 0, 0, 0.2)",
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
                <div style={{ flexShrink: 0 }}>{result.icon}</div>
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

// Icon components
const ContactIcon: React.FC<{ name: string }> = ({ name }) => {
  const color = getColorForString(name);
  return (
    <div
      style={{
        width: "28px",
        height: "28px",
        borderRadius: "6px",
        background: color.bg,
        color: color.text,
        fontSize: "12px",
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {name[0]?.toUpperCase() || "?"}
    </div>
  );
};

const GroupIcon: React.FC = () => (
  <div
    style={{
      width: "28px",
      height: "28px",
      borderRadius: "6px",
      background: "rgba(99, 179, 237, 0.15)",
      color: "rgba(99, 179, 237, 1)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  </div>
);

const ServerIcon: React.FC = () => (
  <div
    style={{
      width: "28px",
      height: "28px",
      borderRadius: "6px",
      background: "rgba(139, 92, 246, 0.15)",
      color: "rgba(139, 92, 246, 1)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  </div>
);

const ActionIcon: React.FC<{ type: string }> = ({ type }) => {
  const iconMap: Record<string, React.ReactNode> = {
    compose: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
    personnel: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    people: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    weather: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      </svg>
    ),
  };

  return (
    <div
      style={{
        width: "28px",
        height: "28px",
        borderRadius: "6px",
        background: "rgba(255, 255, 255, 0.08)",
        color: "var(--color-text-secondary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {iconMap[type] || null}
    </div>
  );
};
