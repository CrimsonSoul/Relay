import React, { memo, useEffect, useRef } from 'react';
import { Server } from '@shared/ipc';
import { Tooltip } from './Tooltip';
import { RowActionsButton, type RowMenuAnchor } from './directory/RowActionsButton';

/** Minimal mouse-event shape shared by native MouseEvent and React.MouseEvent */
type ContextMenuEvent = Pick<MouseEvent, 'preventDefault' | 'clientX' | 'clientY'>;

interface ServerCardProps {
  server: Server;
  onContextMenu: (e: ContextMenuEvent, server: Server) => void;
  style?: React.CSSProperties;
  selected?: boolean;
  /** Row an open context menu, notes editor or delete confirm acts on. */
  menuTarget?: boolean;
  onRowClick?: () => void;
  /** Opens the row's actions menu from its narrow-window `⋯` button; omit for no button. */
  onOpenActions?: (anchor: RowMenuAnchor) => void;
  ownerName?: string;
  supportName?: string;
  recordKey?: string;
}

const META_FIELDS = [
  ['area', 'businessArea'],
  ['lob', 'lob'],
  ['os', 'os'],
] as const;

export const ServerCard = memo(
  ({
    server,
    onContextMenu,
    style,
    selected,
    menuTarget,
    onRowClick,
    onOpenActions,
    ownerName,
    supportName,
    recordKey,
  }: ServerCardProps) => {
    const meta = META_FIELDS.map(([key, field]) => [key, server[field]?.trim()] as const).filter(
      ([, value]) => value && value !== '-',
    );
    const staticCardRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (onRowClick) return;

      const node = staticCardRef.current;
      if (!node) return;

      const handleContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        onContextMenu(event, server);
      };

      node.addEventListener('contextmenu', handleContextMenu);
      return () => node.removeEventListener('contextmenu', handleContextMenu);
    }, [onContextMenu, onRowClick, server]);
    const cardContent = (
      <div
        className={`server-card-body${selected ? ' server-card-body--selected' : ''}${
          menuTarget ? ' server-card-body--menu-target' : ''
        }`}
      >
        <div className="server-card-os-badge">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
        </div>
        <div className="server-card-info">
          <div className="server-card-name-row">
            <Tooltip content={server.name}>
              <span className="server-card-name text-balance break-word">{server.name}</span>
            </Tooltip>
          </div>
          <div className="server-card-meta">
            {meta.map(([key, value], i) => (
              <React.Fragment key={key}>
                {i > 0 && <span className="server-card-meta-separator">·</span>}
                <span className={`server-card-meta-${key}`}>{value}</span>
              </React.Fragment>
            ))}
          </div>
          {(ownerName || supportName) && (
            <div className="server-card-relationships">
              {ownerName && <span>Owner: {ownerName}</span>}
              {ownerName && supportName && (
                <span className="server-card-meta-separator" aria-hidden="true">
                  ·
                </span>
              )}
              {supportName && <span>Support: {supportName}</span>}
            </div>
          )}
        </div>
      </div>
    );

    if (onRowClick) {
      const rowButton = (
        <button
          type="button"
          data-record-key={recordKey}
          onContextMenu={(e) => onContextMenu(e, server)}
          onClick={onRowClick}
          className="server-card server-card--interactive"
          style={onOpenActions ? undefined : style}
        >
          {cardContent}
        </button>
      );
      if (!onOpenActions) return rowButton;
      // The `⋯` button overlays the row's right edge so the selected fill and rail span it.
      return (
        <div className="server-card-row" style={style}>
          {rowButton}
          <RowActionsButton name={server.name} onOpen={onOpenActions} />
        </div>
      );
    }

    return (
      <div ref={staticCardRef} data-record-key={recordKey} className="server-card" style={style}>
        {cardContent}
      </div>
    );
  },
);

ServerCard.displayName = 'ServerCard';
