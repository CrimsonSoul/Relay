import React, { useState, useEffect, useCallback } from 'react';
import { Contact, BridgeGroup } from '@shared/ipc';
import { loggers } from '../../utils/logger';

interface GroupSelectorProps {
  contact: Contact;
  groups: BridgeGroup[];
  onClose: () => void;
  onError?: (message: string) => void;
}

export const GroupSelector = ({
  contact,
  groups,
  onClose: _onClose,
  onError,
}: GroupSelectorProps) => {
  const [membership, setMembership] = useState<Record<string, boolean>>({});
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    const mem: Record<string, boolean> = {};
    const contactEmail = contact.email.toLowerCase();
    groups.forEach((group) => {
      mem[group.id] = group.contacts.some((e) => e.toLowerCase() === contactEmail);
    });
    setMembership(mem);
  }, [contact, groups]);

  const toggleGroup = useCallback(
    async (group: BridgeGroup, isMember: boolean) => {
      if (updating) return; // Prevent concurrent updates
      const previousState = membership[group.id];
      setMembership((prev) => ({ ...prev, [group.id]: !isMember }));
      setUpdating(group.id);

      try {
        if (!globalThis.api) {
          throw new Error('API not available');
        }

        const contactEmail = contact.email.toLowerCase();
        let newContacts: string[];

        if (isMember) {
          // Remove contact from group
          newContacts = group.contacts.filter((e) => e.toLowerCase() !== contactEmail);
        } else {
          // Add contact to group
          newContacts = [...group.contacts, contact.email];
        }

        const result = await globalThis.api.updateGroup(group.id, { contacts: newContacts });
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to update group');
        }
      } catch (error) {
        // Rollback on failure
        setMembership((prev) => ({ ...prev, [group.id]: previousState ?? false }));
        const message = isMember
          ? `Failed to remove from ${group.name}`
          : `Failed to add to ${group.name}`;
        loggers.directory.error('[GroupSelector] Failed to toggle group membership', { error });
        onError?.(message);
      } finally {
        setUpdating(null);
      }
    },
    [contact, membership, onError, updating],
  );

  return (
    <div className="group-selector">
      <div className="group-selector-list">
        {groups.map((group) => {
          const isUpdating = updating === group.id;
          return (
            <button
              type="button"
              key={group.id}
              aria-pressed={!!membership[group.id]}
              onClick={() => {
                if (!isUpdating) {
                  toggleGroup(group, !!membership[group.id]).catch((error_) => {
                    loggers.directory.error('[GroupSelector] Failed toggling group on click', {
                      error: error_,
                    });
                  });
                }
              }}
              className={`group-selector-item${isUpdating ? ' group-selector-item--updating' : ''}`}
            >
              <div
                className={`group-selector-checkbox${membership[group.id] ? ' group-selector-checkbox--checked' : ''}`}
              >
                {membership[group.id] && <span className="group-selector-checkbox-mark">✓</span>}
              </div>
              {group.name}
            </button>
          );
        })}
        {groups.length === 0 && <div className="group-selector-empty">No groups available</div>}
      </div>
    </div>
  );
};
