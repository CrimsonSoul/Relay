import { memo } from 'react';
import { getColorForString } from '../utils/colors';
import { Tooltip } from './Tooltip';

type SidebarItemProps = {
  label: string;
  count?: number;
  active: boolean;
  onClick: (label: string) => void;
  onContextMenu?: (e: React.MouseEvent, label: string) => void;
};

export const SidebarItem = memo(
  ({ label, count, active, onClick, onContextMenu }: SidebarItemProps) => {
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
          className={`sidebar-item${active ? ' sidebar-item--active' : ''}`}
        >
          <div className="sidebar-item-inner">
            <span
              className="sidebar-item-label"
              style={{
                color: color.text,
                background: color.bg,
                borderColor: color.border,
              }}
            >
              <span className="sidebar-item-accent" style={{ background: color.fill }} />
              <span className="sidebar-item-name">{label}</span>
              {count !== undefined && (
                <span className="sidebar-item-count" style={{ color: color.text }}>
                  {count}
                </span>
              )}
            </span>
          </div>
        </button>
      </Tooltip>
    );
  },
);

SidebarItem.displayName = 'SidebarItem';
