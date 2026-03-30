import React, { memo, useEffect, useRef } from 'react';
import { Server } from '@shared/ipc';
import { Tooltip } from './Tooltip';
import { getPlatformColor } from './shared/PersonInfo';

/** Minimal mouse-event shape shared by native MouseEvent and React.MouseEvent */
type ContextMenuEvent = Pick<MouseEvent, 'preventDefault' | 'clientX' | 'clientY'>;

interface ServerCardProps {
  server: Server;
  onContextMenu: (e: ContextMenuEvent, server: Server) => void;
  style?: React.CSSProperties;
  selected?: boolean;
  onRowClick?: () => void;
}

export const ServerCard = memo(
  ({ server, onContextMenu, style, selected, onRowClick }: ServerCardProps) => {
    const osInfo = getPlatformColor(server.os);
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
      <div className={`server-card-body${selected ? ' server-card-body--selected' : ''}`}>
        <div className="accent-strip" style={{ background: osInfo.text }} />
        <div
          className="server-card-os-badge"
          style={
            {
              '--badge-bg': osInfo.bg,
              '--badge-border': osInfo.border,
              '--badge-text': osInfo.text,
            } as React.CSSProperties
          }
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
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
            <span className="server-card-meta-area">{server.businessArea}</span>
            <span className="server-card-meta-separator">|</span>
            <span className="server-card-meta-lob">{server.lob}</span>
          </div>
        </div>
      </div>
    );

    if (onRowClick) {
      return (
        <button
          type="button"
          onContextMenu={(e) => onContextMenu(e, server)}
          onClick={onRowClick}
          className="server-card server-card--interactive"
          style={style}
        >
          {cardContent}
        </button>
      );
    }

    return (
      <div ref={staticCardRef} className="server-card" style={style}>
        {cardContent}
      </div>
    );
  },
);

ServerCard.displayName = 'ServerCard';
