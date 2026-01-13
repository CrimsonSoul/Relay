import React, { useState, useCallback, useMemo } from "react";
import { BridgeGroup, Contact, BridgeHistoryEntry } from "@shared/ipc";
import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import { AddContactModal } from "../components/AddContactModal";
import { TactileButton } from "../components/TactileButton";
import { ContextMenu } from "../components/ContextMenu";
import { CollapsibleHeader } from "../components/CollapsibleHeader";
import { AssemblerTabProps, VirtualRow, AssemblerSidebar, BridgeReminderModal, SaveGroupModal, BridgeHistoryModal, HistoryNotePrompt } from "./assembler";
import { useAssembler } from "../hooks/useAssembler";
import { useGroups } from "../hooks/useGroups";
import { useBridgeHistory } from "../hooks/useBridgeHistory";
import { useToast } from "../components/Toast";

export const AssemblerTab: React.FC<AssemblerTabProps> = (props) => {
  const { groups, contacts, selectedGroupIds, onToggleGroup, onRemoveManual, onResetManual, onUndoRemove, manualRemoves, manualAdds, setSelectedGroupIds, setManualAdds } = props;
  const asm = useAssembler(props);
  const { showToast } = useToast();
  const { saveGroup, updateGroup, deleteGroup, importFromCsv } = useGroups();
  const { history, addHistory, deleteHistory, clearHistory } = useBridgeHistory();
  const [isSaveGroupOpen, setIsSaveGroupOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyNotePrompt, setHistoryNotePrompt] = useState<{ emails: string[]; groupNames: string[] } | null>(null);

  // Create a map of group ID to group for quick lookups
  const groupMap = useMemo(() => {
    const map = new Map<string, BridgeGroup>();
    groups.forEach(g => map.set(g.id, g));
    return map;
  }, [groups]);

  // Get selected group names for history
  const selectedGroupNames = useMemo(() => {
    return selectedGroupIds
      .map(id => groupMap.get(id)?.name)
      .filter((name): name is string => !!name);
  }, [selectedGroupIds, groupMap]);

  // Handle saving current selection as group
  const handleSaveGroup = useCallback(async (name: string) => {
    const result = await saveGroup({
      name,
      contacts: asm.log.map(l => l.email),
    });
    if (result) {
      showToast(`Saved group: ${name}`, "success");
    } else {
      showToast("Failed to save group", "error");
    }
  }, [saveGroup, asm.log, showToast]);

  // Handle copy with history logging
  const handleCopyWithHistory = useCallback(() => {
    asm.handleCopy();
    // Store current composition for history note prompt
    setHistoryNotePrompt({
      emails: asm.log.map(l => l.email),
      groupNames: selectedGroupNames,
    });
  }, [asm, selectedGroupNames]);

  // Handle adding to history (with or without note)
  const handleAddToHistory = useCallback(async (note: string) => {
    if (!historyNotePrompt) return;
    await addHistory({
      note,
      groups: historyNotePrompt.groupNames,
      contacts: historyNotePrompt.emails,
      recipientCount: historyNotePrompt.emails.length,
    });
    setHistoryNotePrompt(null);
  }, [addHistory, historyNotePrompt]);

  // Handle loading from history
  const handleLoadFromHistory = useCallback((entry: BridgeHistoryEntry) => {
    onResetManual();
    // Find groups by name and select them
    if (setSelectedGroupIds) {
      const matchingGroupIds = groups
        .filter(g => entry.groups.includes(g.name))
        .map(g => g.id);
      setSelectedGroupIds(matchingGroupIds);
    }
    // For history, contacts contains all emails, but we only add as manual those not in selected groups
    const groupEmails = new Set(
      groups
        .filter(g => entry.groups.includes(g.name))
        .flatMap(g => g.contacts)
    );
    const manualContacts = entry.contacts.filter(email => !groupEmails.has(email));
    if (setManualAdds && manualContacts.length > 0) {
      setManualAdds(manualContacts);
    }
    showToast("Loaded from history", "success");
  }, [groups, onResetManual, setSelectedGroupIds, setManualAdds, showToast]);

  // Handle saving history entry as group
  const handleSaveHistoryAsGroup = useCallback((entry: BridgeHistoryEntry) => {
    handleLoadFromHistory(entry);
    setIsSaveGroupOpen(true);
  }, [handleLoadFromHistory]);

  // Current emails for the sidebar
  const currentEmails = useMemo(() => asm.log.map(l => l.email), [asm.log]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: asm.isGroupSidebarCollapsed ? "24px 1fr" : "240px 1fr", gap: "0px", height: "100%", alignItems: "start", transition: "grid-template-columns 0.4s cubic-bezier(0.16, 1, 0.3, 1)", overflow: "visible" }}>
      <AssemblerSidebar
        groups={groups}
        contacts={contacts}
        selectedGroupIds={selectedGroupIds}
        onToggleGroup={onToggleGroup}
        onQuickAdd={asm.handleQuickAdd}
        isCollapsed={asm.isGroupSidebarCollapsed}
        onToggleCollapse={asm.handleToggleSidebarCollapse}
        onSaveGroup={saveGroup}
        onUpdateGroup={updateGroup}
        onDeleteGroup={deleteGroup}
        onImportFromCsv={importFromCsv}
        currentEmails={currentEmails}
      />
      <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "20px 24px 24px 24px", background: "var(--color-bg-app)", overflow: "hidden", position: "relative", zIndex: 5 }}>
        <CollapsibleHeader title="Data Composition" subtitle="Assemble bridge recipients and manage emergency communications" isCollapsed={asm.isHeaderCollapsed}>
          {manualRemoves.length > 0 && <TactileButton onClick={onUndoRemove} style={{ padding: asm.isHeaderCollapsed ? '8px 14px' : '12px 20px', fontSize: '13px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}>UNDO</TactileButton>}
          <TactileButton onClick={onResetManual} style={{ padding: asm.isHeaderCollapsed ? '8px 14px' : '12px 20px', fontSize: '13px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}>RESET</TactileButton>
          <TactileButton onClick={() => setIsHistoryOpen(true)} style={{ padding: asm.isHeaderCollapsed ? '8px 14px' : '12px 20px', fontSize: '13px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}>HISTORY</TactileButton>
          <TactileButton onClick={handleCopyWithHistory} style={{ padding: asm.isHeaderCollapsed ? '8px 14px' : '12px 20px', fontSize: '13px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}>COPY</TactileButton>
          <TactileButton onClick={() => setIsSaveGroupOpen(true)} style={{ padding: asm.isHeaderCollapsed ? '8px 14px' : '12px 20px', fontSize: '13px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} disabled={asm.log.length === 0}>SAVE GROUP</TactileButton>
          <TactileButton onClick={() => asm.setIsBridgeReminderOpen(true)} variant="primary" style={{ padding: asm.isHeaderCollapsed ? '8px 16px' : '15px 32px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}>DRAFT BRIDGE</TactileButton>
        </CollapsibleHeader>

        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {asm.log.length === 0 ? (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "16px", color: "var(--color-text-tertiary)" }}>
              <div style={{ fontSize: "48px", opacity: 0.1 }}>∅</div>
              <div>No recipients selected</div>
            </div>
          ) : (
            <AutoSizer>
              {({ height, width }) => (<List height={height} itemCount={asm.log.length} itemSize={104} width={width} itemData={asm.itemData} onScroll={({ scrollOffset }) => asm.setIsHeaderCollapsed(scrollOffset > 30)}>{VirtualRow}</List>)}
            </AutoSizer>
          )}
        </div>
      </div>

      <AddContactModal isOpen={asm.isAddContactModalOpen} onClose={() => asm.setIsAddContactModalOpen(false)} initialEmail={asm.pendingEmail} onSave={asm.handleContactSaved} />
      <BridgeReminderModal isOpen={asm.isBridgeReminderOpen} onClose={() => asm.setIsBridgeReminderOpen(false)} onConfirm={asm.executeDraftBridge} />
      <SaveGroupModal
        isOpen={isSaveGroupOpen}
        onClose={() => setIsSaveGroupOpen(false)}
        onSave={handleSaveGroup}
        existingNames={groups.map(g => g.name)}
        title="Save as Group"
        description={`Save current ${asm.log.length} recipients as a reusable group.`}
      />
      <BridgeHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        onLoad={handleLoadFromHistory}
        onDelete={deleteHistory}
        onClear={clearHistory}
        onSaveAsGroup={handleSaveHistoryAsGroup}
      />
      {/* History note prompt - shows after copy */}
      {historyNotePrompt && (
        <HistoryNotePrompt
          onSave={handleAddToHistory}
          onSkip={() => {
            handleAddToHistory("");
          }}
          onCancel={() => setHistoryNotePrompt(null)}
        />
      )}
      {asm.compositionContextMenu && (
        <ContextMenu x={asm.compositionContextMenu.x} y={asm.compositionContextMenu.y} onClose={() => asm.setCompositionContextMenu(null)} items={[
          ...(asm.compositionContextMenu.isUnknown ? [{ label: "Save to Contacts", onClick: () => { asm.handleAddToContacts(asm.compositionContextMenu!.email); asm.setCompositionContextMenu(null); },
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M16 11h6m-3-3v6"></path></svg> }] : []),
          { label: "Remove from List", onClick: () => { onRemoveManual(asm.compositionContextMenu!.email); asm.setCompositionContextMenu(null); }, danger: true,
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> }
        ]} />
      )}
    </div>
  );
};
