import { SdpBridgePanel } from '../features/tickets/SdpRelationships';
import React, { useState, useCallback, useMemo } from 'react';
import { BridgeHistoryEntry } from '@shared/ipc';
import { AddContactModal } from '../components/AddContactModal';
import { TactileButton } from '../components/TactileButton';
import { ConfirmModal } from '../components/ConfirmModal';
import { formatHistoryDate } from '../components/HistoryModal';
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
import { getVacantOnCallTeams, resolveOnCallBridgeCandidates } from '../utils/onCallRoles';
import {
  TEAMS_BRIDGE_LABEL,
  TEAMS_BRIDGE_TOOLTIP,
  getCopyRecipientsBlockedReason,
} from './assembler/bridgeHandoff';
import { useAssembler } from '../hooks/useAssembler';
import { useGroups } from '../hooks/useGroups';
import { useBridgeHistory } from '../hooks/useBridgeHistory';
import { useBridgeHandoffHistory } from '../hooks/useBridgeHandoffHistory';
import { useToast } from '../components/Toast';
import { formatFailure } from '../utils/failureMessage';
import {
  getTabCommandShortcut,
  useTabCommandRequests,
  useTabCommandShortcuts,
} from '../hooks/useTabCommandShortcuts';
import { useModalState } from '../hooks/useModalState';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from '../components/tab-chrome/TabChrome';

const COPY_REASON_ID = 'assembler-copy-blocked-reason';
const EMPTY_BRIDGE_REASON_ID = 'assembler-empty-bridge-reason';
const EMPTY_BRIDGE_REASON = 'Add recipients first';

function formatRecipientCount(count: number): string {
  return `${count} ${count === 1 ? 'recipient' : 'recipients'}`;
}

/**
 * The pane header's recipient count. The live region stays mounted (DESIGN.md "Live regions") but
 * is empty at zero: the recipients empty state already says there are none.
 */
function RecipientCountStatus({ count }: Readonly<{ count: number }>) {
  return <span role="status">{count > 0 ? formatRecipientCount(count) : ''}</span>;
}

/** A bridge action's hover text: what it does, or why it is unavailable while the bridge is empty. */
function bridgeActionTooltip(hasRecipients: boolean, liveTooltip: string): string {
  return hasRecipients ? liveTooltip : EMPTY_BRIDGE_REASON;
}

type CompositionMenuTarget = { email: string; isUnknown: boolean; x: number; y: number };

