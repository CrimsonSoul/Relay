import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Contact, BridgeGroup } from '@shared/ipc';
import { loggers } from '../../utils/logger';
import { updateGroup as pbUpdateGroup } from '../../services/bridgeGroupService';

interface GroupSelectorProps {
  contact: Pick<Contact, 'email'>;
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
  // Saves are tracked per group: a write to one group must not swallow clicks on the
  // others, which is how three rapid picks used to apply only the first one.
  const [updatingGroupIds, setUpdatingGroupIds] = useState<string[]>([]);
  // onError is optional and no production call site passes it, so the failure has to be
  // visible from here or a rejected write is completely silent — the tick just vanishes.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inFlightRef = useRef<Set<string>>(new Set());

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
      // Guard through a ref so two clicks in the same tick cannot both start a write
      if (inFlightRef.current.has(group.id)) return;
      inFlightRef.current.add(group.id);
      setUpdatingGroupIds((prev) => [...prev, group.id]);
      setMembership((prev) => ({ ...prev, [group.id]: !isMember }));
      setErrorMessage(null);

      try {
        const contactEmail = contact.email.toLowerCase();
        const newContacts = isMember
          ? group.contacts.filter((e) => e.toLowerCase() !== contactEmail)
          : [...group.contacts, contact.email];

        await pbUpdateGroup(group.id, { contacts: newContacts });
      } catch (error) {
        // Roll this group back to the state it had before the optimistic flip; other
        // groups may have their own writes in flight and must not be touched.
        setMembership((prev) => ({ ...prev, [group.id]: isMember }));
        const message = isMember
          ? `Failed to remove from ${group.name}`
          : `Failed to add to ${group.name}`;
        loggers.directory.error('[GroupSelector] Failed to toggle group membership', { error });
        setErrorMessage(message);
        onError?.(message);
      } finally {
        inFlightRef.current.delete(group.id);
        setUpdatingGroupIds((prev) => prev.filter((id) => id !== group.id));
      }
    },
    [contact, onError],
  );

  return (
    <div className="group-selector">
      <div className="group-selector-list">
        {groups.map((group) => {
          const isUpdating = updatingGroupIds.includes(group.id);
          return (
            <button
              type="button"
              key={group.id}
              aria-pressed={!!membership[group.id]}
              disabled={isUpdating}
              onClick={(e) => {
                e.stopPropagation();
                void toggleGroup(group, !!membership[group.id]);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.click();
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
      {errorMessage && (
        // Both call sites host this inside a confirmation modal, so it borrows that
        // dialog's error treatment rather than inventing a second one.
        <div
          className="group-selector-error confirm-modal-error"
          role="alert"
          aria-live="assertive"
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
};
