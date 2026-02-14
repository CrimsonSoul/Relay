import React, { memo } from 'react';
import { Server, Contact } from '@shared/ipc';
import { Tooltip } from './Tooltip';
import { getPlatformColor, PersonInfo } from './shared/PersonInfo';

interface ServerCardProps {
  server: Server;
  contactLookup: Map<string, Contact>;
  onContextMenu: (e: React.MouseEvent, server: Server) => void;
  style?: React.CSSProperties;
  hasNotes?: boolean;
  tags?: string[];
  onNotesClick?: () => void;
}

export const ServerCard = memo(
  ({
    server,
    contactLookup,
    onContextMenu,
    style,
    hasNotes,
    tags = [],
    onNotesClick,
  }: ServerCardProps) => {
    const osInfo = getPlatformColor(server.os);

    return (
      <div onContextMenu={(e) => onContextMenu(e, server)} className="server-card" style={style}>
        <div className="server-card-body card-surface">
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
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
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
            <div className="server-card-detail-row">
              <div className="server-card-name-row">
                <Tooltip content={server.name}>
                  <span className="server-card-name text-balance break-word">{server.name}</span>
                </Tooltip>
                <span
                  className="server-card-os-label"
                  style={{
                    background: osInfo.bg,
                    border: `1px solid ${osInfo.border}`,
                    color: osInfo.text,
                  }}
                >
                  {osInfo.label}
                </span>
              </div>
              <div className="server-card-meta">
                <span className="server-card-meta-area">{server.businessArea}</span>
                <span className="server-card-meta-separator">|</span>
                <span className="server-card-meta-lob">{server.lob}</span>
                {server.comment && server.comment !== '-' && (
                  <>
                    <span className="server-card-meta-separator">|</span>
                    <Tooltip content={server.comment}>
                      <span className="server-card-meta-comment text-clamp-1">
                        {server.comment}
                      </span>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
            <div className="server-card-actions">
              {tags.length > 0 && (
                <div className="server-card-tags">
                  {tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="server-card-tag">
                      #{tag}
                    </span>
                  ))}
                  {tags.length > 2 && (
                    <span className="server-card-tag-overflow">+{tags.length - 2}</span>
                  )}
                </div>
              )}
              {hasNotes && (
                <Tooltip content="Click to view notes">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNotesClick?.();
                    }}
                    className="server-card-notes-btn"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                    </svg>
                  </button>
                </Tooltip>
              )}
              <PersonInfo label="OWNER" value={server.owner || ''} contactLookup={contactLookup} />
              <div className="server-card-divider" />
              <PersonInfo
                label="SUPPORT"
                value={server.contact || ''}
                contactLookup={contactLookup}
              />
            </div>
          </div>
        </div>
      </div>
    );
  },
);
