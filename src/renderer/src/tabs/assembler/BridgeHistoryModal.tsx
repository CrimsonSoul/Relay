import React, { useState } from "react";
import { Modal } from "../../components/Modal";
import { TactileButton } from "../../components/TactileButton";
import { ContextMenu } from "../../components/ContextMenu";
import type { BridgeHistoryEntry } from "@shared/ipc";

type BridgeHistoryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  history: BridgeHistoryEntry[];
  onLoad: (entry: BridgeHistoryEntry) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onSaveAsGroup: (entry: BridgeHistoryEntry) => void;
};

export const BridgeHistoryModal: React.FC<BridgeHistoryModalProps> = ({
  isOpen,
  onClose,
  history,
  onLoad,
  onDelete,
  onClear,
  onSaveAsGroup,
}) => {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: BridgeHistoryEntry;
  } | null>(null);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isYesterday =
      new Date(now.getTime() - 86400000).toDateString() === date.toDateString();

    if (isToday) {
      return `Today at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
    if (isYesterday) {
      return `Yesterday at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const handleContextMenu = (e: React.MouseEvent, entry: BridgeHistoryEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div style={{ padding: "24px", minWidth: "480px", maxWidth: "600px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            Bridge History
          </h2>
          {history.length > 0 && (
            <TactileButton
              variant="ghost"
              onClick={() => {
                if (window.confirm("Clear all bridge history?")) {
                  onClear();
                }
              }}
              style={{ fontSize: "12px", padding: "6px 12px" }}
            >
              Clear All
            </TactileButton>
          )}
        </div>

        {history.length === 0 ? (
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              color: "var(--color-text-tertiary)",
            }}
          >
            <div style={{ fontSize: "32px", marginBottom: "12px", opacity: 0.3 }}>
              ∅
            </div>
            <p style={{ margin: 0, fontSize: "14px" }}>
              No bridge history yet. History is saved when you copy a bridge.
            </p>
          </div>
        ) : (
          <div
            style={{
              maxHeight: "400px",
              overflowY: "auto",
              margin: "0 -24px",
              padding: "0 24px",
            }}
          >
            {history.map((entry) => (
              <div
                key={entry.id}
                onClick={() => {
                  onLoad(entry);
                  onClose();
                }}
                onContextMenu={(e) => handleContextMenu(e, entry)}
                style={{
                  padding: "12px 16px",
                  borderRadius: "8px",
                  marginBottom: "8px",
                  background: "var(--color-bg-surface)",
                  border: "1px solid var(--color-border-subtle)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--color-bg-surface-hover)";
                  e.currentTarget.style.borderColor = "var(--color-border-medium)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--color-bg-surface)";
                  e.currentTarget.style.borderColor = "var(--color-border-subtle)";
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: "8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {formatDate(entry.timestamp)}
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--color-text-secondary)",
                      background: "rgba(255,255,255,0.06)",
                      padding: "2px 8px",
                      borderRadius: "10px",
                    }}
                  >
                    {entry.recipientCount} recipient{entry.recipientCount !== 1 ? "s" : ""}
                  </span>
                </div>
                {entry.note && (
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      marginBottom: "6px",
                    }}
                  >
                    {entry.note}
                  </div>
                )}
                {entry.groups.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "4px",
                    }}
                  >
                    {entry.groups.map((group) => (
                      <span
                        key={group}
                        style={{
                          fontSize: "11px",
                          padding: "2px 8px",
                          borderRadius: "10px",
                          background: "rgba(99, 179, 237, 0.15)",
                          color: "rgba(99, 179, 237, 1)",
                          border: "1px solid rgba(99, 179, 237, 0.3)",
                        }}
                      >
                        {group}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "20px",
            paddingTop: "16px",
            borderTop: "1px solid var(--color-border-subtle)",
          }}
        >
          <TactileButton variant="secondary" onClick={onClose}>
            Close
          </TactileButton>
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: "Load Bridge",
              onClick: () => {
                onLoad(contextMenu.entry);
                setContextMenu(null);
                onClose();
              },
              icon: (
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
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              ),
            },
            {
              label: "Save as Group",
              onClick: () => {
                onSaveAsGroup(contextMenu.entry);
                setContextMenu(null);
              },
              icon: (
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
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
              ),
            },
            {
              label: "Delete",
              onClick: () => {
                onDelete(contextMenu.entry.id);
                setContextMenu(null);
              },
              danger: true,
              icon: (
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
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              ),
            },
          ]}
        />
      )}
    </Modal>
  );
};
