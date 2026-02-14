import React from 'react';
import { Tooltip } from '../Tooltip';

interface SidebarButtonProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

export const SidebarButton: React.FC<SidebarButtonProps> = React.memo(
  ({ icon, label, isActive, onClick }) => {
    return (
      <Tooltip content={label} position="right">
        <button
          type="button"
          aria-label={label}
          aria-pressed={isActive}
          data-testid={`sidebar-${label.toLowerCase().replaceAll(/\s+/g, '-')}`}
          data-active={isActive}
          onClick={onClick}
          className={`sidebar-button${isActive ? ' sidebar-button--active' : ''}`}
        >
          <div className="sidebar-button-icon">{icon}</div>

          {isActive && <div className="sidebar-button-indicator" />}
        </button>
      </Tooltip>
    );
  },
);
