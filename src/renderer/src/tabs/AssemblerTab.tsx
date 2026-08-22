import React, { useState, useCallback, useMemo } from 'react';
import { BridgeGroup, BridgeHistoryEntry } from '@shared/ipc';
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
  BridgeHandoffModal,
  SaveGroupModal,
  BridgeHistoryModal,
  CompositionList,
  ScheduleBridgeModal,
} from './assembler';
import { useAssembler } from '../hooks/useAssembler';
import { useGroups } from '../hooks/useGroups';
import { useBridgeHistory } from '../hooks/useBridgeHistory';
import { useBridgeHandoffHistory } from '../hooks/useBridgeHandoffHistory';
import { useToast } from '../components/Toast';
import { useModalState } from '../hooks/useModalState';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from '../components/tab-chrome/TabChrome';

export const AssemblerTab: React.FC<AssemblerTabProps> = (props) => {
  const {
    groups,
    selectedGroupIds,
    onToggleGroup,
    onRemoveManual,
    onResetManual,
    onUndoRemove,
    manualRemoves,
    manualAdds,
    setSelectedGroupIds,
    setManualAdds,
  } = props;
  const asm = useAssembler(props);
  const { showToast } = useToast();
  const { saveGroup, updateGroup, deleteGroup } = useGroups();
  const { history, addHistory, deleteHistory, clearHistory } = useBridgeHistory();
  const historyModal = useModalState();
  // SaveGroupModal is only opened from bridge history "Save as Group" action
  const saveGroupModal = useModalState();
  const scheduleBridgeModal = useModalState();
  const handoffModal = useModalState();
  const [historyContacts, setHistoryContacts] = useState<string[]>([]);
  const [handoffSubject, setHandoffSubject] = useState('');
  const [groupSelectorEmail, setGroupSelectorEmail] = useState<string | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const { saveSuccessfulHandoff, forgetSuccessfulHandoff } = useBridgeHandoffHistory(addHistory);

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

  const currentSnapshot = useMemo(
    () => ({
      contacts: asm.handoffSummary.recipients.map((recipient) => recipient.email),
      groups: selectedGroupNames,
    }),
    [asm.handoffSummary.recipients, selectedGroupNames],
  );

  const saveAfterSuccess = useCallback(
    async (successMessage: string) => {
      try {
        await saveSuccessfulHandoff(currentSnapshot);
      } catch (error_) {
        showToast(
          `${successMessage}, but history could not be saved: ${
            error_ instanceof Error ? error_.message : 'unknown error'
          }`,
          'error',
        );
      }
    },
    [currentSnapshot, saveSuccessfulHandoff, showToast],
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

  const handleCopyWithHistory = useCallback(async () => {
    if (await asm.handleCopy()) await saveAfterSuccess('Recipients copied');
  }, [asm, saveAfterSuccess]);

  const handleTeamsWithHistory = useCallback(async () => {
    if (!(await asm.executeDraftBridge(handoffSubject))) return;
    handoffModal.close();
    await saveAfterSuccess('Teams draft requested');
  }, [asm, handoffModal, handoffSubject, saveAfterSuccess]);

  const handleOpenHandoffReview = useCallback(() => {
    setHandoffSubject(asm.prepareDraftBridgeSubject());
    handoffModal.open();
  }, [asm, handoffModal]);

  const handleDeleteHistory = useCallback(
    async (id: string) => {
      const entry = history.find((candidate) => candidate.id === id);
      const deleted = await deleteHistory(id);
      if (deleted && entry) {
        forgetSuccessfulHandoff({ contacts: entry.contacts, groups: entry.groups });
      }
      return deleted;
    },
    [deleteHistory, forgetSuccessfulHandoff, history],
  );

  const handleClearHistory = useCallback(async () => {
    const cleared = await clearHistory();
    if (cleared) forgetSuccessfulHandoff();
    return cleared;
  }, [clearHistory, forgetSuccessfulHandoff]);

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
  const handleHistoryEntryToGroup = useCallback(
    (entry: BridgeHistoryEntry) => {
      setHistoryContacts(entry.contacts);
      saveGroupModal.open();
    },
    [saveGroupModal],
  );

  // Current emails for the sidebar (all recipients, not search-filtered)
  const currentEmails = useMemo(() => asm.allRecipients.map((l) => l.email), [asm.allRecipients]);
  // Recipients enriched with contact names for the Schedule Bridge invite
  const scheduleAttendees = useMemo(
    () =>
      asm.allRecipients.map((l) => ({
        name: asm.contactMap.get(l.email.toLowerCase())?.name,
        email: l.email,
      })),
    [asm.allRecipients, asm.contactMap],
  );
  const hasRecipients = asm.allRecipients.length > 0;
  const canReset =
    hasRecipients ||
    selectedGroupIds.length > 0 ||
    manualAdds.length > 0 ||
    manualRemoves.length > 0;

  return (
    <div className="tab-layout assembler-tab">
      <TabPageHeader
        context="Compose"
        title="Bridge Recipient Assembly"
        metadata={
          <span role="status" aria-live="polite">
            {asm.allRecipients.length} {asm.allRecipients.length === 1 ? 'recipient' : 'recipients'}
          </span>
        }
      />

      <TabCommandBar ariaLabel="Compose actions" className="assembler-command-bar">
        <CollapsibleHeader isCollapsed={asm.isHeaderCollapsed}>
          <TabCommandGroup kind="utility">
            {manualRemoves.length > 0 && (
              <TactileButton
                variant="secondary"
                className="assembler-utility-action"
                onClick={onUndoRemove}
                tooltip="Undo last removed recipient"
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
                Undo
              </TactileButton>
            )}
            <TactileButton
              variant="secondary"
              className="assembler-utility-action"
              onClick={onResetManual}
              disabled={!canReset}
              tooltip="Reset manual recipient changes"
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
              Reset
            </TactileButton>
            <TactileButton
              variant="secondary"
              className="assembler-utility-action"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                historyModal.open();
              }}
              tooltip="Open bridge history"
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
              History
            </TactileButton>
          </TabCommandGroup>
          <TabCommandGroup kind="workflow">
            <div className="assembler-bridge-actions">
              <TactileButton
                onClick={() => void handleCopyWithHistory()}
                disabled={!asm.handoffSummary.isValid || asm.isOpeningTeams}
                loading={asm.isCopying}
              >
                Copy Recipients
              </TactileButton>
              <TactileButton
                onClick={handleOpenHandoffReview}
                variant="primary"
                disabled={!hasRecipients || asm.isCopying}
              >
                Open Teams Draft
              </TactileButton>
              <TactileButton
                aria-label="More Compose actions"
                tooltip="More Compose actions"
                disabled={!hasRecipients}
                onClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setMoreMenu({ x: bounds.left, y: bounds.bottom });
                }}
                icon={
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <circle cx="5" cy="12" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="19" cy="12" r="1.5" />
                  </svg>
                }
              />
            </div>
          </TabCommandGroup>
        </CollapsibleHeader>
      </TabCommandBar>

      <div className="assembler-layout assembler-workspace">
        <section className="assembler-groups-pane" aria-label="Contact groups">
          <AssemblerSidebar
            groups={groups}
            selectedGroupIds={selectedGroupIds}
            actions={{
              onToggleGroup,
              onSaveGroup: saveGroup,
              onUpdateGroup: updateGroup,
              onDeleteGroup: deleteGroup,
            }}
            currentEmails={currentEmails}
          />
        </section>
        <section className="tab-main-content assembler-recipients-pane" aria-label="Recipients">
          <div className="assembler-pane-header">
            <div className="assembler-pane-heading">
              <span>Recipients</span>
              <span>{asm.allRecipients.length} selected</span>
            </div>
            <div className="assembler-pane-tools">
              <ListToolbar
                sortDirection={asm.sortConfig.direction}
                onToggleSortDirection={() =>
                  asm.setSortConfig((prev) => ({
                    ...prev,
                    direction: prev.direction === 'asc' ? 'desc' : 'asc',
                  }))
                }
                sortKey={asm.sortConfig.key}
                sortLabel="Sort recipients by"
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
                disabled={!hasRecipients}
              />
            </div>
          </div>
          <div className="tab-list-container">
            <CompositionList
              log={asm.log}
              itemData={asm.itemData}
              onScroll={(scrollOffset) => asm.setIsHeaderCollapsed(scrollOffset > 30)}
              onOpenHistory={historyModal.open}
            />
          </div>
        </section>
      </div>

      <StatusBar
        left={<StatusBarLive />}
        right={<span>{asm.allRecipients.length} selected</span>}
      />

      <AddContactModal
        isOpen={asm.isAddContactModalOpen}
        onClose={() => asm.setIsAddContactModalOpen(false)}
        initialEmail={asm.pendingEmail}
        onSave={asm.handleContactSaved}
      />
      <BridgeHandoffModal
        isOpen={handoffModal.isOpen}
        onClose={handoffModal.close}
        subject={handoffSubject}
        recipients={asm.handoffSummary.recipients}
        duplicateCount={asm.handoffSummary.duplicateCount}
        manualCount={asm.handoffSummary.manualCount}
        groupNames={selectedGroupNames}
        contactMap={asm.contactMap}
        isCopying={asm.isCopying}
        isOpeningTeams={asm.isOpeningTeams}
        onCopy={() => void handleCopyWithHistory()}
        onOpenTeams={() => void handleTeamsWithHistory()}
        onRemoveRecipient={onRemoveManual}
      />
      <ScheduleBridgeModal
        isOpen={scheduleBridgeModal.isOpen}
        onClose={scheduleBridgeModal.close}
        attendees={scheduleAttendees}
      />
      {moreMenu && (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          onClose={() => setMoreMenu(null)}
          items={[{ label: 'Create Calendar Invite', onClick: scheduleBridgeModal.open }]}
        />
      )}
      <SaveGroupModal
        isOpen={saveGroupModal.isOpen}
        onClose={() => {
          saveGroupModal.close();
          setHistoryContacts([]);
        }}
        onSave={handleSaveHistoryAsGroup}
        existingNames={groups.map((g) => g.name)}
        title="Save as Group"
        description={`Save ${historyContacts.length} recipients from this bridge as a reusable group.`}
        contacts={historyContacts}
      />
      <BridgeHistoryModal
        isOpen={historyModal.isOpen}
        onClose={historyModal.close}
        history={history}
        onLoad={handleLoadFromHistory}
        onDelete={handleDeleteHistory}
        onClear={handleClearHistory}
        onSaveAsGroup={handleHistoryEntryToGroup}
      />
      {asm.compositionContextMenu &&
        (() => {
          const { email, isUnknown, x, y } = asm.compositionContextMenu;
          return (
            <ContextMenu
              x={x}
              y={y}
              onClose={() => asm.setCompositionContextMenu(null)}
              items={[
                ...(isUnknown
                  ? [
                      {
                        label: 'Save to Contacts',
                        onClick: () => {
                          asm.handleAddToContacts(email);
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
                    setGroupSelectorEmail(email);
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
                    onRemoveManual(email);
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
          );
        })()}
      <Modal
        isOpen={Boolean(groupSelectorEmail)}
        onClose={() => setGroupSelectorEmail(null)}
        title="Manage Groups"
        variant="confirmation"
      >
        {groupSelectorEmail && (
          <GroupSelector
            contact={{ email: groupSelectorEmail }}
            groups={groups}
            onClose={() => setGroupSelectorEmail(null)}
          />
        )}
      </Modal>
    </div>
  );
};
