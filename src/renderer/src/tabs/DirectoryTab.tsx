import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { List, useListRef } from 'react-window';
import type { ListImperativeAPI } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { Contact, BridgeGroup } from '@shared/ipc';

import { AddContactModal } from '../components/AddContactModal';
import { Modal } from '../components/Modal';
import { SearchInput } from '../components/SearchInput';
import { TactileButton } from '../components/TactileButton';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { GroupSelector } from '../components/directory/GroupSelector';
import { VirtualRow } from '../components/directory/VirtualRow';
import { DeleteConfirmationModal } from '../components/directory/DeleteConfirmationModal';
import { DirectoryContextMenu } from '../components/directory/DirectoryContextMenu';
import { NotesModal } from '../components/NotesModal';
import { useDirectory } from '../hooks/useDirectory';
import { useDirectoryKeyboard } from '../hooks/useDirectoryKeyboard';
import { useNotesContext } from '../contexts';

type Props = {
  contacts: Contact[];
  groups: BridgeGroup[];
  onAddToAssembler: (contact: Contact) => void;
};

// Define constant for row height to avoid magic numbers and allow easy updates
const ROW_HEIGHT = 104;

const ScrollController = ({
  listRef,
  focusedIndex,
}: {
  listRef: React.RefObject<ListImperativeAPI | null>;
  focusedIndex: number;
}) => {
  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      listRef.current.scrollToRow({ index: focusedIndex, align: 'smart' });
    }
  }, [focusedIndex, listRef]);
  return null;
};

