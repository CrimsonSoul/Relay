import { useState, useEffect, useCallback } from "react";
import type { BridgeGroup } from "@shared/ipc";

export function useGroups() {
  const [groups, setGroups] = useState<BridgeGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const loadGroups = useCallback(async () => {
    try {
      const data = await window.api?.getGroups();
      setGroups(data || []);
    } catch (e) {
      console.error("Failed to load groups:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const saveGroup = useCallback(
    async (group: Omit<BridgeGroup, "id" | "createdAt" | "updatedAt">) => {
      const result = await window.api?.saveGroup(group);
      if (result) {
        setGroups((prev) => [...prev, result]);
      }
      return result;
    },
    []
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
      }
      return success;
    },
    []
  );

  const deleteGroup = useCallback(async (id: string) => {
    const success = await window.api?.deleteGroup(id);
    if (success) {
      setGroups((prev) => prev.filter((g) => g.id !== id));
    }
    return success;
  }, []);

  const importFromCsv = useCallback(async () => {
    const success = await window.api?.importGroupsFromCsv();
    if (success) {
      await loadGroups();
    }
    return success;
  }, [loadGroups]);

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
