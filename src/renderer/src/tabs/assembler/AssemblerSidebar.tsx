import React from "react";
import { GroupMap, Contact } from "@shared/ipc";
import { SidebarItem } from "../../components/SidebarItem";
import { ContextMenu } from "../../components/ContextMenu";
import { QuickAddInput } from "./QuickAddInput";
import { CreateGroupModal } from "./CreateGroupModal";
import { DeleteGroupModal } from "./DeleteGroupModal";
import { RenameGroupModal } from "./RenameGroupModal";
import { SidebarToggleHandle } from "./SidebarToggleHandle";
import { useAssemblerSidebar } from "../../hooks/useAssemblerSidebar";

type AssemblerSidebarProps = { groups: GroupMap; contacts: Contact[]; selectedGroups: string[]; onToggleGroup: (group: string) => void; onQuickAdd: (email: string) => void; isCollapsed: boolean; onToggleCollapse: () => void };

export const AssemblerSidebar: React.FC<AssemblerSidebarProps> = ({ groups, contacts, selectedGroups, onToggleGroup, onQuickAdd, isCollapsed, onToggleCollapse }) => {
  const sb = useAssemblerSidebar(groups);

  return (
    <>
      <div onContextMenu={sb.handleSidebarContextMenu} style={{ display: "flex", padding: "0", height: "100%", position: "relative", background: "transparent", zIndex: 20 }}>
        <div style={{ display: "flex", height: "100%", width: "100%", overflow: "visible", justifyContent: "flex-end" }}>
          <div style={{ width: "216px", display: "flex", flexDirection: "column", overflow: "hidden", opacity: isCollapsed ? 0 : 1, visibility: isCollapsed ? "hidden" : "visible", transition: "opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.4s", flexShrink: 0 }}>
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "40px 20px 16px 20px", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <QuickAddInput contacts={contacts} onQuickAdd={onQuickAdd} />
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, marginTop: "16px", width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", height: "24px", marginBottom: "12px", padding: "0" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "0.02em", textTransform: "capitalize" }}>Groups</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  {sb.sortedGroupKeys.map((g) => <SidebarItem key={g} label={g} count={groups[g].length} active={selectedGroups.includes(g)} onClick={onToggleGroup} onContextMenu={sb.handleGroupContextMenu} />)}
                  {sb.sortedGroupKeys.length === 0 && <div style={{ color: "var(--color-text-tertiary)", fontSize: "13px", fontStyle: "italic", paddingLeft: "4px" }}>No groups.</div>}
                </div>
              </div>
            </div>
          </div>
          <SidebarToggleHandle isCollapsed={isCollapsed} onToggle={onToggleCollapse} />
        </div>
      </div>

      {sb.groupContextMenu && (
        <ContextMenu x={sb.groupContextMenu.x} y={sb.groupContextMenu.y} onClose={() => sb.setGroupContextMenu(null)} items={[
          { label: "Rename", onClick: () => sb.setGroupToRename(sb.groupContextMenu!.group), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> },
          { label: "Delete Group", onClick: () => sb.setGroupToDelete(sb.groupContextMenu!.group), danger: true, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> }
        ]} />
      )}
      {sb.sidebarContextMenu && (
        <ContextMenu x={sb.sidebarContextMenu.x} y={sb.sidebarContextMenu.y} onClose={() => sb.setSidebarContextMenu(null)} items={[
          { label: "Add New Group", onClick: () => sb.setIsGroupModalOpen(true), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> }
        ]} />
      )}
      <CreateGroupModal isOpen={sb.isGroupModalOpen} onClose={() => sb.setIsGroupModalOpen(false)} />
      <DeleteGroupModal groupName={sb.groupToDelete} onClose={() => sb.setGroupToDelete(null)} selectedGroups={selectedGroups} onToggleGroup={onToggleGroup} />
      <RenameGroupModal groupName={sb.groupToRename} groups={groups} onClose={() => sb.setGroupToRename(null)} selectedGroups={selectedGroups} onToggleGroup={onToggleGroup} />
    </>
  );
};
