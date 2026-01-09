import React, { memo } from 'react';
import { ListChildComponentProps } from 'react-window';
import { Contact, GroupMap } from '@shared/ipc';
import { ContactCard } from '../ContactCard';

interface VirtualRowData {
  filtered: Contact[];
  recentlyAdded: Set<string>;
  onAdd: (contact: Contact) => void;
  groups: GroupMap;
  groupMap: Map<string, string[]>;
  onContextMenu: (e: React.MouseEvent, contact: Contact) => void;
  columnWidths: any;
  columnOrder: string[];
  focusedIndex: number;
  onRowClick: (index: number) => void;
}

export const VirtualRow = memo(({ index, style, data }: ListChildComponentProps<VirtualRowData>) => {
  const { filtered, recientementeAdded, onAdd, groups, groupMap, onContextMenu, columnWidths, columnOrder, focusedIndex, onRowClick } = data;

  if (index >= filtered.length) return <div style={style} />;

  const contact = filtered[index];
  const membership = groupMap.get(contact.email.toLowerCase()) || [];
  const isFocused = index === focusedIndex;

  return (
    <ContactCard
      style={{
        ...style,
        outline: isFocused ? '2px solid var(--color-accent-blue)' : 'none',
        outlineOffset: '-2px',
        background: isFocused ? 'rgba(59, 130, 246, 0.1)' : undefined
      }}
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
});
