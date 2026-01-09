import React from 'react';
import { Contact } from '@shared/ipc';
import { ContextMenu } from '../ContextMenu';

interface DirectoryContextMenuProps {
  x: number;
  y: number;
  contact: Contact;
  recentlyAdded: Set<string>;
  onClose: () => void;
  onAddToComposer: () => void;
  onManageGroups: () => void;
  onEditContact: () => void;
  onDeleteContact: () => void;
}

export const DirectoryContextMenu: React.FC<DirectoryContextMenuProps> = ({
  x, y, contact, recentlyAdded, onClose, onAddToComposer, onManageGroups, onEditContact, onDeleteContact
}) => (
  <ContextMenu
    x={x}
    y={y}
    onClose={onClose}
    items={[
      {
        label: recentlyAdded.has(contact.email) ? 'Added to Composer' : 'Add to Composer',
        onClick: onAddToComposer,
        disabled: recentlyAdded.has(contact.email),
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      },
      {
        label: 'Manage Groups',
        onClick: onManageGroups,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
      },
      {
        label: 'Edit Contact',
        onClick: onEditContact,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
      },
      {
        label: 'Delete',
        onClick: onDeleteContact,
        danger: true,
        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      }
    ]}
  />
);
