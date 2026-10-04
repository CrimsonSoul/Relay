import { lastEditedLabel } from '../utils/oncallFreshness';
import { EmptyState } from '../components/EmptyState';
import { resolveOnCallBridgeCandidates } from '../utils/onCallRoles';
import { formatFailure } from '../utils/failureMessage';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useModalState } from '../hooks/useModalState';
import {
  getTabCommandShortcut,
  useTabCommandRequests,
  useTabCommandShortcuts,
} from '../hooks/useTabCommandShortcuts';
import { OnCallRow, Contact } from '@shared/ipc';
import { TactileButton } from '../components/TactileButton';
import { Modal } from '../components/Modal';
import { Input } from '../components/Input';
import { ContextMenu, ContextMenuItem } from '../components/ContextMenu';
import { ConfirmModal } from '../components/ConfirmModal';
import { Tooltip } from '../components/Tooltip';
import { CollapsibleHeader, useCollapsibleHeader } from '../components/CollapsibleHeader';
import { usePersonnel } from '../hooks/usePersonnel';
import type { AddTeamResult } from '../hooks/useOnCallManager';
import { useToast } from '../components/Toast';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  type Announcements,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableTeamCard } from '../components/oncall/SortableTeamCard';
import type { TeamRemoveConfirm } from '../components/personnel/TeamCard';
import { OnCallDisplayControl } from '../components/oncall/OnCallDisplayControl';
import { useOnCallBoard } from '../hooks/useOnCallBoard';
import { useOnCallBoardLayout } from '../hooks/useOnCallBoardLayout';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import type { BoardSettingsState } from '../hooks/useAppData';
import { DEFAULT_ON_CALL_FONT_SCALE } from '../theme/onCallDisplay';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from '../components/tab-chrome/TabChrome';

const REMOVE_TEAM_UNDO_NOTE = 'You can undo this from the notice that follows.';

const removeTeamMessage = ({ team, memberCount }: TeamRemoveConfirm) => {
  if (memberCount === 0)
    return `Remove the team "${team}"? It has no members. ${REMOVE_TEAM_UNDO_NOTE}`;
  const members = memberCount === 1 ? 'member' : 'members';
  return `Remove the team "${team}"? This also removes its ${memberCount} ${members}. ${REMOVE_TEAM_UNDO_NOTE}`;
};

/** Screen-reader narration for keyboard and pointer team reordering. */
function buildDragAnnouncements(
  teams: readonly string[],
  teamIdToName: ReadonlyMap<string, string>,
): Announcements {
  const teamPosition = (id: string | number | undefined) => {
    const teamId = String(id);
    return `${teamIdToName.get(teamId) || teamId}, position ${teams.indexOf(teamId) + 1} of ${teams.length}`;
  };
  return {
    onDragStart: ({ active }) => `Picked up team ${teamPosition(active.id)}.`,
    onDragOver: ({ active, over }) => {
      if (!over)
        return `Team ${teamIdToName.get(String(active.id)) || active.id} is not over a position.`;
      const name = teamIdToName.get(String(active.id)) || String(active.id);
      return `Team ${name}, position ${teams.indexOf(String(over.id)) + 1} of ${teams.length}.`;
    },
    onDragEnd: ({ active, over }) => {
      const name = teamIdToName.get(String(active.id)) || String(active.id);
      return over
        ? `Dropped team ${name} at position ${teams.indexOf(String(over.id)) + 1} of ${teams.length}.`
        : `Dropped team ${name}.`;
    },
    onDragCancel: ({ active }) => `Reorder cancelled. Team ${teamPosition(active.id)}.`,
  };
}

/** Toggles the shared board's team-order lock; its label always names the action it takes. */
function LockOrderButton({
  locked,
  onToggle,
  disabled,
}: Readonly<{ locked: boolean; onToggle: () => void; disabled: boolean }>) {
  const label = locked ? 'Unlock Order' : 'Lock Order';
  return (
    <TactileButton
      variant="secondary"
      onClick={onToggle}
      disabled={disabled}
      aria-label={label}
      tooltip={
        locked
          ? 'Team order is locked. Unlock Order to drag team cards into a new order.'
          : 'Team order is unlocked: drag team cards to reorder the shared board. Lock Order to prevent accidental moves.'
      }
      className="oncall-command-action"
      // The label names the action; the icon shows the state that action produces (closed padlock
      // on Lock Order, open padlock on Unlock Order), so the glyph and the words never disagree.
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
          data-icon={locked ? 'lock-open' : 'lock-closed'}
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d={locked ? 'M7 11V7a5 5 0 0 1 9.9-1' : 'M7 11V7a5 5 0 0 1 10 0v4'}></path>
        </svg>
      }
    >
      {label}
    </TactileButton>
  );
}

