import React from "react";
import { createPortal } from "react-dom";

type ShortcutsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
const modKey = isMac ? "⌘" : "Ctrl";

const shortcuts = [
  { category: "Navigation", items: [
    { keys: `${modKey} + 1`, description: "Go to Compose" },
    { keys: `${modKey} + 2`, description: "Go to On-Call Board" },
    { keys: `${modKey} + 3`, description: "Go to People" },
    { keys: `${modKey} + 4`, description: "Go to Weather" },
    { keys: `${modKey} + 5`, description: "Go to Servers" },
    { keys: `${modKey} + 6`, description: "Go to Radar" },
    { keys: `${modKey} + 7`, description: "Go to AI Chat" },
  ]},
  { category: "Actions", items: [
    { keys: `${modKey} + K`, description: "Open Command Palette" },
    { keys: `${modKey} + Shift + C`, description: "Copy Bridge (in Compose)" },
    { keys: `${modKey} + ,`, description: "Open Settings" },
    { keys: `${modKey} + ?`, description: "Show Shortcuts" },
  ]},
  { category: "General", items: [
    { keys: "Escape", description: "Close modal / dialog" },
    { keys: "↑ ↓", description: "Navigate lists" },
    { keys: "Enter", description: "Select / confirm" },
  ]},
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
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
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        className="animate-scale-in"
        style={{
          width: "100%",
          maxWidth: "480px",
          background: "var(--color-bg-surface-opaque)",
          borderRadius: "12px",
          border: "var(--border-medium)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "rgba(59, 130, 246, 0.15)",
                border: "1px solid rgba(59, 130, 246, 0.35)",
                color: "#60A5FA",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
                <path d="M6 8h.001" />
                <path d="M10 8h.001" />
                <path d="M14 8h.001" />
                <path d="M18 8h.001" />
                <path d="M8 12h.001" />
                <path d="M12 12h.001" />
                <path d="M16 12h.001" />
                <path d="M7 16h10" />
              </svg>
            </div>
            <div
              style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "var(--color-text-primary)",
              }}
            >
              Keyboard Shortcuts
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "1px solid transparent",
              color: "var(--color-text-tertiary)",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--color-text-primary)";
              e.currentTarget.style.background = "var(--color-bg-surface-elevated)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--color-text-tertiary)";
              e.currentTarget.style.background = "none";
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1 }}>
          {shortcuts.map((section, idx) => (
            <div key={section.category} style={{ marginBottom: idx < shortcuts.length - 1 ? "20px" : 0 }}>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--color-text-tertiary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: "10px",
                }}
              >
                {section.category}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {section.items.map((item) => (
                  <div
                    key={item.keys}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      background: "var(--color-bg-surface-elevated)",
                      border: "1px solid rgba(255, 255, 255, 0.06)",
                      borderRadius: "8px",
                    }}
                  >
                    <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                      {item.description}
                    </span>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "var(--color-text-primary)",
                        background: "var(--color-bg-card-hover)",
                        border: "var(--border-subtle)",
                        padding: "4px 8px",
                        borderRadius: "6px",
                        fontFamily: "monospace",
                      }}
                    >
                      {item.keys}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--color-border-subtle)",
            textAlign: "center",
            fontSize: "12px",
            color: "var(--color-text-tertiary)",
          }}
        >
          Press <kbd style={{ background: "var(--color-bg-card-hover)", border: "var(--border-subtle)", borderRadius: "3px", padding: "2px 6px", fontFamily: "inherit", fontSize: "11px" }}>Esc</kbd> to close
        </div>
      </div>
    </div>,
    document.body
  );
};
