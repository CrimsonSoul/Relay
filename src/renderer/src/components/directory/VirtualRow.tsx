import React, { memo } from 'react';
import type { RowComponentProps } from 'react-window';
import { Contact } from '@shared/ipc';
import { ContactCard } from '../ContactCard';
import { contactRecordKey } from '../../features/knowledge/knowledgeRecordNavigation';
import type { RowMenuAnchor } from './RowActionsButton';

export interface DirectoryVirtualRowData {
  filtered: Contact[];
  groupMap: Map<string, string[]>;
  serverRelationMap: Map<string, { owned: number; supported: number }>;
  onContextMenu: (e: React.MouseEvent, contact: Contact) => void;
  /** Opens the contact's menu from the row's `⋯` button. */
  onOpenActions: (anchor: RowMenuAnchor, contact: Contact) => void;
  focusedIndex: number;
  /** Row an open context menu, notes editor or delete confirm acts on; -1 for none. */
  menuTargetIndex: number;
  onRowClick: (index: number) => void;
}

export const VirtualRow = memo(
  ({ index, style, ...data }: RowComponentProps<DirectoryVirtualRowData>) => {
    const {
      filtered,
      groupMap,
      serverRelationMap,
      onContextMenu,
      onOpenActions,
      focusedIndex,
      menuTargetIndex,
      onRowClick,
    } = data;

    const contact = filtered[index];
    if (!contact) return <div style={style} />;

    const emailKey = contact.email.toLowerCase();
    const membership = groupMap.get(emailKey) || [];
    const relationshipCounts = serverRelationMap.get(emailKey);
    const isFocused = index === focusedIndex;
    return (
      <ContactCard
        style={style}
        name={contact.name}
        email={contact.email}
        title={contact.title}
        phone={contact.phone}
        groups={membership}
        relationshipCounts={relationshipCounts}
        recordKey={contactRecordKey(contact)}
        selected={isFocused}
        menuTarget={index === menuTargetIndex}
        onContextMenu={(e) => onContextMenu(e, contact)}
        onOpenActions={(anchor) => onOpenActions(anchor, contact)}
        onRowClick={() => onRowClick(index)}
      />
    );
  },
);

VirtualRow.displayName = 'VirtualRow';
