import React, { memo } from 'react';
import { getColorForString } from '../utils/colors';
import { Tooltip } from './Tooltip';

type SidebarItemProps = {
  label: string;
  count?: number;
  active: boolean;
  onClick: (label: string) => void;
  onContextMenu?: (e: React.MouseEvent, label: string) => void;
};

export const SidebarItem = memo(({ label, count, active, onClick, onContextMenu }: SidebarItemProps) => {
  const color = getColorForString(label);

  const handleClick = () => {
    onClick(label);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (onContextMenu) {
      onContextMenu(e, label);
    }
  };

  return (
    <Tooltip content={label}>
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{
          padding: '4px 8px', // Slightly tightened
          borderRadius: '8px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
          transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
          userSelect: 'none',
          border: 'none',
          width: '100%',
          fontFamily: 'inherit',
          textAlign: 'center',
          outline: 'none',
          overflow: 'hidden',
          minHeight: '32px' // Slightly tightened
        }}
        onMouseEnter={(e) => {
          if (!active) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', overflow: 'hidden' }}>
          <span style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            color: color.text,
            background: color.bg,
            border: `1px solid ${color.border}`,
            padding: '4px 10px',
            borderRadius: '16px',
            fontWeight: 600,
            maxWidth: '100%',
            overflow: 'hidden',
            wordBreak: 'break-word',
            whiteSpace: 'normal'
          }}>
            <span style={{ display: 'block', maxWidth: '100%', overflow: 'hidden', overflowWrap: 'break-word', whiteSpace: 'normal', wordBreak: 'keep-all' }}>
              {label}
            </span>
            {count !== undefined && (
              <span style={{
                opacity: 0.8,
                fontSize: '11px',
                fontWeight: 500,
                borderLeft: `1px solid ${color.border}`,
                paddingLeft: '6px',
                flexShrink: 0
              }}>
                {count}
              </span>
            )}
          </span>
        </div>
      </button>
    </Tooltip>
  );
});

SidebarItem.displayName = 'SidebarItem';
