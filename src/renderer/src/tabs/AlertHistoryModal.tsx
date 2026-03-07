import React, { useState, useEffect } from 'react';
import { HistoryModal } from '../components/HistoryModal';
import { TactileButton } from '../components/TactileButton';
import type { AlertHistoryEntry } from '@shared/ipc';

const SEVERITY_DOT_COLORS: Record<string, string> = {
  ISSUE: '#d32f2f',
  MAINTENANCE: '#f9a825',
  INFO: '#1565c0',
  RESOLVED: '#2e7d32',
};

type AlertHistoryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  history: AlertHistoryEntry[];
  onLoad: (entry: AlertHistoryEntry) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onPin: (id: string, pinned: boolean) => Promise<boolean>;
  onUpdateLabel: (id: string, label: string) => void;
};

export const AlertHistoryModal: React.FC<AlertHistoryModalProps> = ({
  isOpen,
  onClose,
  history,
  onLoad,
  onDelete,
  onClear,
  onPin,
  onUpdateLabel,
}) => {
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');

  // Reset transient UI state when modal closes so stale overlays don't persist on reopen
  useEffect(() => {
    if (!isOpen) {
      setEditingLabelId(null);
      setLabelDraft('');
    }
  }, [isOpen]);

  const startEditLabel = (entry: AlertHistoryEntry) => {
    setEditingLabelId(entry.id);
    setLabelDraft(entry.label ?? '');
  };

  const commitLabel = () => {
    if (editingLabelId) {
      onUpdateLabel(editingLabelId, labelDraft.trim());
      setEditingLabelId(null);
      setLabelDraft('');
    }
  };

  return (
    <HistoryModal<AlertHistoryEntry>
      isOpen={isOpen}
      onClose={onClose}
      history={history}
      title="Alert History"
      classPrefix="alert-history"
      emptyText="No alert history yet. History is saved when you copy or save an alert."
      clearConfirmText="Clear all alert history? Pinned templates will also be removed."
      onLoad={onLoad}
      onDelete={onDelete}
      onClear={onClear}
      enablePinnedSections
      pinnedSectionLabel="Pinned Templates"
      recentSectionLabel="Recent"
      renderEntry={(entry, { formatDate }) => (
        <>
          <div className="alert-history-entry-header">
            <span className="alert-history-entry-date">
              {entry.pinned && (
                <span className="alert-history-pin-icon" title="Pinned template">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 2c-.55 0-1.05.22-1.41.59L9.17 8H4a1 1 0 00-.7 1.71l4.58 4.58L2 22l7.71-5.88 4.58 4.58A1 1 0 0016 20v-5.17l5.41-5.42A2 2 0 0016 2z" />
                  </svg>
                </span>
              )}
              {entry.label || formatDate(entry.timestamp)}
            </span>
            <span
              className="alert-history-entry-severity"
              style={
                {
                  '--severity-color': SEVERITY_DOT_COLORS[entry.severity],
                } as React.CSSProperties
              }
            >
              {entry.severity}
            </span>
          </div>
          <div className="alert-history-entry-subject">{entry.subject || '(no subject)'}</div>
          {entry.sender && <div className="alert-history-entry-sender">From: {entry.sender}</div>}
        </>
      )}
      getContextMenuItems={(entry, { closeMenu, closeModal }) => [
        {
          label: 'Load Alert',
          onClick: () => {
            onLoad(entry);
            closeMenu();
            closeModal();
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
          label: entry.pinned ? 'Unpin' : 'Pin as Template',
          onClick: () => {
            const wasPinned = entry.pinned;
            closeMenu();
            void onPin(entry.id, !wasPinned).then((success) => {
              if (success && !wasPinned) {
                startEditLabel(entry);
              }
            });
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
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1 1 1 0 011 1z" />
            </svg>
          ),
        },
        ...(entry.pinned
          ? [
              {
                label: 'Rename',
                onClick: () => {
                  startEditLabel(entry);
                  closeMenu();
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
                    <path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z" />
                  </svg>
                ),
              },
            ]
          : []),
        {
          label: 'Delete',
          onClick: () => {
            onDelete(entry.id);
            closeMenu();
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
      extraContent={
        editingLabelId ? (
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <div
            className="alert-history-label-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) commitLabel();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditingLabelId(null);
                setLabelDraft('');
              }
            }}
          >
            <dialog className="alert-history-label-editor" open aria-label="Edit template name">
              <label
                className="alert-history-label-editor-label"
                htmlFor="alert-history-label-input"
              >
                Template Name
              </label>
              <input
                id="alert-history-label-input"
                type="text"
                className="alert-history-label-input"
                maxLength={10000}
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitLabel();
                  if (e.key === 'Escape') {
                    setEditingLabelId(null);
                    setLabelDraft('');
                  }
                }}
                placeholder="e.g. Network Outage Template"
                autoFocus
              />
              <div className="alert-history-label-editor-actions">
                <TactileButton
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setEditingLabelId(null);
                    setLabelDraft('');
                  }}
                >
                  Cancel
                </TactileButton>
                <TactileButton variant="primary" size="sm" onClick={commitLabel}>
                  Save
                </TactileButton>
              </div>
            </dialog>
          </div>
        ) : undefined
      }
    />
  );
};
