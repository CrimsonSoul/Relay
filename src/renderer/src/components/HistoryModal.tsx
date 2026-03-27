import React, { useState, useMemo, useEffect } from 'react';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

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

  /** Domain title displayed in the header (e.g. "Alert History"). */
  title: string;

  /** CSS class prefix applied to all generated classNames (e.g. "alert-history"). */
  classPrefix: string;

  /** Empty-state help text shown when history is empty. */
  emptyText: string;

  /** Confirm dialog text shown when the user clicks "Clear All". */
  clearConfirmText: string;

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
}>;

export const formatHistoryDate = (timestamp: number): string => {
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

export function HistoryModal<T extends BaseHistoryEntry>({
  isOpen,
  onClose,
  history,
  title,
  classPrefix,
  emptyText,
  clearConfirmText,
  onLoad,
  onClear,
  renderEntry,
  getContextMenuItems,
  enablePinnedSections = false,
  pinnedSectionLabel = 'Pinned Templates',
  recentSectionLabel = 'Recent',
  extraContent,
}: HistoryModalProps<T>): React.ReactElement | null {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: T;
  } | null>(null);

  // Reset transient UI state when modal closes so stale overlays don't persist on reopen
  useEffect(() => {
    if (!isOpen) {
      setContextMenu(null);
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

  if (!isOpen) return null;

  const renderEntryButton = (entry: T) => (
    <button
      type="button"
      key={entry.id}
      onClick={() => handleEntryActivate(entry)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleEntryActivate(entry);
        }
      }}
      onContextMenu={(e) => handleContextMenu(e, entry)}
      className={`${classPrefix}-entry${entry.pinned ? ' pinned' : ''}`}
    >
      {renderEntry(entry, { formatDate: formatHistoryDate })}
    </button>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className={`${classPrefix}-content`}>
        <div className={`${classPrefix}-header`}>
          <h2 className={`${classPrefix}-title`}>{title}</h2>
          {history.length > 0 && (
            <TactileButton
              variant="secondary"
              onClick={() => {
                if (globalThis.confirm(clearConfirmText)) {
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
          <div className={`${classPrefix}-empty`}>
            <div className={`${classPrefix}-empty-icon`}>{'\u2205'}</div>
            <p className={`${classPrefix}-empty-text`}>{emptyText}</p>
          </div>
        ) : (
          <div className={`${classPrefix}-list`}>
            {enablePinnedSections ? (
              <>
                {pinned.length > 0 && (
                  <>
                    <div className={`${classPrefix}-section-label`}>{pinnedSectionLabel}</div>
                    {pinned.map(renderEntryButton)}
                  </>
                )}
                {recent.length > 0 && (
                  <>
                    {pinned.length > 0 && (
                      <div className={`${classPrefix}-section-label`}>{recentSectionLabel}</div>
                    )}
                    {recent.map(renderEntryButton)}
                  </>
                )}
              </>
            ) : (
              history.map(renderEntryButton)
            )}
          </div>
        )}

        <div className={`${classPrefix}-footer`}>
          <TactileButton variant="secondary" onClick={onClose}>
            Close
          </TactileButton>
        </div>
      </div>

      {extraContent}

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
