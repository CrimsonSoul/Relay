import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DynatraceDashboardState, DynatraceRuntimeState } from '@shared/dynatrace';
import { Tooltip } from '../Tooltip';
import { DashboardsIcon } from './SidebarIcons';

interface SidebarDashboardsProps {
  dashboards: DynatraceDashboardState[];
  onOpenDashboard: (id: string) => void | Promise<void>;
}

const DYNATRACE_STATE_LABELS: Record<DynatraceRuntimeState, string> = {
  live: 'Live',
  authenticating: 'Signed out',
  blocked: 'Blocked',
  'load-failed': 'Load failed',
  closed: 'Closed',
};

type PopoverPosition = {
  left: number;
  bottom: number;
};

export function SidebarDashboards({
  dashboards,
  onOpenDashboard,
}: Readonly<SidebarDashboardsProps>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition>({
    left: 0,
    bottom: 0,
  });

  const updatePopoverPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    setPopoverPosition({
      left: rect.right + 8,
      bottom: Math.max(globalThis.innerHeight - rect.bottom, 8),
    });
  }, []);

  useEffect(() => {
    if (dashboards.length <= 1) setIsOpen(false);
  }, [dashboards.length]);

  useEffect(() => {
    if (!isOpen) return undefined;

    updatePopoverPosition();
    globalThis.addEventListener('resize', updatePopoverPosition);
    globalThis.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      globalThis.removeEventListener('resize', updatePopoverPosition);
      globalThis.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [isOpen, updatePopoverPosition]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (dashboards.length === 0) return null;

  const singleDashboard = dashboards.length === 1 ? dashboards[0] : null;
  const buttonLabel = singleDashboard
    ? `Open Dynatrace dashboard ${singleDashboard.name}`
    : 'Open Dynatrace dashboards';

  const handleLauncherClick = () => {
    if (singleDashboard) {
      void onOpenDashboard(singleDashboard.id);
      return;
    }

    updatePopoverPosition();
    setIsOpen((current) => !current);
  };

  const handleDashboardClick = (id: string) => {
    void onOpenDashboard(id);
    setIsOpen(false);
  };

  return (
    <>
      <Tooltip content="Dashboards" position="right">
        <button
          ref={buttonRef}
          type="button"
          aria-label={buttonLabel}
          aria-haspopup={singleDashboard ? undefined : 'dialog'}
          aria-expanded={singleDashboard ? undefined : isOpen}
          data-testid="sidebar-dashboards"
          onClick={handleLauncherClick}
          className="sidebar-button sidebar-dashboards"
        >
          <div className="sidebar-button-icon">
            <DashboardsIcon />
          </div>
          <span className="sidebar-button-label">Dashboards</span>
        </button>
      </Tooltip>

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            className="sidebar-dashboards-popover"
            role="dialog"
            aria-label="Dynatrace dashboards"
            style={{
              left: popoverPosition.left,
              bottom: popoverPosition.bottom,
            }}
          >
            {dashboards.map((dashboard) => {
              const stateLabel = DYNATRACE_STATE_LABELS[dashboard.state];
              return (
                <button
                  key={dashboard.id}
                  type="button"
                  className="sidebar-dashboards-popover-item"
                  aria-label={`Open ${dashboard.name} dashboard, ${stateLabel}`}
                  onClick={() => handleDashboardClick(dashboard.id)}
                >
                  <span className="sidebar-dashboards-popover-name">{dashboard.name}</span>
                  <span className="sidebar-dashboards-popover-state">{stateLabel}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