/** Right-click menu for one recipient; each action closes the menu after it runs. */
function CompositionContextMenu({
  menu,
  onClose,
  onSaveContact,
  onManageGroups,
  onRemove,
}: Readonly<{
  menu: CompositionMenuTarget;
  onClose: () => void;
  onSaveContact: (email: string) => void;
  onManageGroups: (email: string) => void;
  onRemove: (email: string) => void;
}>) {
  const { email, isUnknown, x, y } = menu;
  const runAndClose = (action: (email: string) => void) => () => {
    action(email);
    onClose();
  };
  const saveContactItem = {
    label: 'Save to Contacts',
    onClick: runAndClose(onSaveContact),
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
  };
  return (
    <ContextMenu
      x={x}
      y={y}
      onClose={onClose}
      items={[
        ...(isUnknown ? [saveContactItem] : []),
        {
          label: 'Manage Groups',
          onClick: runAndClose(onManageGroups),
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
          onClick: runAndClose(onRemove),
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
}

export const AssemblerTab: React.FC<AssemblerTabProps> = (props) => {
  const {
    groups,
    selectedGroupIds,
    onToggleGroup,
    onAddManual,
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
  const { saveGroup, updateGroup, deleteGroup } = useGroups(groups);
  const { history, addHistory, deleteHistory, clearHistory } = useBridgeHistory();
  const historyModal = useModalState();
  // SaveGroupModal is only opened from bridge history "Save as Group" action
  const saveGroupModal = useModalState();
  const scheduleBridgeModal = useModalState();
  const handoffModal = useModalState();
  const [historyContacts, setHistoryContacts] = useState<string[]>([]);
  const [handoffSubject, setHandoffSubject] = useState('');
  const [groupSelectorEmail, setGroupSelectorEmail] = useState<string | null>(null);
  const [pendingHistoryEntry, setPendingHistoryEntry] = useState<BridgeHistoryEntry | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const { saveSuccessfulHandoff, forgetSuccessfulHandoff } = useBridgeHandoffHistory(addHistory);

  const selectedGroupNames = asm.handoffSummary.groupNames;

  // On-call people not yet on the bridge, offered as one-click adds. They stay offered until each
  // is a recipient, so paging the whole rotation never falls back to typing names.
  const onCallSuggestions = useMemo(() => {
    const recipients = new Set(asm.allRecipients.map((r) => r.email.trim().toLowerCase()));
    return resolveOnCallBridgeCandidates(props.onCall, props.contacts).filter(
      (candidate) => !recipients.has(candidate.email.toLowerCase()),
    );
  }, [asm.allRecipients, props.contacts, props.onCall]);
  // Uncovered teams are listed beside the quick adds, so a bridge never silently misses them.
  const vacantOnCallTeams = useMemo(() => getVacantOnCallTeams(props.onCall), [props.onCall]);

  const handleAddAllOnCall = useCallback(() => {
    for (const suggestion of onCallSuggestions) onAddManual(suggestion.email);
    showToast(
      `Added ${onCallSuggestions.length} on-call ${onCallSuggestions.length === 1 ? 'person' : 'people'} to the bridge`,
      'success',
    );
  }, [onAddManual, onCallSuggestions, showToast]);

  const currentSnapshot = useMemo(
    () => ({
      contacts: asm.handoffSummary.recipients.map((recipient) => recipient.email),
      groups: selectedGroupNames,
    }),
    [asm.handoffSummary.recipients, selectedGroupNames],
  );

  const saveAfterSuccess = useCallback(
    async (handedOff: string) => {
      // History writes are deduplicated by composition fingerprint, so Retry cannot add a second entry
      // for a save that already landed.
      const attempt = async (): Promise<void> => {
        try {
          await saveSuccessfulHandoff(currentSnapshot);
        } catch (error_) {
          showToast(
            formatFailure({
              what: "Couldn't save this bridge to history",
              error: error_,
              outcome: handedOff,
            }),
            'error',
            { action: { label: 'Retry', onClick: () => void attempt() } },
          );
        }
      };
      await attempt();
    },
    [currentSnapshot, saveSuccessfulHandoff, showToast],
  );

  // Save a history entry as a group. useGroups reports success or failure; rethrowing keeps the
  // Save as Group dialog open with the name so the operator can retry.
  const handleSaveHistoryAsGroup = useCallback(
    async (name: string) => {
      const result = await saveGroup({
        name,
        contacts: historyContacts,
      });
      if (!result) throw new Error(`Could not save group ${name}.`);
    },
    [saveGroup, historyContacts],
  );

  const handleCopyWithHistory = useCallback(async () => {
    if (await asm.handleCopy()) await saveAfterSuccess('The recipients were copied.');
  }, [asm, saveAfterSuccess]);

  const handleTeamsWithHistory = useCallback(async () => {
    if (!(await asm.executeDraftBridge(handoffSubject))) return;
    handoffModal.close();
    await saveAfterSuccess('The Teams bridge draft was opened.');
  }, [asm, handoffModal, handoffSubject, saveAfterSuccess]);

  const handleOpenHandoffReview = useCallback(() => {
    setHandoffSubject(props.ticketBridge?.subject ?? asm.prepareDraftBridgeSubject());
    handoffModal.open();
  }, [asm, handoffModal, props.ticketBridge]);

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

  // Snapshot the composition before it is cleared or replaced; the returned toast option restores
  // it. Undefined when there was nothing to restore or the parent cannot restore groups and adds.
  const snapshotCompositionUndo = useCallback(() => {
    const previous = {
      groupIds: [...selectedGroupIds],
      adds: [...manualAdds],
      removes: [...manualRemoves],
    };
    const hadComposition =
      previous.groupIds.length > 0 || previous.adds.length > 0 || previous.removes.length > 0;
    if (!hadComposition || !setSelectedGroupIds || !setManualAdds) return undefined;
    return {
      action: {
        label: 'Undo',
        onClick: () => {
          onResetManual();
          setSelectedGroupIds(previous.groupIds);
          setManualAdds(previous.adds);
          for (const email of previous.removes) onRemoveManual(email);
        },
      },
    };
  }, [
    manualAdds,
    manualRemoves,
    onResetManual,
    onRemoveManual,
    selectedGroupIds,
    setSelectedGroupIds,
    setManualAdds,
  ]);

  // Replace the composition with a history entry, offering Undo when something was replaced
  const applyHistoryEntry = useCallback(
    (entry: BridgeHistoryEntry) => {
      const undo = snapshotCompositionUndo();
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
        groups
          .filter((g) => entry.groups.includes(g.name))
          .flatMap((g) => g.contacts)
          .map((email) => email.trim().toLowerCase()),
      );
      const manualContacts = entry.contacts.filter(
        (email) => !groupEmails.has(email.trim().toLowerCase()),
      );
      if (setManualAdds && manualContacts.length > 0) {
        setManualAdds(manualContacts);
      }
      const savedEmails = new Set(entry.contacts.map((email) => email.trim().toLowerCase()));
      for (const email of groupEmails) {
        if (!savedEmails.has(email)) onRemoveManual(email);
      }
      showToast('Loaded from history', 'success', undo);
    },
    [
      groups,
      onResetManual,
      onRemoveManual,
      setSelectedGroupIds,
      setManualAdds,
      showToast,
      snapshotCompositionUndo,
    ],
  );

  // Clear Bridge empties groups and recipients at once; the toast's Undo restores all of it.
  const handleClearBridge = useCallback(() => {
    const count = asm.allRecipients.length;
    const undo = snapshotCompositionUndo();
    onResetManual();
    showToast(`Cleared the bridge (${formatRecipientCount(count)})`, 'success', undo);
  }, [asm.allRecipients.length, onResetManual, showToast, snapshotCompositionUndo]);

  // Loading a history entry replaces the composition, so ask first when there is one
  const handleLoadFromHistory = useCallback(
    (entry: BridgeHistoryEntry) => {
      if (asm.allRecipients.length > 0) {
        setPendingHistoryEntry(entry);
        return;
      }
      applyHistoryEntry(entry);
    },
    [applyHistoryEntry, asm.allRecipients.length],
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
  const canClearBridge =
    hasRecipients ||
    selectedGroupIds.length > 0 ||
    manualAdds.length > 0 ||
    manualRemoves.length > 0;
  const copyBlockedReason = getCopyRecipientsBlockedReason(asm.handoffSummary);
  const canCopy = copyBlockedReason === null && !asm.isOpeningTeams;
  const canStartMeeting = hasRecipients && !asm.isCopying;
  // Disabled bridge actions give their reason in the hover tooltip and, for assistive technology,
  // through an sr-only description; nothing is printed beside the buttons.
  const copyReasonRef = copyBlockedReason === null ? undefined : COPY_REASON_ID;
  const emptyBridgeReasonRef = hasRecipients ? undefined : EMPTY_BRIDGE_REASON_ID;
  const copyShortcut = getTabCommandShortcut('C');
  const meetingShortcut = getTabCommandShortcut('M');
  useTabCommandShortcuts({
    C: canCopy && !asm.isCopying ? () => void handleCopyWithHistory() : null,
    M: canStartMeeting ? handleOpenHandoffReview : null,
  });
  useTabCommandRequests({ 'clear-bridge': canClearBridge ? handleClearBridge : null });

  const pendingHistoryMessage = pendingHistoryEntry
    ? `Load the bridge from ${formatHistoryDate(pendingHistoryEntry.timestamp)} with ${formatRecipientCount(
        pendingHistoryEntry.recipientCount,
      )}. Your current groups and manual changes will be replaced.`
    : '';

  return (
    <div className="tab-layout assembler-tab">
      {props.ticketBridge && (
        <SdpBridgePanel
          context={props.ticketBridge}
          onClose={() => props.onClearTicketBridge?.()}
          onUseGroups={(ids) => setSelectedGroupIds?.([...new Set([...selectedGroupIds, ...ids])])}
        />
      )}
      <TabPageHeader title="Compose" subtitle="Bridge recipients" />

      <TabCommandBar ariaLabel="Compose actions" className="assembler-command-bar">
        <CollapsibleHeader isCollapsed={asm.isHeaderCollapsed}>
          <TabCommandGroup kind="utility">
            <TactileButton
              variant="secondary"
              className="assembler-utility-action"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                historyModal.open();
              }}
              tooltip="Open bridge history"
              tooltipPosition="bottom"
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
            {/* Quiet ghost utility (DESIGN: reset utilities are ghost buttons), so it never reads
                as History's twin; its Undo toast restores everything it cleared. */}
            <TactileButton
              variant="ghost"
              className="assembler-utility-action assembler-clear-bridge"
              onClick={handleClearBridge}
              disabled={!canClearBridge}
              tooltip="Clear groups and recipients"
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
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              }
            >
              Clear Bridge
            </TactileButton>
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
          </TabCommandGroup>
          <TabCommandGroup kind="workflow">
            <div className="assembler-bridge-actions">
              {copyBlockedReason && (
                <span id={COPY_REASON_ID} className="sr-only">
                  {copyBlockedReason}
                </span>
              )}
              {!hasRecipients && (
                <span id={EMPTY_BRIDGE_REASON_ID} className="sr-only">
                  {EMPTY_BRIDGE_REASON}
                </span>
              )}
              <TactileButton
                onClick={() => void handleCopyWithHistory()}
                disabled={!canCopy}
                loading={asm.isCopying}
                tooltip={`${copyBlockedReason ?? 'Copy every recipient address'} (${copyShortcut.label})`}
                aria-keyshortcuts={copyShortcut.aria}
                aria-describedby={copyReasonRef}
              >
                Copy Recipients
                <kbd className="tab-command-kbd" aria-hidden="true">
                  {copyShortcut.label}
                </kbd>
              </TactileButton>
              <TactileButton
                onClick={handleOpenHandoffReview}
                variant="primary"
                disabled={!canStartMeeting}
                tooltip={`${bridgeActionTooltip(hasRecipients, TEAMS_BRIDGE_TOOLTIP)} (${meetingShortcut.label})`}
                aria-keyshortcuts={meetingShortcut.aria}
                aria-describedby={emptyBridgeReasonRef}
              >
                {TEAMS_BRIDGE_LABEL}
                <kbd className="tab-command-kbd" aria-hidden="true">
                  {meetingShortcut.label}
                </kbd>
              </TactileButton>
              <TactileButton
                aria-label="More Compose Actions"
                tooltip={bridgeActionTooltip(
                  hasRecipients,
                  'More Compose Actions: Schedule Bridge…',
                )}
                aria-haspopup="menu"
                aria-expanded={moreMenu !== null}
                disabled={!hasRecipients}
                aria-describedby={emptyBridgeReasonRef}
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
              <RecipientCountStatus count={asm.allRecipients.length} />
            </div>
            {/* Nothing to sort until recipients exist, so the sort control appears with them. */}
            {hasRecipients && (
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
              </div>
            )}
          </div>
          <div className="tab-list-container">
            <CompositionList
              log={asm.log}
              itemData={asm.itemData}
              onScroll={(scrollOffset) => asm.setIsHeaderCollapsed(scrollOffset > 30)}
              hasGroups={groups.length > 0}
              onCallSuggestions={onCallSuggestions}
              onAddSuggestion={asm.handleQuickAdd}
              onAddAllSuggestions={handleAddAllOnCall}
              vacantOnCallTeams={vacantOnCallTeams}
              onAssignOnCall={props.onOpenOnCall}
            />
          </div>
        </section>
      </div>

      <StatusBar left={<StatusBarLive />} />

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
        defaultSubject={props.ticketBridge?.subject}
      />
      {moreMenu && (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          onClose={() => setMoreMenu(null)}
          items={[{ label: 'Schedule Bridge…', onClick: scheduleBridgeModal.open }]}
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
        title="Save as group"
        contacts={historyContacts}
      />
      <BridgeHistoryModal
        isOpen={historyModal.isOpen}
        onClose={historyModal.close}
        history={history}
        contactMap={asm.contactMap}
        onLoad={handleLoadFromHistory}
        onDelete={handleDeleteHistory}
        onClear={handleClearHistory}
        onSaveAsGroup={handleHistoryEntryToGroup}
      />
      <ConfirmModal
        isOpen={pendingHistoryEntry !== null}
        onClose={() => setPendingHistoryEntry(null)}
        onConfirm={() => {
          if (pendingHistoryEntry) applyHistoryEntry(pendingHistoryEntry);
        }}
        title={`Replace current ${formatRecipientCount(asm.allRecipients.length)}?`}
        message={pendingHistoryMessage}
        confirmLabel="Replace"
      />
      {asm.compositionContextMenu && (
        <CompositionContextMenu
          menu={asm.compositionContextMenu}
          onClose={() => asm.setCompositionContextMenu(null)}
          onSaveContact={asm.handleAddToContacts}
          onManageGroups={setGroupSelectorEmail}
          onRemove={onRemoveManual}
        />
      )}
      <Modal
        isOpen={Boolean(groupSelectorEmail)}
        onClose={() => setGroupSelectorEmail(null)}
        title="Manage groups"
        variant="confirmation"
      >
        {groupSelectorEmail && (
          <GroupSelector contact={{ email: groupSelectorEmail }} groups={groups} />
        )}
      </Modal>
    </div>
  );
};
