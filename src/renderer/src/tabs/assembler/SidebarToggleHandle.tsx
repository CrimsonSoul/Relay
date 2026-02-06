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
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#27272A';
        e.currentTarget.style.borderColor = 'var(--border-strong)';
        e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.05)';
        const icon = e.currentTarget.querySelector('svg');
        if (icon) (icon as SVGElement).style.color = 'white';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--color-bg-surface-elevated)';
        e.currentTarget.style.borderColor = 'var(--border-medium)';
        e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
        const icon = e.currentTarget.querySelector('svg');
        if (icon) (icon as SVGElement).style.color = 'var(--color-text-tertiary)';
      }}
      style={{
        position: 'absolute',
        left: '100%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: '24px',
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-surface-elevated)',
        border: '1px solid var(--border-medium)',
        borderRadius: '12px',
        cursor: 'pointer',
        zIndex: 100,
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        boxSizing: 'border-box',
      }}
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
        style={{
          transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
          color: 'var(--color-text-tertiary)',
        }}
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </div>
  </Tooltip>
);
