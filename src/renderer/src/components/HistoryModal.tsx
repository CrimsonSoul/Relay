import React, { useState, useMemo, useEffect } from 'react';
import './HistoryModal.css';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { ConfirmModal } from './ConfirmModal';
import { EmptyState } from './EmptyState';
import { formatOpsTime } from '../utils/opsTime';

/** Minimal contract every history entry must satisfy. */
export type BaseHistoryEntry = {
  id: string;
  timestamp: number;
  pinned?: boolean;
};

export type HistoryModalProps<T extends BaseHistoryEntry> = Readonly<{
  isOpen: boolean;
  onClose: () => void;
  history: T[];

  /** Domain title displayed in the header (e.g. "Alert history"). */
  title: string;

  /** CSS class prefix applied to all generated classNames (e.g. "alert-history"). */
  classPrefix: string;

  /** Empty-state title, e.g. "No bridge history yet". */
  emptyTitle: string;

  /** Empty-state description: the next step that fills the history. */
  emptyText: string;

  /**
   * Confirm dialog text shown when the user clicks "Clear All…". Omit it when the caller makes
   * the clear undoable instead; the button then reads "Clear All" and clears at once.
   */
  clearConfirmText?: string;

  /** Called when the user clicks an entry to load it. */
  onLoad: (entry: T) => void;
  onDelete: (id: string) => void;
  onClear: () => void;

  /** Render the body of a single history entry (the button internals). */
  renderEntry: (entry: T, helpers: { formatDate: (ts: number) => string }) => React.ReactNode;

  /**
   * Build the context-menu items for a given entry.
   * The caller controls domain-specific items; common items like Delete can be
   * included by the caller as well for full flexibility.
   */
  getContextMenuItems: (
    entry: T,
    helpers: {
      closeMenu: () => void;
      closeModal: () => void;
    },
  ) => ContextMenuItem[];

  /**
   * If true, entries are split into "pinned" and "recent" sections.
   * Only meaningful when entries have `pinned: true`. Defaults to false.
   */
  enablePinnedSections?: boolean;
  pinnedSectionLabel?: string;
  recentSectionLabel?: string;

  /**
   * Optional extra content rendered between the list and context menu layers.
   * Useful for overlays such as the label-editing dialog in AlertHistory.
   */
  extraContent?: React.ReactNode;

  /** Optional controls rendered below the header and above the entry list. */
  toolbar?: React.ReactNode;

  /** Optional modal width override. */
  width?: string;
}>;

export const formatHistoryDate = (timestamp: number): string => {
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) {
    return new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const isYesterday = new Date(now.getTime() - 86400000).toDateString() === date.toDateString();

  if (isToday) {
    return `Today at ${formatOpsTime(date)}`;
  }
  if (isYesterday) {
    return `Yesterday at ${formatOpsTime(date)}`;
  }
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export function HistoryModal<T extends BaseHistoryEntry>({
  isOpen,
  onClose,
  history,
  title,
  classPrefix,
  emptyTitle,
  emptyText,
  clearConfirmText,
  onLoad,
  onClear,
  renderEntry,
  getContextMenuItems,
  enablePinnedSections = false,
  pinnedSectionLabel = 'Pinned templates',
  recentSectionLabel = 'Recent',
  extraContent,
  toolbar,
  width,
}: HistoryModalProps<T>): React.ReactElement {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: T;
  } | null>(null);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);

  // Reset transient UI state when modal closes so stale overlays don't persist on reopen
  useEffect(() => {
    if (!isOpen) {
      setContextMenu(null);
      setIsClearConfirmOpen(false);
    }
  }, [isOpen]);

  const { pinned, recent } = useMemo(() => {
    if (!enablePinnedSections) return { pinned: [] as T[], recent: history };
    const p: T[] = [];
    const r: T[] = [];
    for (const entry of history) {
      if (entry.pinned) p.push(entry);
      else r.push(entry);
    }
    return { pinned: p, recent: r };
  }, [history, enablePinnedSections]);

  const handleContextMenu = (e: React.MouseEvent, entry: T) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const handleEntryActivate = (entry: T) => {
    onLoad(entry);
    onClose();
  };

  const openRowMenu = (event: React.MouseEvent<HTMLButtonElement>, entry: T) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setContextMenu({ x: bounds.left, y: bounds.bottom, entry });
  };

  // Row = load button + sibling actions button, so no control is nested in another.
  const renderEntryButton = (entry: T) => (
    <div key={entry.id} className="history-modal-row">
      <button
        type="button"
        onClick={() => handleEntryActivate(entry)}
        onContextMenu={(e) => handleContextMenu(e, entry)}
        className={`${classPrefix}-entry history-modal-row-main${entry.pinned ? ' pinned' : ''}`}
      >
        {renderEntry(entry, { formatDate: formatHistoryDate })}
      </button>
      <button
        type="button"
        className="history-modal-row-menu"
        aria-label={`More Actions for entry from ${formatHistoryDate(entry.timestamp)}`}
        aria-haspopup="menu"
        aria-expanded={contextMenu?.entry.id === entry.id}
        onClick={(e) => openRowMenu(e, entry)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      </button>
    </div>
  );

  const renderSection = (kind: 'pinned' | 'recent', label: string, entries: T[]) => (
    <section className={`${classPrefix}-section ${classPrefix}-section-${kind}`}>
      <div className={`${classPrefix}-section-label`}>{label}</div>
      <div className={`${classPrefix}-section-items`}>{entries.map(renderEntryButton)}</div>
    </section>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      variant="large"
      width={width}
      bodyClassName={`${classPrefix}-content`}
      footer={
        <>
          {history.length > 0 && (
            <TactileButton
              variant="danger"
              className="history-modal-clear"
              onClick={clearConfirmText ? () => setIsClearConfirmOpen(true) : onClear}
            >
              {clearConfirmText ? 'Clear All…' : 'Clear All'}
            </TactileButton>
          )}
          <TactileButton variant="secondary" onClick={onClose}>
            Close
          </TactileButton>
        </>
      }
    >
      {toolbar}

      {history.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyText} />
      ) : (
        <div className={`${classPrefix}-list`}>
          {enablePinnedSections ? (
            <>
              {pinned.length > 0 && renderSection('pinned', pinnedSectionLabel, pinned)}
              {recent.length > 0 &&
                (pinned.length > 0
                  ? renderSection('recent', recentSectionLabel, recent)
                  : recent.map(renderEntryButton))}
            </>
          ) : (
            history.map(renderEntryButton)
          )}
        </div>
      )}

      {extraContent}

      {clearConfirmText && (
        <ConfirmModal
          isOpen={isClearConfirmOpen}
          onClose={() => setIsClearConfirmOpen(false)}
          onConfirm={onClear}
          title="Clear history?"
          message={clearConfirmText}
          confirmLabel="Clear History"
          isDanger
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={getContextMenuItems(contextMenu.entry, {
            closeMenu: () => setContextMenu(null),
            closeModal: onClose,
          })}
        />
      )}
    </Modal>
  );
}
