import React, { useState, useCallback, useMemo } from 'react';
import { BridgeGroup, BridgeHistoryEntry } from '@shared/ipc';
import { AddContactModal } from '../components/AddContactModal';
import { TactileButton } from '../components/TactileButton';
import { ContextMenu } from '../components/ContextMenu';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
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

  // Handle copy with auto-save to history
  const handleCopyWithHistory = useCallback(() => {
    void asm.handleCopy();
    void saveToHistory(
      asm.log.map((l) => l.email),
      selectedGroupNames,
    );
  }, [asm, selectedGroupNames, saveToHistory]);

  // Handle draft bridge with auto-save to history
  const handleDraftBridgeWithHistory = useCallback(() => {
    asm.executeDraftBridge();
    void saveToHistory(
      asm.log.map((l) => l.email),
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

  // Current emails for the sidebar
  const currentEmails = useMemo(() => asm.log.map((l) => l.email), [asm.log]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: asm.isGroupSidebarCollapsed ? '24px 1fr' : '240px 1fr',
        gap: '0px',
        height: '100%',
        minHeight: 0,
        alignItems: 'start',
        transition: 'grid-template-columns 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        overflow: 'visible',
      }}
    >
      <AssemblerSidebar
        groups={groups}
        selectedGroupIds={selectedGroupIds}
        onToggleGroup={onToggleGroup}
        isCollapsed={asm.isGroupSidebarCollapsed}
        onToggleCollapse={asm.handleToggleSidebarCollapse}
        onSaveGroup={saveGroup}
        onUpdateGroup={updateGroup}
        onDeleteGroup={deleteGroup}
        onImportFromCsv={importFromCsv}
        currentEmails={currentEmails}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          padding: '24px 32px',
          background: 'transparent',
          overflow: 'hidden',
          position: 'relative',
          zIndex: 5,
        }}
      >
        <CollapsibleHeader
          title="Data Composition"
          subtitle="Assemble bridge recipients and manage emergency communications"
          isCollapsed={asm.isHeaderCollapsed}
        >
          {manualRemoves.length > 0 && (
            <TactileButton
              onClick={onUndoRemove}
              style={{
                height: '38px',
                padding: '0 16px',
                fontSize: '13px',
                transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              UNDO
            </TactileButton>
          )}
          <TactileButton
            onClick={onResetManual}
            style={{
              height: '38px',
              padding: '0 16px',
              fontSize: '13px',
              transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            RESET
          </TactileButton>
          <TactileButton
            onClick={() => setIsHistoryOpen(true)}
            style={{
              height: '38px',
              padding: '0 16px',
              fontSize: '13px',
              transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            HISTORY
          </TactileButton>
          <TactileButton
            onClick={handleCopyWithHistory}
            style={{
              height: '38px',
              padding: '0 16px',
              fontSize: '13px',
              transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            COPY
          </TactileButton>
          <TactileButton
            onClick={() => asm.setIsBridgeReminderOpen(true)}
            variant="primary"
            style={{
              height: '38px',
              padding: '0 20px',
              transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            DRAFT BRIDGE
          </TactileButton>
        </CollapsibleHeader>

        <CompositionList
          log={asm.log}
          itemData={asm.itemData}
          onScroll={(scrollOffset) => asm.setIsHeaderCollapsed(scrollOffset > 30)}
        />
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
    </div>
  );
};
