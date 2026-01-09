import React, { useState, useEffect } from 'react';
import { Contact, GroupMap } from '@shared/ipc';

interface GroupSelectorProps {
  contact: Contact;
  groups: GroupMap;
  onClose: () => void;
}

export const GroupSelector = ({ contact, groups, onClose }: GroupSelectorProps) => {
  const [membership, setMembership] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const mem: Record<string, boolean> = {};
    const contactEmail = contact.email.toLowerCase();
    Object.entries(groups).forEach(([gName, emails]) => {
      mem[gName] = (emails as string[]).some((e: string) => e.toLowerCase() === contactEmail);
    });
    setMembership(mem);
  }, [contact, groups]);

  const toggleGroup = async (group: string, current: boolean) => {
    const previousState = membership[group];
    setMembership(prev => ({ ...prev, [group]: !current }));
    try {
      if (current) {
        await window.api?.removeContactFromGroup(group, contact.email);
      } else {
        await window.api?.addContactToGroup(group, contact.email);
      }
    } catch (error) {
      // Rollback on failure
      setMembership(prev => ({ ...prev, [group]: previousState }));
      console.error('[GroupSelector] Failed to toggle group membership:', error);
    }
  };

  return (
    <div style={{
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
      marginTop: '4px'
    }} onClick={e => e.stopPropagation()}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-tertiary)', padding: '4px 8px', marginBottom: '4px' }}>
        ADD TO GROUP
      </div>
      <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
        {Object.keys(groups).map(g => (
          <div key={g}
            onClick={() => toggleGroup(g, membership[g])}
            style={{
              padding: '6px 8px',
              fontSize: '14px',
              color: 'var(--color-text-primary)',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{
              width: '14px',
              height: '14px',
              borderRadius: '3px',
              border: membership[g] ? 'none' : '1px solid var(--color-text-tertiary)',
              background: membership[g] ? 'var(--color-accent-blue)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              {membership[g] && <span style={{ fontSize: '10px', color: '#FFF' }}>✓</span>}
            </div>
            {g}
          </div>
        ))}
        {Object.keys(groups).length === 0 && (
          <div style={{ padding: '8px', fontSize: '12px', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            No groups available
          </div>
        )}
      </div>
      <div style={{ borderTop: 'var(--border-subtle)', marginTop: '8px', paddingTop: '8px' }}>
        <div
          onClick={onClose}
          style={{
            fontSize: '12px',
            color: 'var(--color-text-secondary)',
            textAlign: 'center',
            cursor: 'pointer',
            padding: '4px'
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-primary)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-secondary)'}
        >
          Close
        </div>
      </div>
    </div>
  );
};