type TeamRename = { old: string; new: string };

function RenameTeamModal({
  renamingTeam,
  setRenamingTeam,
  onRename,
}: Readonly<{
  renamingTeam: TeamRename | null;
  setRenamingTeam: React.Dispatch<React.SetStateAction<TeamRename | null>>;
  onRename: (oldName: string, newName: string) => Promise<unknown>;
}>) {
  // Enter twice would send a second rename for a name the first already changed.
  const submittingRef = useRef(false);
  const submit = () => {
    if (!renamingTeam || submittingRef.current) return;
    submittingRef.current = true;
    void onRename(renamingTeam.old, renamingTeam.new)
      .then(() => setRenamingTeam(null))
      .finally(() => {
        submittingRef.current = false;
      });
  };
  return (
    <Modal
      isOpen={Boolean(renamingTeam)}
      onClose={() => setRenamingTeam(null)}
      variant="confirmation"
      title="Rename team"
      footer={
        <>
          <TactileButton variant="secondary" onClick={() => setRenamingTeam(null)}>
            Cancel
          </TactileButton>
          <TactileButton variant="primary" onClick={submit}>
            Rename Team
          </TactileButton>
        </>
      }
    >
      <div className="modal-form-body">
        <Input
          label="Team name"
          value={renamingTeam?.new || ''}
          onChange={(e) => setRenamingTeam((p) => (p ? { ...p, new: e.target.value } : null))}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </div>
    </Modal>
  );
}

function AddTeamModal({
  isOpen,
  onClose,
  onAddTeam,
}: Readonly<{
  isOpen: boolean;
  onClose: () => void;
  onAddTeam: (name: string) => Promise<AddTeamResult>;
}>) {
  const [newTeamName, setNewTeamName] = useState('');
  const [addTeamError, setAddTeamError] = useState('');
  const [isAddingTeam, setIsAddingTeam] = useState(false);

  const closeAddTeamModal = useCallback(() => {
    if (isAddingTeam) return;
    setNewTeamName('');
    setAddTeamError('');
    onClose();
  }, [onClose, isAddingTeam]);

  const submitAddTeam = useCallback(async () => {
    const name = newTeamName.trim();
    if (isAddingTeam) return;
    if (!name) {
      setAddTeamError('Enter a team name');
      return;
    }
    setIsAddingTeam(true);
    try {
      const result = await onAddTeam(name);
      if (result.ok) {
        setNewTeamName('');
        setAddTeamError('');
        onClose();
      } else if (result.error) {
        setAddTeamError(result.error);
      }
    } finally {
      setIsAddingTeam(false);
    }
  }, [onClose, onAddTeam, isAddingTeam, newTeamName]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeAddTeamModal}
      dismissible={!isAddingTeam}
      variant="standard"
      title="Add team"
      footer={
        <>
          <TactileButton variant="secondary" onClick={closeAddTeamModal} disabled={isAddingTeam}>
            Cancel
          </TactileButton>
          <TactileButton
            variant="primary"
            loading={isAddingTeam}
            onClick={() => {
              void submitAddTeam();
            }}
          >
            Add Team
          </TactileButton>
        </>
      }
    >
      <div className="modal-form-body">
        <Input
          label="Team name"
          placeholder="e.g. SRE, Support"
          value={newTeamName}
          onChange={(e) => {
            setNewTeamName(e.target.value);
            setAddTeamError('');
          }}
          disabled={isAddingTeam}
          autoFocus
          error={addTeamError || undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void submitAddTeam();
            }
          }}
        />
      </div>
    </Modal>
  );
}

/** The On-Call keyboard shortcuts and ⌘K tab commands share one set of enabled handlers. */
function useOnCallTabCommands(copyAll: (() => void) | null, addAllToBridge: (() => void) | null) {
  useTabCommandShortcuts({ C: copyAll, B: addAllToBridge });
  useTabCommandRequests({
    'copy-all-on-call': copyAll,
    'add-all-on-call-to-bridge': addAllToBridge,
  });
}

