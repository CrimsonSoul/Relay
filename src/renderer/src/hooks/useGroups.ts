import { useState, useEffect, useCallback } from 'react';
import type { BridgeGroup } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';

export function useGroups() {
  const { showToast } = useToast();
  const [groups, setGroups] = useState<BridgeGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const loadGroups = useCallback(async () => {
    try {
      setLoading(true);
      const data = await globalThis.api?.getGroups();
      setGroups(data || []);
    } catch (e) {
      loggers.directory.error('Failed to load groups', { error: e });
      showToast('Failed to load groups', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadGroups().catch((error_) => {
      loggers.directory.error('Failed to run initial group load', { error: error_ });
    });
  }, [loadGroups]);

  const saveGroup = useCallback(
    async (group: Omit<BridgeGroup, 'id' | 'createdAt' | 'updatedAt'>) => {
      const result = await globalThis.api?.saveGroup(group);
      if (result?.success && result.data) {
        setGroups((prev) => [...prev, result.data!]);
        showToast(`Group "${group.name}" saved`, 'success');
        return result.data;
      } else {
        showToast('Failed to save group', 'error');
        return undefined;
      }
    },
    [showToast],
  );

  const updateGroup = useCallback(
    async (id: string, updates: Partial<Omit<BridgeGroup, 'id' | 'createdAt'>>) => {
      const result = await globalThis.api?.updateGroup(id, updates);
      if (result?.success) {
        setGroups((prev) =>
          prev.map((g) => (g.id === id ? { ...g, ...updates, updatedAt: Date.now() } : g)),
        );
        showToast('Group updated', 'success');
        return true;
      } else {
        showToast('Failed to update group', 'error');
        return false;
      }
    },
    [showToast],
  );

  const deleteGroup = useCallback(
    async (id: string) => {
      const result = await globalThis.api?.deleteGroup(id);
      if (result?.success) {
        setGroups((prev) => prev.filter((g) => g.id !== id));
        showToast('Group deleted', 'success');
        return true;
      } else {
        showToast('Failed to delete group', 'error');
        return false;
      }
    },
    [showToast],
  );

  const importFromCsv = useCallback(async () => {
    const result = await globalThis.api?.importGroupsFromCsv();
    if (result?.success) {
      await loadGroups();
      showToast('Import successful', 'success');
      return true;
    } else if (result) {
      showToast(result.error || 'Import failed', 'error');
    } else {
      showToast('Import failed', 'error');
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
