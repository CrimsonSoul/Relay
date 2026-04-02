import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
import { useOnCallBoard } from '../hooks/useOnCallBoard';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import type { BoardSettingsState } from '../hooks/useAppData';

export const PersonnelTab: React.FC<{
  onCall: OnCallRow[];
  contacts: Contact[];
  boardSettings: BoardSettingsState;
  onBoardSettingsChange?: (updater: (prev: BoardSettingsState) => BoardSettingsState) => void;
}> = ({ onCall, contacts, boardSettings, onBoardSettingsChange }) => {
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

  // Masonry column distribution
  const gridRef = React.useRef<HTMLUListElement | null>(null);
  const [columnCount, setColumnCount] = useState(3);

  const updateColumnCount = useCallback(() => {
    const node = gridRef.current;
    if (!node) return;
    const width = node.clientWidth;
    if (width < 1) return;
    const minCol = 340;
    const gap = 24;
    const next = Math.max(1, Math.floor((width + gap) / (minCol + gap)));
    setColumnCount((prev) => (prev === next ? prev : next));
  }, []);

  React.useEffect(() => {
    updateColumnCount();
    const node = gridRef.current;
    if (!node) return;
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateColumnCount);
    observer?.observe(node);
    globalThis.addEventListener('resize', updateColumnCount);
    return () => {
      observer?.disconnect();
      globalThis.removeEventListener('resize', updateColumnCount);
    };
  }, [updateColumnCount]);

  const teamColumns = useMemo(() => {
    const cols: string[][] = Array.from({ length: Math.max(1, columnCount) }, () => []);
    teams.forEach((teamId, i) => cols[i % cols.length].push(teamId));
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

  const isPopout = new URLSearchParams(globalThis.location.search).has('popout');

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

  // Whether drag is disabled (board locked or not ready)
  const isDragDisabled = bs.effectiveLocked || bs.status !== 'ready';

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
                className={`animate-active-indicator personnel-alert-indicator ${isDanger ? 'personnel-alert-indicator--danger' : 'personnel-alert-indicator--info'}`}
              />
              {config.label}
            </button>
          </Tooltip>
        );
      });

  const isAnyModalOpen = !!(addTeamModal.isOpen || renamingTeam || confirmDelete);

  return (
    <div ref={scrollContainerRef} className="personnel-tab-root">
      <CollapsibleHeader isCollapsed={isCollapsed}>
        <div className="oncall-header-info">
          <span className="oncall-header-date">{weekRange}</span>
          {renderAlerts()}
        </div>
        <TactileButton
          variant="ghost"
          onClick={handleCopyAllOnCall}
          title="Copy All On-Call Info"
          aria-label="Copy All On-Call Info"
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
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          }
        >
          COPY ALL
        </TactileButton>
        <TactileButton
          variant="ghost"
          onClick={handleExportCsv}
          title="Export to CSV (Excel)"
          aria-label="Export to CSV"
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          }
        >
          EXPORT
        </TactileButton>
        {!isPopout && (
          <TactileButton
            variant="ghost"
            onClick={() => {
              globalThis.api?.openAuxWindow('popout/board');
            }}
            title="Pop Out Board"
            aria-label="Pop Out Board"
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
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            }
          >
            POP OUT
          </TactileButton>
        )}
        <TactileButton
          variant="ghost"
          onClick={toggleBoardLock}
          disabled={bs.status !== 'ready' || isBoardLockTogglePending}
          title={
            bs.effectiveLocked
              ? 'Unlock Board (enable drag reorder)'
              : 'Lock Board (disable drag reorder)'
          }
          aria-label={bs.effectiveLocked ? 'Unlock Board' : 'Lock Board'}
          className="header-btn-mr"
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
      </CollapsibleHeader>

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
            setTimeout(() => setIsDragging(false), 50);
            globalThis.api?.notifyDragStop();
          }
        }}
        onDragCancel={() => {
          if (isDragging) {
            setIsDragging(false);
            globalThis.api?.notifyDragStop();
          }
        }}
      >
        <SortableContext items={teams} strategy={rectSortingStrategy}>
          <ul
            ref={(node) => {
              gridRef.current = node;
              if (animationParent) animationParent.current = node;
            }}
            className="oncall-masonry stagger-children"
            aria-label="Sortable On-Call Teams"
          >
            {teamColumns.map((column, colIdx) => (
              <div className="oncall-masonry-column" key={colIdx}>
                {column.map((teamId) => {
                  const teamName = teamIdToName.get(teamId) || teamId;
                  return (
                    <li key={teamId} className="oncall-masonry-item animate-card-entrance">
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
        isOpen={!!renamingTeam}
        onClose={() => setRenamingTeam(null)}
        title="Rename Card"
        width="400px"
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
          <div className="modal-form-actions">
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
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={addTeamModal.isOpen}
        onClose={addTeamModal.close}
        title="Add New Card"
        width="400px"
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
          <div className="modal-form-actions">
            <TactileButton variant="secondary" onClick={() => addTeamModal.close()}>
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
          </div>
        </div>
      </Modal>

      {confirmDelete && (
        <ConfirmModal
          isOpen={!!confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={confirmDelete.onConfirm}
          title="Remove Card"
          message={`Are you sure you want to remove the card "${confirmDelete.team}"? This will delete all members in this card.`}
          confirmLabel="Remove"
          isDanger
        />
      )}
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