export const DirectoryTab: React.FC<Props> = ({ contacts, groups, onAddToAssembler }) => {
  const dir = useDirectory(contacts, groups, onAddToAssembler);
  const listRef = useListRef();
  const listContainerRef = useRef<HTMLDivElement>(null);
  const { getContactNote, setContactNote } = useNotesContext();
  const [notesContact, setNotesContact] = useState<Contact | null>(null);

  const { handleListKeyDown } = useDirectoryKeyboard({
    listRef,
    filtered: dir.filtered,
    focusedIndex: dir.focusedIndex,
    setFocusedIndex: dir.setFocusedIndex,
    handleAddWrapper: dir.handleAddWrapper,
    setContextMenu: dir.setContextMenu,
    listContainerRef,
  });

  const { contextMenu, setContextMenu } = dir;
  useEffect(() => {
    if (contextMenu) {
      const handler = () => setContextMenu(null);
      window.addEventListener('click', handler);
      return () => window.removeEventListener('click', handler);
    }
  }, [contextMenu, setContextMenu]);

  const handleNotesClick = useCallback((contact: Contact) => setNotesContact(contact), []);
  const { filtered, recentlyAdded, handleAddWrapper, groupMap, focusedIndex, setFocusedIndex } =
    dir;
  const itemData = useMemo(
    () => ({
      filtered,
      recentlyAdded,
      onAdd: handleAddWrapper,
      groups,
      groupMap,
      onContextMenu: (e: React.MouseEvent, contact: Contact) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, contact });
      },
      focusedIndex,
      onRowClick: (i: number) => setFocusedIndex(i),
      getContactNote,
      onNotesClick: handleNotesClick,
    }),
    [
      filtered,
      recentlyAdded,
      handleAddWrapper,
      groups,
      groupMap,
      focusedIndex,
      setFocusedIndex,
      setContextMenu,
      getContactNote,
      handleNotesClick,
    ],
  );

  return (
    <div className="tab-layout">
      <CollapsibleHeader
        title="Personnel Directory"
        subtitle="Global search and management of organization contacts"
        isCollapsed={dir.isHeaderCollapsed}
        search={
          <SearchInput
            placeholder="Search people..."
            value={dir.search}
            onChange={(e) => dir.setSearch(e.target.value)}
            autoFocus
          />
        }
      >
        {dir.filtered.length > 0 && (
          <div className="match-count">{dir.filtered.length} matches</div>
        )}
        <TactileButton
          onClick={() =>
            dir.setSortConfig((prev) => ({
              ...prev,
              direction: prev.direction === 'asc' ? 'desc' : 'asc',
            }))
          }
          title={`Sort: ${dir.sortConfig.direction === 'asc' ? 'Ascending' : 'Descending'}`}
          icon={
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <polyline
                points={dir.sortConfig.direction === 'asc' ? '19 12 12 19 5 12' : '19 12 12 5 5 12'}
              ></polyline>
            </svg>
          }
          className="sort-toggle-btn"
          style={{ height: '44px', padding: 0 }}
        />
        <TactileButton
          variant="primary"
          className="btn-collapsible"
          style={{ padding: dir.isHeaderCollapsed ? '8px 16px' : '12px 24px' }}
          onClick={() => dir.setIsAddModalOpen(true)}
          icon={
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <line x1="20" y1="8" x2="20" y2="14"></line>
              <line x1="23" y1="11" x2="17" y2="11"></line>
            </svg>
          }
        >
          ADD CONTACT
        </TactileButton>
      </CollapsibleHeader>

      <div
        ref={listContainerRef}
        onKeyDown={handleListKeyDown}
        role="toolbar"
        aria-label="Contacts list"
        tabIndex={0}
        className="tab-list-container"
      >
        <AutoSizer
          renderProp={({ height, width }) => (
            <List
              listRef={listRef}
              rowCount={dir.filtered.length}
              rowHeight={ROW_HEIGHT}
              rowComponent={VirtualRow}
              rowProps={itemData}
              style={{ height: height ?? 0, width: width ?? 0, outline: 'none' }}
              onScroll={(e) =>
                dir.setIsHeaderCollapsed((e.target as HTMLDivElement).scrollTop > 30)
              }
            />
          )}
        />
        {dir.filtered.length === 0 && (
          <div className="tab-empty-state">
            <div className="tab-empty-state-icon">∅</div>
            <div>No contacts found</div>
          </div>
        )}
      </div>

      <ScrollController listRef={listRef} focusedIndex={dir.focusedIndex} />

      <AddContactModal
        isOpen={dir.isAddModalOpen}
        onClose={() => dir.setIsAddModalOpen(false)}
        onSave={dir.handleCreateContact}
      />
      <AddContactModal
        isOpen={!!dir.editingContact}
        onClose={() => dir.setEditingContact(null)}
        onSave={dir.handleUpdateContact}
        editContact={dir.editingContact || undefined}
      />
      <DeleteConfirmationModal
        contact={dir.deleteConfirmation}
        onClose={() => dir.setDeleteConfirmation(null)}
        onConfirm={dir.handleDeleteContact}
      />
      {dir.contextMenu && (
        <DirectoryContextMenu
          x={dir.contextMenu.x}
          y={dir.contextMenu.y}
          contact={dir.contextMenu.contact}
          recentlyAdded={dir.recentlyAdded}
          onClose={() => dir.setContextMenu(null)}
          onAddToComposer={() => {
            dir.handleAddWrapper(dir.contextMenu!.contact);
            dir.setContextMenu(null);
          }}
          onManageGroups={() => {
            dir.setGroupSelectorContact(dir.contextMenu!.contact);
            dir.setContextMenu(null);
          }}
          onEditContact={() => dir.setEditingContact(dir.contextMenu!.contact)}
          onDeleteContact={() => dir.setDeleteConfirmation(dir.contextMenu!.contact)}
          onEditNotes={() => {
            setNotesContact(dir.contextMenu!.contact);
            dir.setContextMenu(null);
          }}
          hasNotes={!!getContactNote(dir.contextMenu.contact.email)}
        />
      )}
      {dir.groupSelectorContact && (
        <Modal
          isOpen={true}
          onClose={() => dir.setGroupSelectorContact(null)}
          title="Manage Groups"
          width="400px"
        >
          <GroupSelector
            contact={dir.groupSelectorContact}
            groups={groups}
            onClose={() => dir.setGroupSelectorContact(null)}
          />
        </Modal>
      )}

      <NotesModal
        isOpen={!!notesContact}
        onClose={() => setNotesContact(null)}
        entityType="contact"
        entityId={notesContact?.email || ''}
        entityName={notesContact?.name || notesContact?.email || ''}
        existingNote={notesContact ? getContactNote(notesContact.email) : undefined}
        onSave={(note, tags) => setContactNote(notesContact!.email, note, tags)}
      />
    </div>
  );
};
