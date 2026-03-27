import { useCallback, useMemo } from 'react';
import type { BridgeGroup } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import {
  addGroup as pbAddGroup,
  updateGroup as pbUpdateGroup,
  deleteGroup as pbDeleteGroup,
} from '../services/bridgeGroupService';
import { useCollection } from './useCollection';
import type { BridgeGroupRecord } from '../services/bridgeGroupService';
import { toGroup } from '../utils/transforms';

export function useGroups() {
  const { showToast } = useToast();
  const {
    data: groupRecords,
    loading,
    refetch: reloadGroups,
  } = useCollection<BridgeGroupRecord>('bridge_groups', { sort: 'name' });

  const groups = useMemo(() => groupRecords.map(toGroup), [groupRecords]);

  const saveGroup = useCallback(
    async (group: Omit<BridgeGroup, 'id' | 'createdAt' | 'updatedAt'>) => {
      try {
        const created = await pbAddGroup({ name: group.name, contacts: group.contacts });
        const result = toGroup(created);
        showToast(`Group "${group.name}" saved`, 'success');
        return result;
      } catch (e) {
        loggers.directory.error('Failed to save group', { error: e });
        showToast('Failed to save group', 'error');
        return undefined;
      }
    },
    [showToast],
  );

  const updateGroup = useCallback(
    async (id: string, updates: Partial<Omit<BridgeGroup, 'id' | 'createdAt'>>) => {
      try {
        await pbUpdateGroup(id, {
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.contacts !== undefined ? { contacts: updates.contacts } : {}),
        });
        showToast('Group updated', 'success');
        return true;
      } catch (e) {
        loggers.directory.error('Failed to update group', { error: e });
        showToast('Failed to update group', 'error');
        return false;
      }
    },
    [showToast],
  );

  const deleteGroup = useCallback(
    async (id: string) => {
      try {
        await pbDeleteGroup(id);
        showToast('Group deleted', 'success');
        return true;
      } catch (e) {
        loggers.directory.error('Failed to delete group', { error: e });
        showToast('Failed to delete group', 'error');
        return false;
      }
    },
    [showToast],
  );

  return {
    groups,
    loading,
    saveGroup,
    updateGroup,
    deleteGroup,
    reloadGroups,
  };
}