export const PersonnelTab: React.FC<{
  onCall: OnCallRow[];
  contacts: Contact[];
  boardSettings: BoardSettingsState;
  onBoardSettingsChange?: (updater: (prev: BoardSettingsState) => BoardSettingsState) => void;
  onCallFontScale?: number;
  onOnCallFontScaleChange?: (scale: number) => void;
  /** Adds the given emails to the Compose bridge and opens Compose. */
  onAddToBridge?: (emails: string[]) => void;
}> = ({
  onCall,
  contacts,
  boardSettings,
  onBoardSettingsChange,
  onCallFontScale = DEFAULT_ON_CALL_FONT_SCALE,
  onOnCallFontScaleChange,
  onAddToBridge,
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
  const [renamingTeam, setRenamingTeam] = useState<TeamRename | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TeamRemoveConfirm | null>(null);
  const { isCollapsed, scrollContainerRef } = useCollapsibleHeader(30);
  const { showToast } = useToast();
  const hasTeams = teams.length > 0;

  // Same name → directory email resolution as Compose's on-call suggestions.
  const bridgeCandidates = useMemo(
    () => resolveOnCallBridgeCandidates(localOnCall, contacts),
    [localOnCall, contacts],
  );
  const handleAddAllToBridge = useCallback(() => {
    if (!onAddToBridge || bridgeCandidates.length === 0) return;
    const staffed = localOnCall.filter((row) => row.name.trim()).length;
    const skipped = staffed - bridgeCandidates.length;
    onAddToBridge(bridgeCandidates.map((candidate) => candidate.email));
    const people = bridgeCandidates.length === 1 ? 'person' : 'people';
    const added = `Added ${bridgeCandidates.length} on-call ${people} to the bridge`;
    const skippedNote =
      skipped > 0
        ? `. ${skipped} without a unique contact email were skipped; add them from Contacts`
        : '';
    showToast(added + skippedNote, 'success');
  }, [bridgeCandidates, localOnCall, onAddToBridge, showToast]);

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
  const copyAllShortcut = getTabCommandShortcut('C');
  const addToBridgeShortcut = getTabCommandShortcut('B');
  useOnCallTabCommands(
    hasTeams ? () => void handleCopyAllOnCall() : null,
    onAddToBridge && bridgeCandidates.length > 0 ? handleAddAllToBridge : null,
  );

  const [isDragging, setIsDragging] = useState(false);
  const dragResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDragResetTimer = useCallback(() => {
    if (dragResetTimerRef.current) {
      clearTimeout(dragResetTimerRef.current);
      dragResetTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearDragResetTimer, [clearDragResetTimer]);
  // Font scale + masonry column distribution
  const { effectiveOnCallFontScale, boardStyle, gridRef, columnCount, fitToScreen } =
    useOnCallBoardLayout(onCallFontScale, onOnCallFontScaleChange);

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
    // Never leave empty columns: a short board spreads its teams across the
    // width (at least half the available columns, so one team isn't a banner).
    const visibleColumns = Math.min(
      columnCount,
      Math.max(teams.length, Math.ceil(columnCount / 2)),
    );
    const cols = Array.from({ length: Math.max(1, visibleColumns) }, (_, columnIndex) => ({
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

  const dragAnnouncements = useMemo(
    () => buildDragAnnouncements(teams, teamIdToName),
    [teamIdToName, teams],
  );

  // `effectiveLocked` is already true for loading/offline safety states.
  const isDragDisabled = bs.effectiveLocked;

  const handleExportCsv = useCallback(
    async function exportCsv(): Promise<void> {
      try {
        const { exportToCsv } = await import('../services/importExportService');
        const csv = await exportToCsv('oncall');
        if (!csv) {
          showToast('Nothing to export: the on-call board has no teams yet.', 'info');
          return;
        }
        const fileName = `oncall-export-${new Date().toISOString().slice(0, 10)}.csv`;
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported the on-call board to ${fileName}`, 'success');
      } catch (error) {
        // Export only reads the board, so retrying is always safe.
        showToast(
          formatFailure({
            what: "Couldn't export the on-call board",
            error,
            outcome: 'No file was saved.',
          }),
          'error',
          { action: { label: 'Retry', onClick: () => void exportCsv() } },
        );
      }
    },
    [showToast],
  );

  const alertConfigs = [
    { day: 0, type: 'first-responder', label: 'Update First Responder', tone: 'info' },
    { day: 1, type: 'general', label: 'Update Weekly Schedule', tone: 'info' },
    { day: 3, type: 'sql', label: 'Update SQL DBA', tone: 'danger' },
    { day: 4, type: 'oracle', label: 'Update Oracle DBA', tone: 'danger' },
  ] as const;

  const renderAlerts = () =>
    alertConfigs
      .filter((config) => config.day === dayOfWeek && !dismissedAlerts.has(config.type))
      .map((config) => (
        <div // NOSONAR - role=status is the live-region pattern; <output> would imply a calculated result.
          key={config.type}
          role="status"
          className={`personnel-alert personnel-alert--${config.tone}`}
        >
          <span
            className={`personnel-alert-indicator personnel-alert-indicator--${config.tone}`}
            aria-hidden="true"
          />
          <span>{config.label}</span>
          <Tooltip content="Dismiss reminder">
            <button
              type="button"
              className="personnel-alert-dismiss"
              aria-label={`Dismiss reminder: ${config.label}`}
              onClick={() => dismissAlert(config.type)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Tooltip>
        </div>
      ));

  const isAnyModalOpen = !!(addTeamModal.isOpen || renamingTeam || confirmDelete);

  return (
    <div ref={scrollContainerRef} className="personnel-tab-root" style={boardStyle}>
      <TabPageHeader
        title="On-Call"
        subtitle="Team coverage"
        metadata={
          <span // NOSONAR - role=status is the live-region pattern; <output> would imply a calculated result.
            className="oncall-page-meta"
            role="status"
          >
            <span className="oncall-page-state-dot" aria-hidden="true" />
            <span>Current week {weekRange}</span>
            <span aria-hidden="true">·</span>
            <span>Last edited {lastEditedLabel(localOnCall)}</span>
          </span>
        }
      />

      <TabCommandBar ariaLabel="On-call actions" className="oncall-command-bar">
        <CollapsibleHeader isCollapsed={isCollapsed}>
          <TabCommandGroup kind="utility">
            {renderAlerts()}
            <TactileButton
              variant="secondary"
              onClick={handleCopyAllOnCall}
              aria-label="Copy All On-Call Info"
              tooltip={`Copy All On-Call Info · ${copyAllShortcut.label}`}
              aria-keyshortcuts={copyAllShortcut.aria}
              className="oncall-command-action"
              disabled={!hasTeams}
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
              {'Copy All'}
              <kbd className="tab-command-kbd" aria-hidden="true">
                {copyAllShortcut.label}
              </kbd>
            </TactileButton>
            {onAddToBridge && (
              <TactileButton
                variant="secondary"
                onClick={handleAddAllToBridge}
                tooltip={`Add everyone on call with a contact email to the bridge and open Compose · ${addToBridgeShortcut.label}`}
                aria-keyshortcuts={addToBridgeShortcut.aria}
                className="oncall-command-action"
                disabled={bridgeCandidates.length === 0}
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
                    aria-hidden="true"
                  >
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <line x1="19" y1="8" x2="19" y2="14" />
                    <line x1="22" y1="11" x2="16" y2="11" />
                  </svg>
                }
              >
                {'Add to Bridge'}
                <kbd className="tab-command-kbd" aria-hidden="true">
                  {addToBridgeShortcut.label}
                </kbd>
              </TactileButton>
            )}
            <TactileButton
              variant="secondary"
              onClick={handleExportCsv}
              aria-label="Export to CSV"
              tooltip="Export to CSV"
              className="oncall-command-action"
              disabled={!hasTeams}
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
              Export
            </TactileButton>
            {/* View option after the repeated actions (Copy All, Add to Bridge, Export). */}
            <OnCallDisplayControl
              value={effectiveOnCallFontScale}
              onChange={onOnCallFontScaleChange}
              onFitToScreen={onOnCallFontScaleChange ? fitToScreen : undefined}
              disabled={!hasTeams}
            />
          </TabCommandGroup>
          <TabCommandGroup kind="workflow">
            <LockOrderButton
              locked={bs.effectiveLocked}
              onToggle={toggleBoardLock}
              disabled={isBoardLockTogglePending || !hasTeams}
            />
            <TactileButton
              variant="primary"
              aria-label="Add Team"
              tooltip="Add Team"
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
              Add Team
            </TactileButton>
          </TabCommandGroup>
        </CollapsibleHeader>
      </TabCommandBar>

      <DndContext
        id="personnel-board-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{ announcements: dragAnnouncements }}
        onDragStart={(event) => {
          if (isAnyModalOpen || isDragDisabled) return;
          const { active } = event;
          if (teams.includes(active.id as string)) {
            // A reset left over from the previous drop would end this drag early and lose it.
            clearDragResetTimer();
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
            {hasTeams ? (
              teamColumns.map((column) => (
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
              ))
            ) : (
              <EmptyState
                as="li"
                titleAs="h2"
                title="No on-call teams"
                description="Use Add Team to start the board."
              />
            )}
          </ul>
        </SortableContext>
      </DndContext>

      <RenameTeamModal
        renamingTeam={renamingTeam}
        setRenamingTeam={setRenamingTeam}
        onRename={handleRenameTeam}
      />

      <AddTeamModal
        isOpen={addTeamModal.isOpen}
        onClose={addTeamModal.close}
        onAddTeam={handleAddTeam}
      />

      <ConfirmModal
        isOpen={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete?.onConfirm()}
        title="Remove team"
        message={confirmDelete ? removeTeamMessage(confirmDelete) : ''}
        confirmLabel="Remove Team"
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
