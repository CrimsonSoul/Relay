import React, { memo } from 'react';
import { Server } from '@shared/ipc';
import { Tooltip } from './Tooltip';
import { getPlatformColor } from './shared/PersonInfo';

interface ServerCardProps {
  server: Server;
  onContextMenu: (e: React.MouseEvent, server: Server) => void;
  style?: React.CSSProperties;
  selected?: boolean;
  onRowClick?: () => void;
}

export const ServerCard = memo(
  ({ server, onContextMenu, style, selected, onRowClick }: ServerCardProps) => {
    const osInfo = getPlatformColor(server.os);

    return (
      <div
        role={onRowClick ? 'button' : undefined}
        tabIndex={onRowClick ? 0 : undefined}
        onContextMenu={(e) => onContextMenu(e, server)}
        onClick={onRowClick}
        onKeyDown={
          onRowClick
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRowClick();
                }
              }
            : undefined
        }
        className="server-card"
        style={style}
      >
        <div
          className={`server-card-body card-surface${selected ? ' server-card-body--selected' : ''}`}
        >
          <div className="accent-strip" style={{ background: osInfo.text }} />
          <div
            className="server-card-os-badge"
            style={{
              background: osInfo.bg,
              border: `1px solid ${osInfo.border}`,
              color: osInfo.text,
            }}
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
      </div>
    );
  },
);
