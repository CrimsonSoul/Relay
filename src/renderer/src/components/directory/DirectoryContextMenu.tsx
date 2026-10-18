import React from 'react';
import { Contact } from '@shared/ipc';
import { ContextMenu } from '../ContextMenu';
import { AddIcon, DeleteIcon, EditIcon, NotesIcon } from '../detailPanelCommon';

// Menu icons are decorative and drawn thinner than the detail panel's buttons.
const MENU_ICON = { strokeWidth: '2', 'aria-hidden': true } as const;

interface DirectoryContextMenuProps {
  x: number;
  y: number;
  contact: Contact;
  recentlyAdded: Set<string>;
  onClose: () => void;
  onAddToBridge: () => void;
  onManageGroups: () => void;
  onEditContact: () => void;
  onDeleteContact: () => void;
  onEditNotes: () => void;
  hasNotes?: boolean;
}

export const DirectoryContextMenu: React.FC<DirectoryContextMenuProps> = ({
  x,
  y,
  contact,
  recentlyAdded,
  onClose,
  onAddToBridge,
  onManageGroups,
  onEditContact,
  onDeleteContact,
  onEditNotes,
  hasNotes,
}) => (
  <ContextMenu
    x={x}
    y={y}
    onClose={onClose}
    items={[
      {
        label: recentlyAdded.has(contact.email) ? 'Added to Bridge' : 'Add to Bridge',
        onClick: onAddToBridge,
        disabled: recentlyAdded.has(contact.email),
        icon: <AddIcon {...MENU_ICON} />,
      },
      {
        label: 'Manage Groups',
        onClick: onManageGroups,
        icon: (
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
        ),
      },
      {
        label: hasNotes ? 'Edit Notes' : 'Add Notes',
        onClick: onEditNotes,
        icon: <NotesIcon {...MENU_ICON} />,
      },
      {
        label: 'Edit Contact',
        onClick: onEditContact,
        icon: <EditIcon {...MENU_ICON} />,
      },
      {
        label: 'Delete',
        onClick: onDeleteContact,
        danger: true,
        icon: <DeleteIcon {...MENU_ICON} />,
      },
    ]}
  />
);
