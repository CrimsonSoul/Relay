import React, { useState, useCallback, useMemo } from "react";
import { BridgeGroup, Contact } from "@shared/ipc";
import { SidebarItem } from "../../components/SidebarItem";
import { ContextMenu } from "../../components/ContextMenu";
import { SidebarToggleHandle } from "./SidebarToggleHandle";
import { SaveGroupModal } from "./SaveGroupModal";
import { loggers } from "../../utils/logger";

type AssemblerSidebarProps = {
  groups: BridgeGroup[];
  contacts?: Contact[];
  selectedGroupIds: string[];
  onToggleGroup: (groupId: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSaveGroup: (group: Omit<BridgeGroup, "id" | "createdAt" | "updatedAt">) => Promise<BridgeGroup | null | undefined>;
  onUpdateGroup: (id: string, updates: Partial<Omit<BridgeGroup, "id" | "createdAt">>) => Promise<boolean | undefined>;
  onDeleteGroup: (id: string) => Promise<boolean | undefined>;
  onImportFromCsv: () => Promise<boolean | undefined>;
  // For updating a group with current selection
  currentEmails?: string[];
};

export const AssemblerSidebar: React.FC<AssemblerSidebarProps> = ({
  groups,
  selectedGroupIds,
  onToggleGroup,
  isCollapsed,
  onToggleCollapse,
  onSaveGroup,
  onUpdateGroup,
  onDeleteGroup,
  onImportFromCsv,
  currentEmails = [],
}) => {
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; group: BridgeGroup } | null>(null);
  const [sidebarContextMenu, setSidebarContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isSaveGroupOpen, setIsSaveGroupOpen] = useState(false);
  const [groupToRename, setGroupToRename] = useState<BridgeGroup | null>(null);

  const sortedGroups = useMemo(() =>
    [...groups].sort((a, b) => a.name.localeCompare(b.name)),
    [groups]
  );

  const handleGroupContextMenu = useCallback((e: React.MouseEvent, groupId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const group = groups.find(g => g.id === groupId);
    if (group) {
      setGroupContextMenu({ x: e.clientX, y: e.clientY, group });
    }
  }, [groups]);

  const handleSidebarContextMenu = useCallback((e: React.MouseEvent) => {
    // Only trigger if clicking on the sidebar background, not on items
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    setSidebarContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleSaveNewGroup = useCallback(async (name: string) => {
    try {
      const result = await onSaveGroup({ name, contacts: currentEmails });
      if (!result) {
        loggers.app.error("[AssemblerSidebar] Failed to save group");
      }
    } catch (e) {
      loggers.app.error("[AssemblerSidebar] Error saving group", { error: e });
    }
  }, [onSaveGroup, currentEmails]);

  const handleRenameGroup = useCallback(async (newName: string) => {
    if (groupToRename) {
      try {
        const success = await onUpdateGroup(groupToRename.id, { name: newName });
        if (!success) {
          loggers.app.error("[AssemblerSidebar] Failed to rename group");
        }
      } catch (e) {
        loggers.app.error("[AssemblerSidebar] Error renaming group", { error: e });
      } finally {
        setGroupToRename(null);
      }
    }
  }, [groupToRename, onUpdateGroup]);

  const handleUpdateGroupWithCurrent = useCallback(async (group: BridgeGroup) => {
    try {
      const success = await onUpdateGroup(group.id, { contacts: currentEmails });
      if (!success) {
        loggers.app.error("[AssemblerSidebar] Failed to update group");
      }
    } catch (e) {
      loggers.app.error("[AssemblerSidebar] Error updating group", { error: e });
    }
  }, [onUpdateGroup, currentEmails]);

  const handleDeleteGroup = useCallback(async (group: BridgeGroup) => {
    try {
      const success = await onDeleteGroup(group.id);
      if (!success) {
        loggers.app.error("[AssemblerSidebar] Failed to delete group");
      }
    } catch (e) {
      loggers.app.error("[AssemblerSidebar] Error deleting group", { error: e });
    }
  }, [onDeleteGroup]);

  const existingNames = useMemo(() => groups.map(g => g.name), [groups]);

  return (
    <>
      <div onContextMenu={handleSidebarContextMenu} style={{ display: "flex", padding: "0", height: "100%", position: "relative", background: "transparent", zIndex: 20 }}>
        <div style={{ display: "flex", height: "100%", width: "100%", overflow: "visible", justifyContent: "flex-end" }}>
          <div style={{ width: "216px", display: "flex", flexDirection: "column", overflow: "hidden", opacity: isCollapsed ? 0 : 1, visibility: isCollapsed ? "hidden" : "visible", transition: "opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.4s", flexShrink: 0 }}>
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "40px 20px 16px 20px", display: "flex", flexDirection: "column", alignItems: "center" }}>
              
              {/* Groups Section */}
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, marginTop: "16px", width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: "24px", marginBottom: "12px", padding: "0" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "0.02em" }}>Groups</div>
                  <button
                    onClick={() => setIsSaveGroupOpen(true)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "4px",
                      cursor: "pointer",
                      color: "var(--color-text-tertiary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "4px",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text-secondary)"; e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-tertiary)"; e.currentTarget.style.background = "transparent"; }}
                    title="Create new group"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  {sortedGroups.map((group) => (
                    <SidebarItem
                      key={group.id}
                      label={group.name}
                      count={group.contacts.length}
                      active={selectedGroupIds.includes(group.id)}
                      onClick={() => onToggleGroup(group.id)}
                      onContextMenu={(e) => handleGroupContextMenu(e, group.id)}
                    />
                  ))}
                  {sortedGroups.length === 0 && (
                    <div style={{ color: "var(--color-text-tertiary)", fontSize: "13px", fontStyle: "italic", paddingLeft: "4px" }}>
                      No groups yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <SidebarToggleHandle isCollapsed={isCollapsed} onToggle={onToggleCollapse} />
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
              label: "Load Group",
              onClick: () => {
                onToggleGroup(groupContextMenu.group.id);
                setGroupContextMenu(null);
              },
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            },
            {
              label: "Update with Current",
              onClick: () => {
                void handleUpdateGroupWithCurrent(groupContextMenu.group);
                setGroupContextMenu(null);
              },
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>,
              disabled: currentEmails.length === 0
            },
            {
              label: "Rename",
              onClick: () => {
                setGroupToRename(groupContextMenu.group);
                setGroupContextMenu(null);
              },
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            },
            {
              label: "Delete Group",
              onClick: () => {
                void handleDeleteGroup(groupContextMenu.group);
                setGroupContextMenu(null);
              },
              danger: true,
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            }
          ]}
        />
      )}

      {/* Sidebar context menu */}
      {sidebarContextMenu && (
        <ContextMenu
          x={sidebarContextMenu.x}
          y={sidebarContextMenu.y}
          onClose={() => setSidebarContextMenu(null)}
          items={[
            {
              label: "Create New Group",
              onClick: () => {
                setIsSaveGroupOpen(true);
                setSidebarContextMenu(null);
              },
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            },
            {
              label: "Import from CSV",
              onClick: () => {
                void onImportFromCsv();
                setSidebarContextMenu(null);
              },
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            }
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
        description={currentEmails.length > 0 ? `Will include ${currentEmails.length} current recipients` : "Create an empty group"}
      />

      {/* Rename Group Modal */}
      <SaveGroupModal
        isOpen={groupToRename !== null}
        onClose={() => setGroupToRename(null)}
        onSave={handleRenameGroup}
        existingNames={existingNames.filter(n => n !== groupToRename?.name)}
        title="Rename Group"
        description={`Rename "${groupToRename?.name || ""}"`}
        initialName={groupToRename?.name || ""}
      />
    </>
  );
};
