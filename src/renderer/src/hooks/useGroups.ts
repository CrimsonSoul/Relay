import { useCallback } from 'react';
import type { BridgeGroup } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import { formatFailure } from '../utils/failureMessage';
import {
  addGroup as pbAddGroup,
  updateGroup as pbUpdateGroup,
  deleteGroup as pbDeleteGroup,
} from '../services/bridgeGroupService';
import { toGroup } from '../utils/transforms';

type GroupUpdates = Partial<Omit<BridgeGroup, 'id' | 'createdAt'>>;

const memberCount = (count: number) => `${count} ${count === 1 ? 'member' : 'members'}`;

function describeUpdate(label: string, updates: GroupUpdates): { done: string; failed: string } {
  if (updates.name !== undefined) {
    return {
      done: `Renamed ${label} to ${updates.name}`,
      failed: `Couldn't rename ${label} to ${updates.name}`,
    };
  }
  if (updates.contacts !== undefined) {
    return {
      done: `Replaced the members of ${label} (${memberCount(updates.contacts.length)})`,
      failed: `Couldn't replace the members of ${label}`,
    };
  }
  return { done: `Updated ${label}`, failed: `Couldn't update ${label}` };
}

const NO_GROUPS: readonly BridgeGroup[] = [];

/**
 * Bridge group writes with toast feedback. `groups` lets the toasts name the group being renamed,
 * updated, or deleted; without it they fall back to "the group".
 */
export function useGroups(groups: readonly BridgeGroup[] = NO_GROUPS) {
  const { showToast } = useToast();
  const labelOf = useCallback(
    (id: string) => {
      const name = groups.find((group) => group.id === id)?.name;
      return name ? `group ${name}` : 'the group';
    },
    [groups],
  );

  const saveGroup = useCallback(
    async (group: Omit<BridgeGroup, 'id' | 'createdAt' | 'updatedAt'>) => {
      try {
        const created = await pbAddGroup({ name: group.name, contacts: group.contacts });
        const result = toGroup(created);
        showToast(`Saved group ${group.name} (${memberCount(group.contacts.length)})`, 'success');
        return result;
      } catch (e) {
        loggers.directory.error('Failed to save group', { error: e });
        showToast(
          formatFailure({
            what: `Couldn't save group ${group.name}`,
            error: e,
            outcome: 'Nothing changed.',
          }),
          'error',
        );
        return undefined;
      }
    },
    [showToast],
  );

  const updateGroup = useCallback(
    async (id: string, updates: GroupUpdates) => {
      const copy = describeUpdate(labelOf(id), updates);
      try {
        await pbUpdateGroup(id, {
          ...(updates.name === undefined ? {} : { name: updates.name }),
          ...(updates.contacts === undefined ? {} : { contacts: updates.contacts }),
        });
        showToast(copy.done, 'success');
        return true;
      } catch (e) {
        loggers.directory.error('Failed to update group', { error: e });
        showToast(
          formatFailure({ what: copy.failed, error: e, outcome: 'Nothing changed.' }),
          'error',
        );
        return false;
      }
    },
    [labelOf, showToast],
  );

  const deleteGroup = useCallback(
    async (id: string) => {
      const label = labelOf(id);
      try {
        await pbDeleteGroup(id);
        showToast(`Deleted ${label}`, 'success');
        return true;
      } catch (e) {
        loggers.directory.error('Failed to delete group', { error: e });
        showToast(
          formatFailure({
            what: `Couldn't delete ${label}`,
            error: e,
            outcome: 'Nothing changed.',
          }),
          'error',
        );
        return false;
      }
    },
    [labelOf, showToast],
  );

  return {
    saveGroup,
    updateGroup,
    deleteGroup,
  };
}
