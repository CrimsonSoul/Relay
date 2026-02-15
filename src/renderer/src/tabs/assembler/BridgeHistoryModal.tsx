import React, { useState } from 'react';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import { ContextMenu } from '../../components/ContextMenu';
import type { BridgeHistoryEntry } from '@shared/ipc';

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
    const isYesterday = new Date(now.getTime() - 86400000).toDateString() === date.toDateString();

    if (isToday) {
      return `Today at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
    if (isYesterday) {
      return `Yesterday at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const handleContextMenu = (e: React.MouseEvent, entry: BridgeHistoryEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bridge-history-content">
        <div className="bridge-history-header">
          <h2 className="bridge-history-title">Bridge History</h2>
          {history.length > 0 && (
            <TactileButton
              variant="secondary"
              onClick={() => {
                if (window.confirm('Clear all bridge history?')) {
                  onClear();
                }
              }}
              className="btn-sm"
            >
              Clear All
            </TactileButton>
          )}
        </div>

        {history.length === 0 ? (
          <div className="bridge-history-empty">
            <div className="bridge-history-empty-icon">∅</div>
            <p className="bridge-history-empty-text">
              No bridge history yet. History is saved when you copy a bridge.
            </p>
          </div>
        ) : (
          <div className="bridge-history-list">
            {history.map((entry) => (
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onLoad(entry);
                  onClose();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onLoad(entry);
                    onClose();
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, entry)}
                className="bridge-history-entry"
              >
                <div className="bridge-history-entry-header">
                  <span className="bridge-history-entry-date">{formatDate(entry.timestamp)}</span>
                  <span className="bridge-history-entry-count">
                    {entry.recipientCount} recipient{entry.recipientCount !== 1 ? 's' : ''}
                  </span>
                </div>
                {entry.note && <div className="bridge-history-entry-note">{entry.note}</div>}
                {entry.groups.length > 0 && (
                  <div className="bridge-history-entry-groups">
                    {entry.groups.map((group) => (
                      <span key={group} className="bridge-history-entry-group-tag">
                        {group}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="bridge-history-footer">
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
              label: 'Load Bridge',
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
              label: 'Save as Group',
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
              label: 'Delete',
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
