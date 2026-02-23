import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { OnCallRow, Contact, TeamLayout } from '@shared/ipc';
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

export const PersonnelTab: React.FC<{
  onCall: OnCallRow[];
  contacts: Contact[];
  teamLayout?: TeamLayout;
}> = ({ onCall, contacts, teamLayout: _teamLayout }) => {
  const {
    localOnCall,
    weekRange,
    dismissedAlerts,
    dismissAlert,
    getAlertKey,
    currentDay,
    teams,
    handleUpdateRows,
    handleRemoveTeam,
    handleRenameTeam,
    handleAddTeam,
    handleReorderTeams,
    tick,
  } = usePersonnel(onCall);
  const [isAddingTeam, setIsAddingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [renamingTeam, setRenamingTeam] = useState<{ old: string; new: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    team: string;
    onConfirm: () => void;
  } | null>(null);
  const { isCollapsed, scrollContainerRef } = useCollapsibleHeader(30);
  const { showToast } = useToast();

  // Pre-group rows by team for performance
  const groupedOnCall = useMemo(() => {
    const map = new Map<string, OnCallRow[]>();
    localOnCall.forEach((row) => {
      const existing = map.get(row.team) || [];
      existing.push(row);
      map.set(row.team, existing);
    });
    return map;
  }, [localOnCall]);

  const getTeamRows = useCallback((team: string) => groupedOnCall.get(team) || [], [groupedOnCall]);

  const { animationParent, enableAnimations, handleCopyTeamInfo, handleCopyAllOnCall } =
    useOnCallBoard({
      teams,
      getTeamRows,
    });

  const [isDragging, setIsDragging] = useState(false);

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

  const handleExportCsv = useCallback(async () => {
    const result = await globalThis.api?.exportData({
      format: 'csv',
      category: 'oncall',
      includeMetadata: false,
    });
    if (result) {
      showToast('Exported successfully', 'success');
    } else {
      showToast('Export failed', 'error');
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
      .filter(
        (config) => config.day === currentDay && !dismissedAlerts.has(getAlertKey(config.type)),
      )
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

  const isAnyModalOpen = !!(isAddingTeam || renamingTeam || confirmDelete);

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
          variant="primary"
          aria-label="Add Card"
          className="btn-collapsible"
          onClick={() => setIsAddingTeam(true)}
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
          if (isAnyModalOpen) return;
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
            ref={animationParent}
            className="oncall-grid stagger-children"
            aria-label="Sortable On-Call Teams"
          >
            {teams.map((team, idx) => (
              <li key={team} className="oncall-grid-item animate-card-entrance">
                <SortableTeamCard
                  team={team}
                  index={idx}
                  rows={groupedOnCall.get(team) || []}
                  contacts={contacts}
                  onUpdateRows={handleUpdateRows}
                  onRenameTeam={(o, n) => setRenamingTeam({ old: o, new: n })}
                  onRemoveTeam={handleRemoveTeam}
                  setConfirm={setConfirmDelete}
                  setMenu={setMenu}
                  onCopyTeamInfo={handleCopyTeamInfo}
                  tick={tick}
                />
              </li>
            ))}
          </ul>
        </SortableContext>
        <div aria-live="polite" className="sr-only">
          {isDragging ? `Dragging team ${isDragging}` : ''}
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
        isOpen={isAddingTeam}
        onClose={() => setIsAddingTeam(false)}
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
                setIsAddingTeam(false);
              }
            }}
          />
          <div className="modal-form-actions">
            <TactileButton variant="secondary" onClick={() => setIsAddingTeam(false)}>
              Cancel
            </TactileButton>
            <TactileButton
              variant="primary"
              onClick={() => {
                if (newTeamName.trim()) {
                  void handleAddTeam(newTeamName.trim());
                  setNewTeamName('');
                  setIsAddingTeam(false);
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
    </div>
  );
};
