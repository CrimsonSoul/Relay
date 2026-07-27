import React, { useState, useCallback, useMemo } from 'react';
import { BridgeGroup } from '@shared/ipc';
import { ContextMenu } from '../../components/ContextMenu';
import { ConfirmModal } from '../../components/ConfirmModal';
import { Tooltip } from '../../components/Tooltip';
import { SaveGroupModal } from './SaveGroupModal';
import { loggers } from '../../utils/logger';

export type SidebarGroupActions = {
  onToggleGroup: (groupId: string) => void;
  onSaveGroup: (
    group: Omit<BridgeGroup, 'id' | 'createdAt' | 'updatedAt'>,
  ) => Promise<BridgeGroup | null | undefined>;
  onUpdateGroup: (
    id: string,
    updates: Partial<Omit<BridgeGroup, 'id' | 'createdAt'>>,
  ) => Promise<boolean | undefined>;
  onDeleteGroup: (id: string) => Promise<boolean | undefined>;
};

type AssemblerSidebarProps = {
  groups: BridgeGroup[];
  selectedGroupIds: string[];
  actions: SidebarGroupActions;
  // For updating a group with current selection
  currentEmails?: string[];
};

const getGroupToken = (name: string): string => {
  const [firstWord, secondWord] = name.match(/[a-zA-Z0-9]+/g) ?? [];

  if (firstWord && secondWord) {
    return `${firstWord.charAt(0)}${secondWord.charAt(0)}`.toUpperCase();
  }

  return firstWord?.slice(0, 2).toUpperCase() || '?';
};

