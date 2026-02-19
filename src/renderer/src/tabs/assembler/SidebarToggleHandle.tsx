import React from 'react';
import { Tooltip } from '../../components/Tooltip';

interface SidebarToggleHandleProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export const SidebarToggleHandle: React.FC<SidebarToggleHandleProps> = ({
  isCollapsed,
  onToggle,
}) => (
  <Tooltip content={isCollapsed ? 'Expand Groups' : 'Collapse Groups'}>
    <div
      role="button"
      tabIndex={0}
      aria-label={isCollapsed ? 'Expand Groups' : 'Collapse Groups'}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className="sidebar-toggle-handle"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`sidebar-toggle-handle-icon${isCollapsed ? ' sidebar-toggle-handle-icon--collapsed' : ''}`}
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </div>
  </Tooltip>
);
