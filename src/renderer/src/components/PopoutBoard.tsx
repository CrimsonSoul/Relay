import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { OnCallRow, Contact } from '@shared/ipc';
import { CollapsibleHeader, useCollapsibleHeader } from './CollapsibleHeader';
import { TeamCard } from './personnel/TeamCard';
import { usePersonnel } from '../hooks/usePersonnel';
import { Tooltip } from './Tooltip';
import { TactileButton } from './TactileButton';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { useOnCallBoard } from '../hooks/useOnCallBoard';
import { useOnCallBoardLayout } from '../hooks/useOnCallBoardLayout';
import type { BoardSettingsState } from '../hooks/useAppData';
import { DEFAULT_ON_CALL_FONT_SCALE } from '../theme/onCallDisplay';
import { OnCallDisplayControl } from './oncall/OnCallDisplayControl';

interface PopoutBoardProps {
  onCall: OnCallRow[];
  contacts: Contact[];
  boardSettings: BoardSettingsState;
  onBoardSettingsChange?: (updater: (prev: BoardSettingsState) => BoardSettingsState) => void;
  onCallFontScale?: number;
  onOnCallFontScaleChange?: (scale: number) => void;
}

export const PopoutBoard: React.FC<PopoutBoardProps> = ({
  onCall,
  contacts,
  boardSettings,
  onBoardSettingsChange,
  onCallFontScale = DEFAULT_ON_CALL_FONT_SCALE,
  onOnCallFontScaleChange,
}) => {
  const { localOnCall, weekRange, dismissedAlerts, dayOfWeek, teams, teamIdToName, tick } =
    usePersonnel(onCall, boardSettings, onBoardSettingsChange);

  const { isCollapsed, scrollContainerRef } = useCollapsibleHeader(30);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [isKiosk, setIsKiosk] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [isRemoteDragging, setIsRemoteDragging] = useState(false);

  useEffect(() => {
    return globalThis.api?.onDragStateChange((isDragging) => {
      setIsRemoteDragging(isDragging);
    });
  }, []);

  useEffect(() => {
    setLastUpdated(new Date());
  }, [localOnCall]);

  // Font scale + masonry column distribution (shared with PersonnelTab)
  const { effectiveOnCallFontScale, boardStyle, gridRef, columnCount } =
    useOnCallBoardLayout(onCallFontScale);

  const getTeamRows = useCallback(
    (teamId: string) => localOnCall.filter((r) => r.teamId === teamId),
    [localOnCall],
  );

  // Display-name versions for copy helpers
  const teamDisplayNames = useMemo(
    () => teams.map((tid) => teamIdToName.get(tid) || tid),
    [teams, teamIdToName],
  );

  const getTeamRowsByName = useCallback(
    (teamName: string) => {
      for (const [tid, name] of teamIdToName) {
        if (name === teamName) return localOnCall.filter((r) => r.teamId === tid);
      }
      return [];
    },
    [teamIdToName, localOnCall],
  );

  const { animationParent, handleCopyTeamInfo, handleCopyAllOnCall } = useOnCallBoard({
    teams: teamDisplayNames,
    getTeamRows: getTeamRowsByName,
    toastMessages: {
      copyTeamSuccess: (team) => `Copied ${team} on-call info`,
      copyTeamError: 'Failed to copy to clipboard',
      copyAllSuccess: 'Copied all on-call info',
      copyAllError: 'Failed to copy to clipboard',
    },
  });

  /**
   * useAutoAnimate hands back a ref *callback*, not a ref object — assigning
   * `.current` onto it only decorated the function, so the library never saw the
   * node and the board never animated. It must be *called*, but its body sets
   * state, so it has to keep a stable identity: an inline arrow here is a new
   * ref every render, which React re-invokes (null, then node) on each pass,
   * setting state each time and looping until React gives up.
   */
  const setMasonryRef = useCallback(
    (node: HTMLUListElement | null) => {
      gridRef.current = node;
      animationParent(node);
    },
    [animationParent, gridRef],
  );

  const teamColumns = useMemo(() => {
    const cols = Array.from({ length: Math.max(1, columnCount) }, (_, columnIndex) => ({
      id: `on-call-column-${columnIndex + 1}`,
      teamIds: [] as string[],
    }));
    teams.forEach((teamId, i) => {
      // `cols` has at least one entry (Math.max(1, …)), so the modulo always
      // lands on a real column.
      const column = cols[i % cols.length];
      if (column) column.teamIds.push(teamId);
    });
    return cols;
  }, [teams, columnCount]);

  const alertConfigs = [
    { day: 0, type: 'first-responder', label: 'Update First Responder', tone: 'info' },
    { day: 1, type: 'general', label: 'Update Weekly Schedule', tone: 'info' },
    { day: 3, type: 'sql', label: 'Update SQL DBA', tone: 'danger' },
    { day: 4, type: 'oracle', label: 'Update Oracle DBA', tone: 'danger' },
  ] as const;

  const renderAlerts = () =>
    alertConfigs
      .filter((c) => c.day === dayOfWeek && !dismissedAlerts.has(c.type))
      .map((c) => {
        const isDanger = c.tone === 'danger';
        return (
          <Tooltip key={c.type} content="Alert from Main Window">
            <div
              className={`card-surface popout-alert-chip ${isDanger ? 'popout-alert-chip--danger' : 'popout-alert-chip--info'}`}
            >
              <span
                className={`popout-alert-indicator ${isDanger ? 'popout-alert-indicator--danger' : 'popout-alert-indicator--info'}`}
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
      style={boardStyle}
    >
      {isRemoteDragging && (
        <div className="popout-drag-overlay">
          <div className="popout-drag-overlay-inner">
            <span className="animate-spin popout-drag-spinner" />
            <span>Board being updated...</span>
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
          <OnCallDisplayControl
            value={effectiveOnCallFontScale}
            onChange={onOnCallFontScaleChange}
          />
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

      <ul
        ref={setMasonryRef}
        className={`oncall-masonry${isKiosk ? ' oncall-grid--kiosk' : ''}`}
        aria-label="On-Call Teams"
      >
        {teamColumns.map((column) => (
          <div className="oncall-masonry-column" key={column.id}>
            {column.teamIds.map((teamId) => {
              const teamName = teamIdToName.get(teamId) || teamId;
              return (
                <li key={teamId} className="oncall-masonry-item">
                  <TeamCard
                    team={teamName}
                    index={teams.indexOf(teamId)}
                    rows={getTeamRows(teamId)}
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
                </li>
              );
            })}
          </div>
        ))}
      </ul>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
};