export const AssemblerSidebar: React.FC<AssemblerSidebarProps> = ({
  groups,
  selectedGroupIds,
  actions,
  currentEmails = [],
}) => {
  const { onToggleGroup, onSaveGroup, onUpdateGroup, onDeleteGroup } = actions;
  const [groupContextMenu, setGroupContextMenu] = useState<{
    x: number;
    y: number;
    group: BridgeGroup;
  } | null>(null);
  const [isSaveGroupOpen, setIsSaveGroupOpen] = useState(false);
  const [groupToRename, setGroupToRename] = useState<BridgeGroup | null>(null);
  // Both overwrite and delete replace saved membership that nothing else in Relay can
  // restore, so each one waits on an explicit confirmation before it runs.
  const [groupToOverwrite, setGroupToOverwrite] = useState<BridgeGroup | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<BridgeGroup | null>(null);

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.name.localeCompare(b.name)),
    [groups],
  );

  const handleGroupContextMenu = useCallback(
    (e: React.MouseEvent, groupId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const group = groups.find((g) => g.id === groupId);
      if (group) {
        setGroupContextMenu({ x: e.clientX, y: e.clientY, group });
      }
    },
    [groups],
  );

  const handleSaveNewGroup = useCallback(
    async (name: string) => {
      try {
        const result = await onSaveGroup({ name, contacts: currentEmails });
        if (!result) {
          loggers.app.error('[AssemblerSidebar] Failed to save group');
        }
      } catch (e) {
        loggers.app.error('[AssemblerSidebar] Error saving group', { error: e });
      }
    },
    [onSaveGroup, currentEmails],
  );

  const handleRenameGroup = useCallback(
    async (newName: string) => {
      if (groupToRename) {
        try {
          const success = await onUpdateGroup(groupToRename.id, { name: newName });
          if (!success) {
            loggers.app.error('[AssemblerSidebar] Failed to rename group');
          }
        } catch (e) {
          loggers.app.error('[AssemblerSidebar] Error renaming group', { error: e });
        } finally {
          setGroupToRename(null);
        }
      }
    },
    [groupToRename, onUpdateGroup],
  );

  const handleUpdateGroupWithCurrent = useCallback(
    async (group: BridgeGroup) => {
      try {
        const success = await onUpdateGroup(group.id, { contacts: currentEmails });
        if (!success) throw new Error(`Could not replace the members of ${group.name}.`);
      } catch (e) {
        loggers.app.error('[AssemblerSidebar] Error updating group', { error: e });
        // Rethrow so the confirmation reports the failure instead of closing as if it worked
        throw e;
      }
    },
    [onUpdateGroup, currentEmails],
  );

  const handleDeleteGroup = useCallback(
    async (group: BridgeGroup) => {
      try {
        const success = await onDeleteGroup(group.id);
        if (!success) throw new Error(`Could not delete ${group.name}.`);
      } catch (e) {
        loggers.app.error('[AssemblerSidebar] Error deleting group', { error: e });
        throw e;
      }
    },
    [onDeleteGroup],
  );

  const existingNames = useMemo(() => groups.map((g) => g.name), [groups]);

  const totalContacts = useMemo(() => new Set(groups.flatMap((g) => g.contacts)).size, [groups]);

  const selectedCount = useMemo(
    () =>
      new Set(groups.filter((g) => selectedGroupIds.includes(g.id)).flatMap((g) => g.contacts))
        .size,
    [groups, selectedGroupIds],
  );

  return (
    <>
      <div className="assembler-sidebar">
        <div className="assembler-sidebar-inner">
          <div className="assembler-sidebar-panel">
            <div className="assembler-sidebar-groups">
              <div className="assembler-sidebar-groups-header">
                <span className="assembler-sidebar-groups-title">Contact groups</span>
                <Tooltip content="Create new group">
                  <button
                    type="button"
                    onClick={() => setIsSaveGroupOpen(true)}
                    className="assembler-sidebar-add-btn"
                    title="Create new group"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </button>
                </Tooltip>
              </div>
              <div className="assembler-sidebar-group-list">
                {sortedGroups.map((group) => {
                  const isSelected = selectedGroupIds.includes(group.id);
                  return (
                    <Tooltip
                      key={group.id}
                      content={`${group.name}\n${group.contacts.length} contacts`}
                      block
                      position="right"
                    >
                      <button
                        type="button"
                        className={`sig-grp ${isSelected ? 'sig-grp--on' : ''}`}
                        onClick={() => onToggleGroup(group.id)}
                        onContextMenu={(e) => handleGroupContextMenu(e, group.id)}
                        title={group.name}
                        aria-label={`${group.name} group, ${group.contacts.length} contacts`}
                        aria-pressed={isSelected}
                      >
                        <div className="sig-grp-check">
                          <svg viewBox="0 0 16 16" className="sig-grp-checkmark">
                            <polyline
                              points="3.5 8.5 6.5 11.5 12.5 4.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                        <div className="sig-grp-token" aria-hidden="true">
                          {getGroupToken(group.name)}
                        </div>
                        <div className="sig-grp-info">
                          <div className="sig-grp-name">{group.name}</div>
                          <div className="sig-grp-sub">{group.contacts.length} contacts</div>
                        </div>
                      </button>
                    </Tooltip>
                  );
                })}
                {sortedGroups.length === 0 && (
                  <div className="assembler-sidebar-empty">No groups yet.</div>
                )}
              </div>
            </div>
            <div className="sig-sidebar-footer">
              <span>
                Total contacts <span className="sig-sidebar-footer-val">{totalContacts}</span>
              </span>
              <span>
                Selected{' '}
                <span className="sig-sidebar-footer-val sig-sidebar-footer-val--accent">
                  {selectedCount}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Group context menu */}
      {groupContextMenu && (
        <ContextMenu
          x={groupContextMenu.x}
          y={groupContextMenu.y}
          onClose={() => setGroupContextMenu(null)}
          items={[
            {
              // The item toggles, so it has to say which way it will go — a loaded group
              // offered "Load Group" silently unloads it.
              label: selectedGroupIds.includes(groupContextMenu.group.id)
                ? 'Unload Group'
                : 'Load Group',
              onClick: () => {
                onToggleGroup(groupContextMenu.group.id);
                setGroupContextMenu(null);
              },
              icon: (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              ),
            },
            {
              label: 'Update with Current',
              onClick: () => {
                setGroupToOverwrite(groupContextMenu.group);
                setGroupContextMenu(null);
              },
              icon: (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
              ),
              disabled: currentEmails.length === 0,
            },
            {
              label: 'Rename',
              onClick: () => {
                setGroupToRename(groupContextMenu.group);
                setGroupContextMenu(null);
              },
              icon: (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              ),
            },
            {
              label: 'Delete Group',
              onClick: () => {
                setGroupToDelete(groupContextMenu.group);
                setGroupContextMenu(null);
              },
              danger: true,
              icon: (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              ),
            },
          ]}
        />
      )}

      {/* Save Group Modal - for creating new group */}
      <SaveGroupModal
        isOpen={isSaveGroupOpen}
        onClose={() => setIsSaveGroupOpen(false)}
        onSave={handleSaveNewGroup}
        existingNames={existingNames}
        title="Create New Group"
        description={
          currentEmails.length > 0
            ? `Will include ${currentEmails.length} current recipients`
            : 'Create an empty group'
        }
      />

      {/* Overwriting membership is not undoable — spell out what is being traded away */}
      <ConfirmModal
        isOpen={groupToOverwrite !== null}
        onClose={() => setGroupToOverwrite(null)}
        onConfirm={() =>
          groupToOverwrite ? handleUpdateGroupWithCurrent(groupToOverwrite) : void 0
        }
        title="Replace Group Members"
        message={`Replace all ${groupToOverwrite?.contacts.length ?? 0} members of "${
          groupToOverwrite?.name ?? ''
        }" with the ${currentEmails.length} recipients in the current composition? This cannot be undone.`}
        confirmLabel="Replace Members"
        isDanger
      />

      <ConfirmModal
        isOpen={groupToDelete !== null}
        onClose={() => setGroupToDelete(null)}
        onConfirm={() => (groupToDelete ? handleDeleteGroup(groupToDelete) : void 0)}
        title="Delete Group"
        message={`Delete "${groupToDelete?.name ?? ''}" and its ${
          groupToDelete?.contacts.length ?? 0
        } members? This cannot be undone.`}
        confirmLabel="Delete Group"
        isDanger
      />

      {/* Rename Group Modal */}
      <SaveGroupModal
        isOpen={groupToRename !== null}
        onClose={() => setGroupToRename(null)}
        onSave={handleRenameGroup}
        existingNames={existingNames.filter((n) => n !== groupToRename?.name)}
        title="Rename Group"
        description={`Rename "${groupToRename?.name || ''}"`}
        initialName={groupToRename?.name || ''}
      />
    </>
  );
};
