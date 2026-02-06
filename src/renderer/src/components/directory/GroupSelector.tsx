import React, { useState, useEffect, useCallback } from 'react';
import { Contact, BridgeGroup } from '@shared/ipc';
import { loggers } from '../../utils/logger';

interface GroupSelectorProps {
  contact: Contact;
  groups: BridgeGroup[];
  onClose: () => void;
  onError?: (message: string) => void;
}

export const GroupSelector = ({ contact, groups, onClose, onError }: GroupSelectorProps) => {
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
        if (!window.api) {
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

        const success = await window.api.updateGroup(group.id, { contacts: newContacts });
        if (!success) {
          throw new Error('Failed to update group');
        }
      } catch (error) {
        // Rollback on failure
        setMembership((prev) => ({ ...prev, [group.id]: previousState }));
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
    <div
      role="presentation"
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        width: '200px',
        background: 'var(--color-bg-surface)',
        border: 'var(--border-subtle)',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        zIndex: 100,
        padding: '8px',
        marginTop: '4px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--color-text-tertiary)',
          padding: '4px 8px',
          marginBottom: '4px',
        }}
      >
        ADD TO GROUP
      </div>
      <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
        {groups.map((group) => {
          const isUpdating = updating === group.id;
          return (
            <div
              key={group.id}
              role="checkbox"
              aria-checked={!!membership[group.id]}
              tabIndex={0}
              onClick={() => !isUpdating && toggleGroup(group, membership[group.id])}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!isUpdating) void toggleGroup(group, membership[group.id]);
                }
              }}
              style={{
                padding: '6px 8px',
                fontSize: '14px',
                color: 'var(--color-text-primary)',
                borderRadius: '4px',
                cursor: isUpdating ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                opacity: isUpdating ? 0.6 : 1,
              }}
              onMouseEnter={(e) =>
                !isUpdating && (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '3px',
                  border: membership[group.id] ? 'none' : '1px solid var(--color-text-tertiary)',
                  background: membership[group.id] ? 'var(--color-accent-blue)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {membership[group.id] && <span style={{ fontSize: '10px', color: '#FFF' }}>✓</span>}
              </div>
              {group.name}
            </div>
          );
        })}
        {groups.length === 0 && (
          <div
            style={{
              padding: '8px',
              fontSize: '12px',
              color: 'var(--color-text-tertiary)',
              fontStyle: 'italic',
            }}
          >
            No groups available
          </div>
        )}
      </div>
      <div style={{ borderTop: 'var(--border-subtle)', marginTop: '8px', paddingTop: '8px' }}>
        <div
          role="button"
          tabIndex={0}
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClose();
            }
          }}
          style={{
            fontSize: '12px',
            color: 'var(--color-text-secondary)',
            textAlign: 'center',
            cursor: 'pointer',
            padding: '4px',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
        >
          Close
        </div>
      </div>
    </div>
  );
};
