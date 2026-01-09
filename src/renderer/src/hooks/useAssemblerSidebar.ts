import { useState, useCallback, useMemo } from "react";
import { GroupMap } from "@shared/ipc";

interface GroupContextMenu { x: number; y: number; group: string }
interface SidebarContextMenu { x: number; y: number }

export function useAssemblerSidebar(groups: GroupMap) {
  const [groupContextMenu, setGroupContextMenu] = useState<GroupContextMenu | null>(null);
  const [sidebarContextMenu, setSidebarContextMenu] = useState<SidebarContextMenu | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);
  const [groupToRename, setGroupToRename] = useState<string | null>(null);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);

  const sortedGroupKeys = useMemo(() => Object.keys(groups).sort(), [groups]);

  const handleGroupContextMenu = useCallback((e: React.MouseEvent, group: string) => {
    e.preventDefault();
    setGroupContextMenu({ x: e.clientX, y: e.clientY, group });
  }, []);

  const handleSidebarContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!groupContextMenu) setSidebarContextMenu({ x: e.clientX, y: e.clientY });
  }, [groupContextMenu]);

  return {
    groupContextMenu, setGroupContextMenu, sidebarContextMenu, setSidebarContextMenu,
    groupToDelete, setGroupToDelete, groupToRename, setGroupToRename,
    isGroupModalOpen, setIsGroupModalOpen, sortedGroupKeys,
    handleGroupContextMenu, handleSidebarContextMenu
  };
}
