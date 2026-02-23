import React, { memo } from 'react';
import type { RowComponentProps } from 'react-window';
import { Contact } from '@shared/ipc';
import { ContactCard } from '../ContactCard';

export interface DirectoryVirtualRowData {
  filtered: Contact[];
  groupMap: Map<string, string[]>;
  onContextMenu: (e: React.MouseEvent, contact: Contact) => void;
  focusedIndex: number;
  onRowClick: (index: number) => void;
}

export const VirtualRow = memo(
  ({ index, style, ...data }: RowComponentProps<DirectoryVirtualRowData>) => {
    const { filtered, groupMap, onContextMenu, focusedIndex, onRowClick } = data;

    if (index >= filtered.length) return <div style={style} />;

    const contact = filtered[index];
    const membership = groupMap.get(contact.email.toLowerCase()) || [];
    const isFocused = index === focusedIndex;
    return (
      <ContactCard
        style={style}
        name={contact.name}
        email={contact.email}
        title={contact.title}
        phone={contact.phone}
        groups={membership}
        selected={isFocused}
        onContextMenu={(e) => onContextMenu(e, contact)}
        onRowClick={() => onRowClick(index)}
      />
    );
  },
);

VirtualRow.displayName = 'VirtualRow';
