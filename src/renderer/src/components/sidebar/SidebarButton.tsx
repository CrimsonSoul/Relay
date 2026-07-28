import React from 'react';
import { Tooltip } from '../Tooltip';

/**
 * An at-a-glance signal rendered on the button itself, so a destination can
 * report its state without the user opening it.
 *
 * `announcement` is not optional decoration: `aria-label` replaces a button's
 * inner text for assistive tech, so anything shown in `detail` has to be spoken
 * here too or it is invisible to a screen reader. It also means the state never
 * depends on distinguishing the tint colours.
 */
export type SidebarButtonStatus = {
  tone: string;
  announcement: string;
  detail?: string;
};

interface SidebarButtonProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  status?: SidebarButtonStatus | null;
}

export const SidebarButton: React.FC<SidebarButtonProps> = React.memo(
  ({ icon, label, isActive, onClick, status = null }) => {
    const accessibleName = status ? `${label} — ${status.announcement}` : label;

    return (
      <Tooltip content={accessibleName} position="right">
        <button
          type="button"
          aria-label={accessibleName}
          aria-pressed={isActive}
          data-testid={`sidebar-${label.toLowerCase().replaceAll(/\s+/g, '-')}`}
          data-active={isActive}
          data-status-tone={status?.tone}
          onClick={onClick}
          className={`sidebar-button${isActive ? ' sidebar-button--active' : ''}${
            status ? ' sidebar-button--status' : ''
          }`}
        >
          <div className="sidebar-button-icon">{icon}</div>
          <span className="sidebar-button-label">{label}</span>
          {status?.detail && <span className="sidebar-button-detail">{status.detail}</span>}

          {isActive && <div className="sidebar-button-indicator" />}
        </button>
      </Tooltip>
    );
  },
);
