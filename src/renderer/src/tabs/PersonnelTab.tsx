import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useModalState } from '../hooks/useModalState';
import { OnCallRow, Contact } from '@shared/ipc';
import { TactileButton } from '../components/TactileButton';
import { Modal } from '../components/Modal';
import { Input } from '../components/Input';
import { ContextMenu, ContextMenuItem } from '../components/ContextMenu';
import { ConfirmModal } from '../components/ConfirmModal';
import { Tooltip } from '../components/Tooltip';
import { CollapsibleHeader, useCollapsibleHeader } from '../components/CollapsibleHeader';
import { usePersonnel } from '../hooks/usePersonnel';
import { useToast } from '../components/Toast';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableTeamCard } from '../components/oncall/SortableTeamCard';
import { OnCallDisplayControl } from '../components/oncall/OnCallDisplayControl';
import { useOnCallBoard } from '../hooks/useOnCallBoard';
import { useOnCallBoardLayout } from '../hooks/useOnCallBoardLayout';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import type { BoardSettingsState } from '../hooks/useAppData';
import { DEFAULT_ON_CALL_FONT_SCALE } from '../theme/onCallDisplay';

export const PersonnelTab: React.FC<{
  onCall: OnCallRow[];
  contacts: Contact[];
  boardSettings: BoardSettingsState;
  onBoardSettingsChange?: (updater: (prev: BoardSettingsState) => BoardSettingsState) => void;
  onCallFontScale?: number;
  onOnCallFontScaleChange?: (scale: number) => void;
}> = ({
  onCall,
  contacts,
  boardSettings,
  onBoardSettingsChange,
  onCallFontScale = DEFAULT_ON_CALL_FONT_SCALE,
  onOnCallFontScaleChange,
}) => {
  const {
    localOnCall,
    weekRange,
    dismissedAlerts,
    dismissAlert,
    dayOfWeek,
    teams,
    teamIdToName,
    handleUpdateRows,
    handleRemoveTeam,
    handleRenameTeam,
    handleAddTeam,
    handleReorderTeams,
    boardSettings: bs,
    toggleBoardLock,
    isBoardLockTogglePending,
    tick,
  } = usePersonnel(onCall, boardSettings, onBoardSettingsChange);
  const addTeamModal = useModalState();
  const [newTeamName, setNewTeamName] = useState('');
  const [renamingTeam, setRenamingTeam] = useState<{ old: string; new: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    team: string;
    onConfirm: () => void;
  } | null>(null);
  const { isCollapsed, scrollContainerRef } = useCollapsibleHeader(30);
  const { showToast } = useToast();

  // Pre-group rows by teamId for performance
  const groupedOnCall = useMemo(() => {
    const map = new Map<string, OnCallRow[]>();
    localOnCall.forEach((row) => {
      const existing = map.get(row.teamId) || [];
      existing.push(row);
      map.set(row.teamId, existing);
    });
    return map;
  }, [localOnCall]);

  // Display-name versions for copy helpers (useOnCallBoard uses team names in clipboard text)
  const teamDisplayNames = useMemo(
    () => teams.map((tid) => teamIdToName.get(tid) || tid),
    [teams, teamIdToName],
  );

  const getTeamRowsByName = useCallback(
    (teamName: string) => {
      // Find teamId for this display name, then look up rows
      for (const [tid, name] of teamIdToName) {
        if (name === teamName) return groupedOnCall.get(tid) || [];
      }
      return [];
    },
    [teamIdToName, groupedOnCall],
  );

  const { animationParent, enableAnimations, handleCopyTeamInfo, handleCopyAllOnCall } =
    useOnCallBoard({
      teams: teamDisplayNames,
      getTeamRows: getTeamRowsByName,
    });

  const [isDragging, setIsDragging] = useState(false);
  const dragResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDragResetTimer = useCallback(() => {
    if (dragResetTimerRef.current) {
      clearTimeout(dragResetTimerRef.current);
      dragResetTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearDragResetTimer, [clearDragResetTimer]);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const lastUpdatedLabel = useMemo(
    () =>
      lastUpdated.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    [lastUpdated],
  );

  useEffect(() => {
    setLastUpdated(new Date());
  }, [localOnCall]);

  // Font scale + masonry column distribution
  const { effectiveOnCallFontScale, boardStyle, gridRef, columnCount } =
    useOnCallBoardLayout(onCallFontScale);

  /**
   * useAutoAnimate hands back a ref *callback*, not a ref object — assigning
   * `.current` onto it only decorated the function, so the library never saw the
   * node and the board never animated. It must be *called*, but its body sets
   * state, so it has to keep a stable identity: an inline arrow here is a new
   * ref every render, which React re-invokes (null, then node) on each pass,
   * setting state each time and looping until React gives up and the tab falls
   * into its error boundary.
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
      const column = cols[i % cols.length];
      // cols always holds at least one entry (Math.max(1, columnCount) above).
      if (column) column.teamIds.push(teamId);
    });
    return cols;
  }, [teams, columnCount]);

  useEffect(() => {
    enableAnimations(!isDragging);
  }, [isDragging, enableAnimations]);

  // Ensure drag state is cleared on unmount
  useEffect(() => {
    return () => {
      globalThis.api?.notifyDragStop();
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = teams.indexOf(active.id as string);
      const newIndex = teams.indexOf(over.id as string);
      void handleReorderTeams(oldIndex, newIndex);
    }
  };

  // `effectiveLocked` is already true for loading/offline safety states.
  const isDragDisabled = bs.effectiveLocked;

  const handleExportCsv = useCallback(async () => {
    try {
      const { exportToCsv } = await import('../services/importExportService');
      const csv = await exportToCsv('oncall');
      if (!csv) {
        showToast('No on-call data to export', 'info');
        return;
      }
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `oncall-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('On-call data exported', 'success');
    } catch (err) {
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [showToast]);

  const alertConfigs = [
    { day: 0, type: 'first-responder', label: 'Update First Responder', tone: 'info' },
    { day: 1, type: 'general', label: 'Update Weekly Schedule', tone: 'info' },
    { day: 3, type: 'sql', label: 'Update SQL DBA', tone: 'danger' },
    { day: 4, type: 'oracle', label: 'Update Oracle DBA', tone: 'danger' },
  ] as const;

  const renderAlerts = () =>
    alertConfigs
      .filter((config) => config.day === dayOfWeek && !dismissedAlerts.has(config.type))
      .map((config) => {
        const isDanger = config.tone === 'danger';
        return (
          <Tooltip key={config.type} content="Click to dismiss">
            <button
              type="button"
              onClick={() => dismissAlert(config.type)}
              className={`card-surface personnel-alert-btn ${isDanger ? 'personnel-alert-btn--danger' : 'personnel-alert-btn--info'}`}
            >
              <span
                className={`personnel-alert-indicator ${isDanger ? 'personnel-alert-indicator--danger' : 'personnel-alert-indicator--info'}`}
              />
              {config.label}
            </button>
          </Tooltip>
        );
      });

  const isAnyModalOpen = !!(addTeamModal.isOpen || renamingTeam || confirmDelete);

  return (
    <div ref={scrollContainerRef} className="personnel-tab-root" style={boardStyle}>
      <header className="oncall-page-header">
        <div>
          <div className="oncall-page-context">On-Call</div>
          <h2 className="oncall-page-title">On-Call Coverage</h2>
        </div>
        <div className="oncall-page-meta" role="status" aria-live="polite">
          <span className="oncall-page-state-dot" aria-hidden="true" />
          <span>{weekRange}</span>
          <span aria-hidden="true">·</span>
          <span>Last updated {lastUpdatedLabel}</span>
        </div>
      </header>

      <div className="oncall-command-bar" role="toolbar" aria-label="On-call actions">
        <CollapsibleHeader isCollapsed={isCollapsed}>
          <div className="oncall-command-group oncall-command-group--utility">
            {renderAlerts()}
            <OnCallDisplayControl
              value={effectiveOnCallFontScale}
              onChange={onOnCallFontScaleChange}
            />
            <TactileButton
              variant="secondary"
              onClick={handleCopyAllOnCall}
              title="Copy All On-Call Info"
              aria-label="Copy All On-Call Info"
              tooltip="Copy all on-call info"
              className="oncall-command-action"
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
            <TactileButton
              variant="secondary"
              onClick={handleExportCsv}
              title="Export to CSV (Excel)"
              aria-label="Export to CSV"
              tooltip="Export to CSV"
              className="oncall-command-action"
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
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              }
            >
              EXPORT
            </TactileButton>
          </div>
          <div className="oncall-command-group oncall-command-group--workflow">
            <TactileButton
              variant="secondary"
              onClick={toggleBoardLock}
              disabled={isBoardLockTogglePending}
              title={
                bs.effectiveLocked
                  ? 'Unlock Board (enable drag reorder)'
                  : 'Lock Board (disable drag reorder)'
              }
              aria-label={bs.effectiveLocked ? 'Unlock Board' : 'Lock Board'}
              tooltip={
                bs.effectiveLocked
                  ? 'Unlock board to enable drag reorder'
                  : 'Lock board to disable drag reorder'
              }
              className="oncall-command-action"
              icon={
                bs.effectiveLocked ? (
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
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                ) : (
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
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
                  </svg>
                )
              }
            >
              {bs.effectiveLocked ? 'LOCKED' : 'UNLOCKED'}
            </TactileButton>
            <TactileButton
              variant="primary"
              aria-label="Add Card"
              tooltip="Add card"
              className="btn-collapsible"
              onClick={addTeamModal.open}
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
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              }
            >
              ADD CARD
            </TactileButton>
          </div>
        </CollapsibleHeader>
      </div>

      <DndContext
        id="personnel-board-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(event) => {
          if (isAnyModalOpen || isDragDisabled) return;
          const { active } = event;
          if (teams.includes(active.id as string)) {
            setIsDragging(true);
            globalThis.api?.notifyDragStart();
          }
        }}
        onDragEnd={(event) => {
          if (isDragging) {
            handleDragEnd(event);
            clearDragResetTimer();
            dragResetTimerRef.current = setTimeout(() => {
              dragResetTimerRef.current = null;
              setIsDragging(false);
            }, 50);
            globalThis.api?.notifyDragStop();
          }
        }}
        onDragCancel={() => {
          if (isDragging) {
            clearDragResetTimer();
            setIsDragging(false);
            globalThis.api?.notifyDragStop();
          }
        }}
      >
        <SortableContext items={teams} strategy={rectSortingStrategy}>
          <ul ref={setMasonryRef} className="oncall-masonry" aria-label="Sortable On-Call Teams">
            {teamColumns.map((column) => (
              <div className="oncall-masonry-column" key={column.id}>
                {column.teamIds.map((teamId) => {
                  const teamName = teamIdToName.get(teamId) || teamId;
                  return (
                    <li key={teamId} className="oncall-masonry-item">
                      <SortableTeamCard
                        id={teamId}
                        team={teamName}
                        index={teams.indexOf(teamId)}
                        rows={groupedOnCall.get(teamId) || []}
                        contacts={contacts}
                        onUpdateRows={handleUpdateRows}
                        onRenameTeam={(o, n) => setRenamingTeam({ old: o, new: n })}
                        onRemoveTeam={handleRemoveTeam}
                        setConfirm={setConfirmDelete}
                        setMenu={setMenu}
                        onCopyTeamInfo={handleCopyTeamInfo}
                        tick={tick}
                        disabled={isDragDisabled}
                      />
                    </li>
                  );
                })}
              </div>
            ))}
          </ul>
        </SortableContext>
        <div aria-live="polite" className="sr-only">
          {isDragging ? 'Dragging team' : ''}
        </div>
      </DndContext>

      <Modal
        isOpen={Boolean(renamingTeam)}
        onClose={() => setRenamingTeam(null)}
        variant="confirmation"
        title="Rename Card"
        footer={
          <>
            <TactileButton variant="secondary" onClick={() => setRenamingTeam(null)}>
              Cancel
            </TactileButton>
            <TactileButton
              variant="primary"
              onClick={() => {
                if (renamingTeam) {
                  void handleRenameTeam(renamingTeam.old, renamingTeam.new).then(() =>
                    setRenamingTeam(null),
                  );
                }
              }}
            >
              Rename
            </TactileButton>
          </>
        }
      >
        <div className="modal-form-body">
          <Input
            value={renamingTeam?.new || ''}
            onChange={(e) => setRenamingTeam((p) => (p ? { ...p, new: e.target.value } : null))}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renamingTeam) {
                void handleRenameTeam(renamingTeam.old, renamingTeam.new).then(() =>
                  setRenamingTeam(null),
                );
              }
            }}
          />
        </div>
      </Modal>

      <Modal
        isOpen={addTeamModal.isOpen}
        onClose={addTeamModal.close}
        variant="standard"
        title="Add New Card"
        footer={
          <>
            <TactileButton variant="secondary" onClick={addTeamModal.close}>
              Cancel
            </TactileButton>
            <TactileButton
              variant="primary"
              onClick={() => {
                if (newTeamName.trim()) {
                  void handleAddTeam(newTeamName.trim());
                  setNewTeamName('');
                  addTeamModal.close();
                }
              }}
            >
              Add Card
            </TactileButton>
          </>
        }
      >
        <div className="modal-form-body">
          <Input
            placeholder="Card Name (e.g. SRE, Support)"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newTeamName.trim()) {
                void handleAddTeam(newTeamName.trim());
                setNewTeamName('');
                addTeamModal.close();
              }
            }}
          />
        </div>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete?.onConfirm()}
        title="Remove Card"
        message={
          confirmDelete
            ? `Are you sure you want to remove the card "${confirmDelete.team}"? This will delete all members in this card.`
            : ''
        }
        confirmLabel="Remove"
        isDanger
      />
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
      <StatusBar
        left={<StatusBarLive />}
        right={
          <span>
            {teams.length} {teams.length === 1 ? 'team' : 'teams'}
          </span>
        }
      />
    </div>
  );
};
