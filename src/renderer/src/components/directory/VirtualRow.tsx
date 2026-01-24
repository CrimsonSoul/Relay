import React, { memo } from 'react';
import { ListChildComponentProps } from 'react-window';
import { Contact, BridgeGroup, NoteEntry } from '@shared/ipc';
import { ContactCard } from '../ContactCard';

interface VirtualRowData {
  filtered: Contact[];
  recentlyAdded: Set<string>;
  onAdd: (contact: Contact) => void;
  groups: BridgeGroup[];
  groupMap: Map<string, string[]>;
  onContextMenu: (e: React.MouseEvent, contact: Contact) => void;
  focusedIndex: number;
  onRowClick: (index: number) => void;
  getContactNote?: (email: string) => NoteEntry | undefined;
  onNotesClick?: (contact: Contact) => void;
}

export const VirtualRow = memo(({ index, style, data }: ListChildComponentProps<VirtualRowData>) => {
  const { filtered, recentlyAdded, groupMap, onContextMenu, focusedIndex, onRowClick, getContactNote, onNotesClick } = data;

  if (index >= filtered.length) return <div style={style} />;

  const contact = filtered[index];
  const membership = groupMap.get(contact.email.toLowerCase()) || [];
  const isFocused = index === focusedIndex;
  const isRecentlyAdded = recentlyAdded.has(contact.email);
  const noteEntry = getContactNote?.(contact.email);

  return (
    <ContactCard
      style={{
        ...style,
        outline: isFocused ? '2px solid var(--color-accent-blue)' : isRecentlyAdded ? '2px solid var(--color-accent-green)' : 'none',
        outlineOffset: '-2px',
        background: isFocused ? 'rgba(59, 130, 246, 0.1)' : isRecentlyAdded ? 'rgba(34, 197, 94, 0.05)' : undefined
      }}
      name={contact.name}
      email={contact.email}
      title={contact.title}
      phone={contact.phone}
      groups={membership}
      selected={isFocused}
      onContextMenu={(e) => onContextMenu(e, contact)}
      onRowClick={() => onRowClick(index)}
      hasNotes={!!noteEntry?.note}
      tags={noteEntry?.tags}
      onNotesClick={() => onNotesClick?.(contact)}
    />
  );
});

VirtualRow.displayName = 'VirtualRow';
