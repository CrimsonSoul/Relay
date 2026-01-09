import React from "react";
import { GroupMap, Contact } from "@shared/ipc";
import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import { AddContactModal } from "../components/AddContactModal";
import { TactileButton } from "../components/TactileButton";
import { ContextMenu } from "../components/ContextMenu";
import { CollapsibleHeader } from "../components/CollapsibleHeader";
import { AssemblerTabProps, VirtualRow, AssemblerSidebar, BridgeReminderModal } from "./assembler";
import { useAssembler } from "../hooks/useAssembler";

export const AssemblerTab: React.FC<AssemblerTabProps> = (props) => {
  const { groups, contacts, selectedGroups, onToggleGroup, onRemoveManual, onResetManual, onUndoRemove, manualRemoves } = props;
  const asm = useAssembler(props);

  return (
    <div style={{ display: "grid", gridTemplateColumns: asm.isGroupSidebarCollapsed ? "24px 1fr" : "240px 1fr", gap: "0px", height: "100%", alignItems: "start", transition: "grid-template-columns 0.4s cubic-bezier(0.16, 1, 0.3, 1)", overflow: "visible" }}>
      <AssemblerSidebar groups={groups} contacts={contacts} selectedGroups={selectedGroups} onToggleGroup={onToggleGroup} onQuickAdd={asm.handleQuickAdd} isCollapsed={asm.isGroupSidebarCollapsed} onToggleCollapse={asm.handleToggleSidebarCollapse} />
      <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "20px 24px 24px 24px", background: "var(--color-bg-app)", overflow: "hidden", position: "relative", zIndex: 5 }}>
        <CollapsibleHeader title="Data Composition" subtitle="Assemble bridge recipients and manage emergency communications" isCollapsed={asm.isHeaderCollapsed}>
          {manualRemoves.length > 0 && <TactileButton onClick={onUndoRemove} style={{ padding: asm.isHeaderCollapsed ? '8px 14px' : '12px 20px', fontSize: '13px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}>UNDO</TactileButton>}
          <TactileButton onClick={onResetManual} style={{ padding: asm.isHeaderCollapsed ? '8px 14px' : '12px 20px', fontSize: '13px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}>RESET</TactileButton>
          <TactileButton onClick={asm.handleCopy} style={{ padding: asm.isHeaderCollapsed ? '8px 14px' : '12px 20px', fontSize: '13px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}>COPY</TactileButton>
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
