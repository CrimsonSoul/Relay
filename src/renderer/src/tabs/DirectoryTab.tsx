import React, { useRef, useEffect, useMemo } from 'react';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { Contact, GroupMap } from '@shared/ipc';

import { AddContactModal } from '../components/AddContactModal';
import { Modal } from '../components/Modal';
import { SearchInput } from '../components/SearchInput';
import { TactileButton } from '../components/TactileButton';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { GroupSelector } from '../components/directory/GroupSelector';
import { VirtualRow } from '../components/directory/VirtualRow';
import { DeleteConfirmationModal } from '../components/directory/DeleteConfirmationModal';
import { DirectoryContextMenu } from '../components/directory/DirectoryContextMenu';
import { useDirectory } from '../hooks/useDirectory';
import { useDirectoryKeyboard } from '../hooks/useDirectoryKeyboard';

type Props = { contacts: Contact[]; groups: GroupMap; onAddToAssembler: (contact: Contact) => void };

// Define constant for row height to avoid magic numbers and allow easy updates
const ROW_HEIGHT = 104;

const ScrollController = ({ listRef, focusedIndex }: { listRef: React.RefObject<List>; focusedIndex: number }) => {
  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      listRef.current.scrollToItem(focusedIndex, 'smart');
    }
  }, [focusedIndex, listRef]);
  return null;
};

export const DirectoryTab: React.FC<Props> = ({ contacts, groups, onAddToAssembler }) => {
  const dir = useDirectory(contacts, groups, onAddToAssembler);
  const listRef = useRef<List>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  const { handleListKeyDown } = useDirectoryKeyboard({
    listRef, filtered: dir.filtered, focusedIndex: dir.focusedIndex, setFocusedIndex: dir.setFocusedIndex,
    handleAddWrapper: dir.handleAddWrapper, setContextMenu: dir.setContextMenu, listContainerRef
  });

  useEffect(() => {
    if (dir.contextMenu) {
      const handler = () => dir.setContextMenu(null);
      window.addEventListener('click', handler);
      return () => window.removeEventListener('click', handler);
    }
  }, [dir.contextMenu, dir.setContextMenu]);

  const itemData = useMemo(() => ({
    filtered: dir.filtered, recentlyAdded: dir.recentlyAdded, onAdd: dir.handleAddWrapper, groups, groupMap: dir.groupMap,
    onContextMenu: (e: React.MouseEvent, contact: Contact) => { e.preventDefault(); dir.setContextMenu({ x: e.clientX, y: e.clientY, contact }); },
    focusedIndex: dir.focusedIndex,
    onRowClick: (i: number) => dir.setFocusedIndex(i)
  }), [dir.filtered, dir.recentlyAdded, dir.handleAddWrapper, groups, dir.groupMap, dir.focusedIndex, dir.setFocusedIndex, dir.setContextMenu]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '20px 24px 24px 24px', background: 'var(--color-bg-app)', overflow: 'hidden' }}>
      <CollapsibleHeader title="Personnel Directory" subtitle="Global search and management of organization contacts" isCollapsed={dir.isHeaderCollapsed}
        search={<SearchInput placeholder="Search people..." value={dir.search} onChange={(e) => dir.setSearch(e.target.value)} autoFocus />}>
        {dir.filtered.length > 0 && <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', marginRight: '8px' }}>{dir.filtered.length} matches</div>}
        <TactileButton onClick={() => dir.setSortConfig(prev => ({ ...prev, direction: prev.direction === 'asc' ? 'desc' : 'asc' }))} title={`Sort: ${dir.sortConfig.direction === 'asc' ? 'Ascending' : 'Descending'}`}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points={dir.sortConfig.direction === 'asc' ? "19 12 12 19 5 12" : "19 12 12 5 5 12"}></polyline></svg>}
          style={{ marginRight: '8px', flexShrink: 0, width: '44px', height: '44px', padding: 0 }} />
        <TactileButton variant="primary" style={{ padding: dir.isHeaderCollapsed ? '8px 16px' : '12px 24px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} onClick={() => dir.setIsAddModalOpen(true)}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>}>ADD CONTACT</TactileButton>
      </CollapsibleHeader>


      <div ref={listContainerRef} onKeyDown={handleListKeyDown} role="list" aria-label="Contacts list" tabIndex={0} style={{ flex: 1, outline: 'none' }}>
        <AutoSizer>
          {({ height, width }) => (
            <List
              ref={listRef}
              height={height}
              itemCount={dir.filtered.length}
              itemSize={ROW_HEIGHT}
              width={width}
              itemData={itemData}
              style={{ outline: "none" }}
              onScroll={({ scrollOffset }) =>
                dir.setIsHeaderCollapsed(scrollOffset > 30)
              }
            >
              {VirtualRow}
            </List>
          )}
        </AutoSizer>
        {dir.filtered.length === 0 && <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', fontStyle: 'italic', flexDirection: 'column', gap: '8px' }}><div style={{ fontSize: '24px', opacity: 0.3 }}>∅</div><div>No contacts found</div></div>}
      </div>

      <ScrollController listRef={listRef} focusedIndex={dir.focusedIndex} />

      <AddContactModal isOpen={dir.isAddModalOpen} onClose={() => dir.setIsAddModalOpen(false)} onSave={dir.handleCreateContact} />
      <AddContactModal isOpen={!!dir.editingContact} onClose={() => dir.setEditingContact(null)} onSave={dir.handleUpdateContact} editContact={dir.editingContact || undefined} />
      <DeleteConfirmationModal contact={dir.deleteConfirmation} onClose={() => dir.setDeleteConfirmation(null)} onConfirm={dir.handleDeleteContact} />
      {dir.contextMenu && <DirectoryContextMenu x={dir.contextMenu.x} y={dir.contextMenu.y} contact={dir.contextMenu.contact} recentlyAdded={dir.recentlyAdded} onClose={() => dir.setContextMenu(null)}
        onAddToComposer={() => { dir.handleAddWrapper(dir.contextMenu!.contact); dir.setContextMenu(null); }} onManageGroups={() => { dir.setGroupSelectorContact(dir.contextMenu!.contact); dir.setContextMenu(null); }}
        onEditContact={() => dir.setEditingContact(dir.contextMenu!.contact)} onDeleteContact={() => dir.setDeleteConfirmation(dir.contextMenu!.contact)} />}
      {dir.groupSelectorContact && <Modal isOpen={true} onClose={() => dir.setGroupSelectorContact(null)} title="Manage Groups" width="400px"><GroupSelector contact={dir.groupSelectorContact} groups={groups} onClose={() => dir.setGroupSelectorContact(null)} /></Modal>}
    </div>
  );
};

