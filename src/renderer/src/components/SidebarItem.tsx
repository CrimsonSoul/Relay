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
        type="button"
        role="treeitem"
        aria-selected={active}
        aria-label={`${label}, ${count || 0} items`}
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
          <span
            className="card-surface"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '14px',
              color: color.text,
              padding: '8px 16px',
              borderRadius: '12px',
              fontWeight: 600,
              maxWidth: '100%',
              width: '100%',
              justifyContent: 'space-between'
            }}>
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '12px' }}>
              {label}
            </span>
            {count !== undefined && (
              <span style={{
                opacity: 0.8,
                fontSize: '12px',
                fontWeight: 600,
                color: color.text,
                paddingLeft: '6px',
                flexShrink: 0,
                fontFamily: 'var(--font-mono)'
              }}>
                {count}
              </span>
            )}
          </span>
        </div>
      </button>
    </Tooltip >
  );
});

SidebarItem.displayName = 'SidebarItem';
