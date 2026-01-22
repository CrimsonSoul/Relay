import { useState, useEffect, useCallback } from "react";
import type { BridgeGroup } from "@shared/ipc";
import { useToast } from "../components/Toast";

export function useGroups() {
  const { showToast } = useToast();
  const [groups, setGroups] = useState<BridgeGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const loadGroups = useCallback(async () => {
    try {
      setLoading(true);
      const data = await window.api?.getGroups();
      setGroups(data || []);
    } catch (e) {
      console.error("Failed to load groups:", e);
      showToast("Failed to load groups", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const saveGroup = useCallback(
    async (group: Omit<BridgeGroup, "id" | "createdAt" | "updatedAt">) => {
      const result = await window.api?.saveGroup(group);
      if (result) {
        setGroups((prev) => [...prev, result]);
        showToast(`Group "${group.name}" saved`, "success");
      } else {
        showToast("Failed to save group", "error");
      }
      return result;
    },
    [showToast]
  );

  const updateGroup = useCallback(
    async (
      id: string,
      updates: Partial<Omit<BridgeGroup, "id" | "createdAt">>
    ) => {
      const success = await window.api?.updateGroup(id, updates);
      if (success) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === id ? { ...g, ...updates, updatedAt: Date.now() } : g
          )
        );
        showToast("Group updated", "success");
      } else {
        showToast("Failed to update group", "error");
      }
      return success;
    },
    [showToast]
  );

  const deleteGroup = useCallback(async (id: string) => {
    const success = await window.api?.deleteGroup(id);
    if (success) {
      setGroups((prev) => prev.filter((g) => g.id !== id));
      showToast("Group deleted", "success");
    } else {
      showToast("Failed to delete group", "error");
    }
    return success;
  }, [showToast]);

  const importFromCsv = useCallback(async () => {
    const result = await window.api?.importGroupsFromCsv();
    if (result && result.success) {
      await loadGroups();
      showToast(`Imported ${result.count} groups`, "success");
      return true;
    } else if (result) {
      showToast(result.error || "Import failed", "error");
    } else {
      showToast("Import failed", "error");
    }
    return false;
  }, [loadGroups, showToast]);

  return {
    groups,
    loading,
    saveGroup,
    updateGroup,
    deleteGroup,
    importFromCsv,
    reloadGroups: loadGroups,
  };
}
