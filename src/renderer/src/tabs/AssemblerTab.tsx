import React, { useState, useCallback, useMemo } from 'react';
import { BridgeGroup, BridgeHistoryEntry, Contact } from '@shared/ipc';
import { AddContactModal } from '../components/AddContactModal';
import { TactileButton } from '../components/TactileButton';
import { ContextMenu } from '../components/ContextMenu';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { Modal } from '../components/Modal';
import { GroupSelector } from '../components/directory/GroupSelector';
import { ListToolbar } from '../components/ListToolbar';
import {
  AssemblerTabProps,
  AssemblerSidebar,
  BridgeReminderModal,
  SaveGroupModal,
  BridgeHistoryModal,
  CompositionList,
} from './assembler';
import { useAssembler } from '../hooks/useAssembler';
import { useGroups } from '../hooks/useGroups';
import { useBridgeHistory } from '../hooks/useBridgeHistory';
import { useToast } from '../components/Toast';

export const AssemblerTab: React.FC<AssemblerTabProps> = (props) => {
  const {
    groups,
    selectedGroupIds,
    onToggleGroup,
    onRemoveManual,
    onResetManual,
    onUndoRemove,
    manualRemoves,
    setSelectedGroupIds,
    setManualAdds,
  } = props;
  const asm = useAssembler(props);
  const { showToast } = useToast();
  const { saveGroup, updateGroup, deleteGroup, importFromCsv } = useGroups();
  const { history, addHistory, deleteHistory, clearHistory } = useBridgeHistory();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  // SaveGroupModal is only opened from bridge history "Save as Group" action
  const [isSaveGroupOpen, setIsSaveGroupOpen] = useState(false);
  const [historyContacts, setHistoryContacts] = useState<string[]>([]);
  const [groupSelectorEmail, setGroupSelectorEmail] = useState<string | null>(null);

  // Create a map of group ID to group for quick lookups
  const groupMap = useMemo(() => {
    const map = new Map<string, BridgeGroup>();
    groups.forEach((g) => {
      map.set(g.id, g);
    });
    return map;
  }, [groups]);

  // Get selected group names for history
  const selectedGroupNames = useMemo(() => {
    return selectedGroupIds
      .map((id) => groupMap.get(id)?.name)
      .filter((name): name is string => !!name);
  }, [selectedGroupIds, groupMap]);

  // Auto-save to bridge history (no prompt)
  const saveToHistory = useCallback(
    async (emails: string[], groupNames: string[]) => {
      if (emails.length === 0) return;
      await addHistory({
        note: '',
        groups: groupNames,
        contacts: emails,
        recipientCount: emails.length,
      });
    },
    [addHistory],
  );

  // Handle saving a history entry as a group
  const handleSaveHistoryAsGroup = useCallback(
    async (name: string) => {
      const result = await saveGroup({
        name,
        contacts: historyContacts,
      });
      if (result) {
        showToast(`Saved group: ${name}`, 'success');
      } else {
        showToast('Failed to save group', 'error');
      }
    },
    [saveGroup, historyContacts, showToast],
  );

  // Handle copy with auto-save to history (always copies all recipients, not filtered)
  const handleCopyWithHistory = useCallback(() => {
    void asm.handleCopy();
    void saveToHistory(
      asm.allRecipients.map((l) => l.email),
      selectedGroupNames,
    );
  }, [asm, selectedGroupNames, saveToHistory]);

  // Handle draft bridge with auto-save to history
  const handleDraftBridgeWithHistory = useCallback(() => {
    asm.executeDraftBridge();
    void saveToHistory(
      asm.allRecipients.map((l) => l.email),
      selectedGroupNames,
    );
  }, [asm, selectedGroupNames, saveToHistory]);

  // Handle loading from history
  const handleLoadFromHistory = useCallback(
    (entry: BridgeHistoryEntry) => {
      onResetManual();
      // Find groups by name and select them
      if (setSelectedGroupIds) {
        const matchingGroupIds = groups
          .filter((g) => entry.groups.includes(g.name))
          .map((g) => g.id);
        setSelectedGroupIds(matchingGroupIds);
      }
      // For history, contacts contains all emails, but we only add as manual those not in selected groups
      const groupEmails = new Set(
        groups.filter((g) => entry.groups.includes(g.name)).flatMap((g) => g.contacts),
      );
      const manualContacts = entry.contacts.filter((email) => !groupEmails.has(email));
      if (setManualAdds && manualContacts.length > 0) {
        setManualAdds(manualContacts);
      }
      showToast('Loaded from history', 'success');
    },
    [groups, onResetManual, setSelectedGroupIds, setManualAdds, showToast],
  );

  // Handle "Save as Group" from bridge history context menu:
  // captures the entry's contacts and opens the save group modal
  const handleHistoryEntryToGroup = useCallback((entry: BridgeHistoryEntry) => {
    setHistoryContacts(entry.contacts);
    setIsSaveGroupOpen(true);
  }, []);

  // Current emails for the sidebar (all recipients, not search-filtered)
  const currentEmails = useMemo(() => asm.allRecipients.map((l) => l.email), [asm.allRecipients]);

  return (
    <div className="tab-layout">
      <div className="assembler-layout">
        <AssemblerSidebar
          groups={groups}
          selectedGroupIds={selectedGroupIds}
          onToggleGroup={onToggleGroup}
          onSaveGroup={saveGroup}
          onUpdateGroup={updateGroup}
          onDeleteGroup={deleteGroup}
          onImportFromCsv={importFromCsv}
          currentEmails={currentEmails}
        />
        <div className="tab-main-content">
          <CollapsibleHeader isCollapsed={asm.isHeaderCollapsed}>
            {asm.allRecipients.length > 0 && (
              <div className="match-count">{asm.allRecipients.length} recipients</div>
            )}
            {manualRemoves.length > 0 && (
              <TactileButton
                variant="ghost"
                onClick={onUndoRemove}
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
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                }
              >
                UNDO
              </TactileButton>
            )}
            <TactileButton
              variant="ghost"
              onClick={onResetManual}
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
                  <path d="M23 4v6h-6" />
                  <path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              }
            >
              RESET
            </TactileButton>
            <TactileButton
              variant="ghost"
              onClick={() => setIsHistoryOpen(true)}
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
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              }
            >
              HISTORY
            </TactileButton>
            <TactileButton
              variant="ghost"
              onClick={handleCopyWithHistory}
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
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              }
            >
              COPY
            </TactileButton>
            <TactileButton
              onClick={() => asm.setIsBridgeReminderOpen(true)}
              variant="primary"
              className="btn-collapsible"
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
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              }
            >
              DRAFT BRIDGE
            </TactileButton>
          </CollapsibleHeader>

          <ListToolbar
            search={asm.search}
            onSearchChange={asm.setSearch}
            placeholder="Search Recipients"
            sortDirection={asm.sortConfig.direction}
            onToggleSortDirection={() =>
              asm.setSortConfig((prev) => ({
                ...prev,
                direction: prev.direction === 'asc' ? 'desc' : 'asc',
              }))
            }
            sortKey={asm.sortConfig.key}
            sortOptions={[
              { value: 'name', label: 'Name' },
              { value: 'email', label: 'Email' },
              { value: 'title', label: 'Title' },
              { value: 'phone', label: 'Phone' },
            ]}
            onSortKeyChange={(key) =>
              asm.setSortConfig((prev) => ({
                ...prev,
                key: key as 'name' | 'email' | 'title' | 'phone',
              }))
            }
          />

          <div className="tab-list-container">
            <CompositionList
              log={asm.log}
              itemData={asm.itemData}
              onScroll={(scrollOffset) => asm.setIsHeaderCollapsed(scrollOffset > 30)}
            />
          </div>
        </div>
      </div>

      <AddContactModal
        isOpen={asm.isAddContactModalOpen}
        onClose={() => asm.setIsAddContactModalOpen(false)}
        initialEmail={asm.pendingEmail}
        onSave={asm.handleContactSaved}
      />
      <BridgeReminderModal
        isOpen={asm.isBridgeReminderOpen}
        onClose={() => asm.setIsBridgeReminderOpen(false)}
        onConfirm={handleDraftBridgeWithHistory}
      />
      <SaveGroupModal
        isOpen={isSaveGroupOpen}
        onClose={() => {
          setIsSaveGroupOpen(false);
          setHistoryContacts([]);
        }}
        onSave={handleSaveHistoryAsGroup}
        existingNames={groups.map((g) => g.name)}
        title="Save as Group"
        description={`Save ${historyContacts.length} recipients from this bridge as a reusable group.`}
        contacts={historyContacts}
      />
      <BridgeHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        onLoad={handleLoadFromHistory}
        onDelete={deleteHistory}
        onClear={clearHistory}
        onSaveAsGroup={handleHistoryEntryToGroup}
      />
      {asm.compositionContextMenu && (
        <ContextMenu
          x={asm.compositionContextMenu.x}
          y={asm.compositionContextMenu.y}
          onClose={() => asm.setCompositionContextMenu(null)}
          items={[
            ...(asm.compositionContextMenu.isUnknown
              ? [
                  {
                    label: 'Save to Contacts',
                    onClick: () => {
                      asm.handleAddToContacts(asm.compositionContextMenu!.email);
                      asm.setCompositionContextMenu(null);
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
                        <title>Save Contact</title>
                        <path d="M19 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M16 11h6m-3-3v6"></path>
                      </svg>
                    ),
                  },
                ]
              : []),
            {
              label: 'Manage Groups',
              onClick: () => {
                setGroupSelectorEmail(asm.compositionContextMenu!.email);
                asm.setCompositionContextMenu(null);
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
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              ),
            },
            {
              label: 'Remove from List',
              onClick: () => {
                onRemoveManual(asm.compositionContextMenu!.email);
                asm.setCompositionContextMenu(null);
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
                  <title>Remove Contact</title>
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              ),
            },
          ]}
        />
      )}
      {groupSelectorEmail && (
        <Modal
          isOpen={true}
          onClose={() => setGroupSelectorEmail(null)}
          title="Manage Groups"
          width="400px"
        >
          <GroupSelector
            contact={{ email: groupSelectorEmail } as unknown as Contact}
            groups={groups}
            onClose={() => setGroupSelectorEmail(null)}
          />
        </Modal>
      )}
    </div>
  );
};
