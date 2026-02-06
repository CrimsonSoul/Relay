import React, { useState } from 'react';
import { Tooltip } from '../Tooltip';

interface SidebarButtonProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

export const SidebarButton: React.FC<SidebarButtonProps> = React.memo(
  ({ icon, label, isActive, onClick }) => {
    const [isHovered, setIsHovered] = useState(false);

    const background = isActive
      ? 'var(--app-surface-2)'
      : isHovered
        ? 'rgba(255, 255, 255, 0.04)'
        : 'transparent';

    return (
      <Tooltip content={label} position="right">
        <button
          type="button"
          aria-label={label}
          aria-pressed={isActive}
          data-testid={`sidebar-${label.toLowerCase().replaceAll(/\s+/g, '-')}`}
          data-active={isActive}
          onClick={onClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '50px',
            height: '50px',
            background,
            border: isActive ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid transparent',
            cursor: 'pointer',
            position: 'relative',
            color: isActive ? '#ffffff' : isHovered ? '#ffffff' : 'var(--color-text-secondary)',
            transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            borderRadius: '14px',
            outline: 'none',
            boxShadow: isActive ? '0 8px 24px rgba(0, 0, 0, 0.4)' : 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              transform: isHovered ? 'scale(1.1)' : 'scale(1)',
              opacity: isActive || isHovered ? 1 : 0.6,
              filter: isActive ? 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.5))' : 'none',
            }}
          >
            {icon}
          </div>

          {isActive && (
            <div
              style={{
                position: 'absolute',
                left: '-11px',
                top: '12px',
                bottom: '12px',
                width: '4px',
                background: 'var(--color-accent-blue)',
                borderRadius: '0 4px 4px 0',
                boxShadow: '0 0 15px var(--color-accent-blue)',
              }}
            />
          )}
        </button>
      </Tooltip>
    );
  },
);
