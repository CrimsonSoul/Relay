import React from 'react';
import { Modal } from '../Modal';
import { SearchInput } from '../SearchInput';
import { TactileButton } from '../TactileButton';
import { Tooltip } from '../Tooltip';
import { Contact, OnCallEntry } from '@shared/ipc';

interface AssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamName: string | null;
  currentEntry: OnCallEntry | undefined;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredContacts: Contact[];
  contacts: Contact[];
  handleUpdate: (team: string, type: 'primary' | 'backup' | 'backupLabel', value: string) => void;
}

export const AssignmentModal: React.FC<AssignmentModalProps> = ({
  isOpen,
  onClose,
  teamName,
  currentEntry,
  searchQuery,
  setSearchQuery,
  filteredContacts,
  contacts,
  handleUpdate
}) => {
  if (!teamName) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`On-Call: ${teamName}`}
      width="600px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '600px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-tertiary)', marginBottom: '8px', letterSpacing: '0.05em' }}>SEARCH CONTACTS</label>
          <SearchInput
            placeholder="Type to search all contacts..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', flex: 1, overflow: 'hidden' }}>
          {/* Primary Assignment */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-tertiary)', letterSpacing: '0.05em' }}>PRIMARY</label>
            <div style={{ fontSize: '16px', fontWeight: 700, padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', color: 'var(--color-accent-blue)' }}>
              {contacts.find(c => c.email === currentEntry?.primary)?.name || 'NONE'}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', paddingRight: '8px' }}>
              {filteredContacts.map(c => (
                <TactileButton
                  key={c.email}
                  onClick={() => handleUpdate(teamName, 'primary', c.email)}
                  style={{
                    justifyContent: 'flex-start',
                    padding: '10px 14px',
                    height: 'auto',
                    minHeight: '52px',
                    border: currentEntry?.primary === c.email ? '1px solid var(--color-accent-blue)' : '1px solid rgba(255,255,255,0.05)'
                  }}
                  variant={currentEntry?.primary === c.email ? 'primary' : 'secondary'}
                >
                  <div style={{ textAlign: 'left', width: '100%', display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                    <Tooltip content={c.name || c.email}>
                      <div
                        style={{ fontWeight: 600, fontSize: '14px', color: currentEntry?.primary === c.email ? 'white' : 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {c.name || c.email}
                      </div>
                    </Tooltip>
                    {c.title && (
                      <Tooltip content={c.title}>
                        <div style={{ fontSize: '12px', opacity: 0.8, color: currentEntry?.primary === c.email ? 'rgba(255,255,255,0.9)' : 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                      </Tooltip>
                    )}
                    <Tooltip content={c.email}>
                      <div style={{ fontSize: '11px', opacity: 0.5, fontFamily: 'monospace', color: currentEntry?.primary === c.email ? 'rgba(255,255,255,0.7)' : 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
                    </Tooltip>
                  </div>
                </TactileButton>
              ))}
            </div>
          </div>

          {/* Backup Assignment */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--color-text-tertiary)', letterSpacing: '0.05em' }}>BACKUP LABEL</label>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['BAK', 'BAK/WKND', 'TELECOM'].map(label => (
                  <TactileButton
                    key={label}
                    onClick={() => handleUpdate(teamName, 'backupLabel', label)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '10px',
                      height: 'auto',
                      minWidth: '0',
                      minHeight: '24px',
                      border: (currentEntry?.backupLabel || 'BAK') === label ? '1px solid var(--color-accent-blue)' : '1px solid rgba(255,255,255,0.05)'
                    }}
                    variant={(currentEntry?.backupLabel || 'BAK') === label ? 'primary' : 'secondary'}
                  >
                    {label}
                  </TactileButton>
                ))}
              </div>
            </div>
            <div style={{ fontSize: '16px', fontWeight: 700, padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', color: 'var(--color-text-secondary)' }}>
              {contacts.find(c => c.email === currentEntry?.backup)?.name || 'NONE'}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', paddingRight: '8px' }}>
              {filteredContacts.map(c => (
                <TactileButton
                  key={c.email}
                  onClick={() => handleUpdate(teamName, 'backup', c.email)}
                  style={{
                    justifyContent: 'flex-start',
                    padding: '10px 14px',
                    height: 'auto',
                    minHeight: '52px',
                    border: currentEntry?.backup === c.email ? '1px solid var(--color-accent-blue)' : '1px solid rgba(255,255,255,0.05)'
                  }}
                  variant={currentEntry?.backup === c.email ? 'primary' : 'secondary'}
                >
                  <div style={{ textAlign: 'left', width: '100%', display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                    <Tooltip content={c.name || c.email}>
                      <div
                        style={{ fontWeight: 600, fontSize: '14px', color: currentEntry?.backup === c.email ? 'white' : 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {c.name || c.email}
                      </div>
                    </Tooltip>
                    {c.title && (
                      <Tooltip content={c.title}>
                        <div style={{ fontSize: '12px', opacity: 0.8, color: currentEntry?.backup === c.email ? 'rgba(255,255,255,0.9)' : 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                      </Tooltip>
                    )}
                    <Tooltip content={c.email}>
                      <div style={{ fontSize: '11px', opacity: 0.5, fontFamily: 'monospace', color: currentEntry?.backup === c.email ? 'rgba(255,255,255,0.7)' : 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
                    </Tooltip>
                  </div>
                </TactileButton>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
          <TactileButton variant="primary" style={{ padding: '8px 24px' }} onClick={onClose}>Done</TactileButton>
        </div>
      </div>
    </Modal>
  );
};
