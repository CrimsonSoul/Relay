import React, { useState, useCallback, useEffect } from 'react';
import { OnCallRow, Contact, TeamLayout } from '@shared/ipc';
import { CollapsibleHeader, useCollapsibleHeader } from './CollapsibleHeader';
import { TeamCard } from './personnel/TeamCard';
import { usePersonnel } from '../hooks/usePersonnel';
import { Tooltip } from './Tooltip';
import { TactileButton } from './TactileButton';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { useOnCallBoard } from '../hooks/useOnCallBoard';

interface PopoutBoardProps {
  onCall: OnCallRow[];
  contacts: Contact[];
  teamLayout?: TeamLayout;
}

export const PopoutBoard: React.FC<PopoutBoardProps> = ({
  onCall,
  contacts,
  teamLayout: _teamLayout,
}) => {
  const { localOnCall, weekRange, dismissedAlerts, getAlertKey, currentDay, teams, tick } =
    usePersonnel(onCall);

  const { isCollapsed, scrollContainerRef } = useCollapsibleHeader(30);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [isKiosk, setIsKiosk] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [isRemoteDragging, setIsRemoteDragging] = useState(false);

  useEffect(() => {
    return window.api?.onDragStateChange((isDragging) => {
      setIsRemoteDragging(isDragging);
    });
  }, []);

  useEffect(() => {
    setLastUpdated(new Date());
  }, [localOnCall]);

  const getTeamRows = useCallback(
    (team: string) => localOnCall.filter((r) => r.team === team),
    [localOnCall],
  );

  const { animationParent, handleCopyTeamInfo, handleCopyAllOnCall } = useOnCallBoard({
    teams,
    getTeamRows,
    toastMessages: {
      copyTeamSuccess: (team) => `Copied ${team} on-call info`,
      copyTeamError: 'Failed to copy to clipboard',
      copyAllSuccess: 'Copied all on-call info',
      copyAllError: 'Failed to copy to clipboard',
    },
  });

  const alertConfigs = [
    { day: 0, type: 'first-responder', label: 'Update First Responder', tone: 'info' },
    { day: 1, type: 'general', label: 'Update Weekly Schedule', tone: 'info' },
    { day: 3, type: 'sql', label: 'Update SQL DBA', tone: 'danger' },
    { day: 4, type: 'oracle', label: 'Update Oracle DBA', tone: 'danger' },
  ] as const;

  const renderAlerts = () =>
    alertConfigs
      .filter((c) => c.day === currentDay && !dismissedAlerts.has(getAlertKey(c.type)))
      .map((c) => {
        const isDanger = c.tone === 'danger';
        return (
          <Tooltip key={c.type} content="Alert from Main Window">
            <div
              className={`card-surface popout-alert-chip ${isDanger ? 'popout-alert-chip--danger' : 'popout-alert-chip--info'}`}
            >
              <span
                className={`animate-active-indicator popout-alert-indicator ${isDanger ? 'popout-alert-indicator--danger' : 'popout-alert-indicator--info'}`}
              />
              {c.label}
            </div>
          </Tooltip>
        );
      });

  return (
    <div
      ref={scrollContainerRef}
      className={`popout-board${isKiosk ? ' popout-board--kiosk' : ''}`}
    >
      {isRemoteDragging && (
        <div className="popout-drag-overlay">
          <div className="popout-drag-overlay-inner">
            <span className="animate-spin popout-drag-spinner" />
            Board being updated...
          </div>
        </div>
      )}

      {!isKiosk && (
        <CollapsibleHeader isCollapsed={isCollapsed}>
          <div className="oncall-header-info">
            <span className="oncall-header-date">{weekRange}</span>
            <span className="oncall-header-updated">
              Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {renderAlerts()}
          </div>
          <TactileButton
            variant="ghost"
            onClick={() => setIsKiosk(true)}
            title="Kiosk Mode (Full Screen)"
            className="header-btn-mr"
            icon={
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
              </svg>
            }
          >
            KIOSK
          </TactileButton>
          <TactileButton
            variant="ghost"
            onClick={handleCopyAllOnCall}
            title="Copy All On-Call Info"
            icon={
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            }
          >
            COPY ALL
          </TactileButton>
        </CollapsibleHeader>
      )}

      {isKiosk && (
        <div className="popout-kiosk-controls">
          <div className="popout-kiosk-timestamp">
            Last Update: {lastUpdated.toLocaleTimeString()}
          </div>
          <TactileButton
            size="sm"
            onClick={() => setIsKiosk(false)}
            variant="ghost"
            className="popout-kiosk-exit-btn"
          >
            Exit Kiosk
          </TactileButton>
        </div>
      )}

      <div
        ref={animationParent}
        className={`oncall-grid-masonry stagger-children${isKiosk ? ' oncall-grid--kiosk' : ''}`}
        role="list"
        aria-label="On-Call Teams"
      >
        {teams.map((team, idx) => (
          <div key={team} className="oncall-grid-item animate-card-entrance" role="listitem">
            <TeamCard
              team={team}
              index={idx}
              rows={localOnCall.filter((r) => r.team === team)}
              contacts={contacts}
              onUpdateRows={() => {}}
              onRenameTeam={() => {}}
              onRemoveTeam={() => {}}
              setConfirm={() => {}}
              setMenu={setMenu}
              onCopyTeamInfo={handleCopyTeamInfo}
              isReadOnly={true}
              tick={tick}
            />
          </div>
        ))}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
};
