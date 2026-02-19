import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { List, useListRef } from 'react-window';
import type { ListImperativeAPI } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { Contact, BridgeGroup } from '@shared/ipc';

import { AddContactModal } from '../components/AddContactModal';
import { Modal } from '../components/Modal';
import { TactileButton } from '../components/TactileButton';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { ListToolbar } from '../components/ListToolbar';
import { ListFilters } from '../components/ListFilters';
import { GroupSelector } from '../components/directory/GroupSelector';
import { VirtualRow } from '../components/directory/VirtualRow';
import { DeleteConfirmationModal } from '../components/directory/DeleteConfirmationModal';
import { DirectoryContextMenu } from '../components/directory/DirectoryContextMenu';
import { ContactDetailPanel } from '../components/ContactDetailPanel';
import { NotesModal } from '../components/NotesModal';
import { useDirectory } from '../hooks/useDirectory';
import { useDirectoryKeyboard } from '../hooks/useDirectoryKeyboard';
import { useListFilters, type FilterDef } from '../hooks/useListFilters';
import { useNotesContext } from '../contexts';

type Props = {
  contacts: Contact[];
  groups: BridgeGroup[];
  onAddToAssembler: (contact: Contact) => void;
};

// Define constant for row height to avoid magic numbers and allow easy updates
const ROW_HEIGHT = 80;

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

  const contactExtraFilters = useMemo<FilterDef<Contact>[]>(
    () => [
      {
        key: 'hasEmail',
        label: 'Has Email',
        icon: (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        ),
        predicate: (c) => !!c.email?.trim(),
      },
      {
        key: 'hasPhone',
        label: 'Has Phone',
        icon: (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        ),
        predicate: (c) => !!c.phone?.trim(),
      },
      {
        key: 'hasTitle',
        label: 'Has Title',
        icon: (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
          </svg>
        ),
        predicate: (c) => !!c.title?.trim(),
      },
    ],
    [],
  );

  const filters = useListFilters({
    items: dir.filtered,
    tagSourceItems: contacts,
    getNote: (c) => getContactNote(c.email),
    extraFilters: contactExtraFilters,
  });

  const filtered = filters.filteredItems;

  const { handleListKeyDown } = useDirectoryKeyboard({
    listRef,
    filtered,
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
  const { handleAddWrapper, groupMap, focusedIndex, setFocusedIndex } = dir;

  const selectedContact =
    focusedIndex >= 0 && focusedIndex < filtered.length ? filtered[focusedIndex] : null;
  const selectedGroups = selectedContact
    ? groupMap.get(selectedContact.email.toLowerCase()) || []
    : [];
  const selectedNote = selectedContact ? getContactNote(selectedContact.email) : undefined;

  const itemData = useMemo(
    () => ({
      filtered,
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
      <div className="tab-split-layout">
        {selectedContact ? (
          <ContactDetailPanel
            contact={selectedContact}
            groups={selectedGroups}
            noteText={selectedNote?.note}
            tags={selectedNote?.tags}
            onEditNotes={() => setNotesContact(selectedContact)}
            onEdit={() => dir.setEditingContact(selectedContact)}
            onDelete={() => dir.setDeleteConfirmation(selectedContact)}
            onAddToAssembler={() => handleAddWrapper(selectedContact)}
          />
        ) : (
          <div className="detail-panel detail-panel--empty">
            <div className="detail-panel-placeholder">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.3"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>Select a contact</span>
            </div>
          </div>
        )}
        <div className="tab-main-content">
          <CollapsibleHeader isCollapsed={dir.isHeaderCollapsed}>
            {filtered.length > 0 && <div className="match-count">{filtered.length} contacts</div>}
            <TactileButton
              variant="primary"
              className="btn-collapsible"
              onClick={() => dir.setIsAddModalOpen(true)}
              icon={
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="20" y1="8" x2="20" y2="14" />
                  <line x1="23" y1="11" x2="17" y2="11" />
                </svg>
              }
            >
              ADD CONTACT
            </TactileButton>
          </CollapsibleHeader>

          <ListToolbar
            search={dir.search}
            onSearchChange={dir.setSearch}
            placeholder="Search Recipients"
            sortDirection={dir.sortConfig.direction}
            onToggleSortDirection={() =>
              dir.setSortConfig((prev) => ({
                ...prev,
                direction: prev.direction === 'asc' ? 'desc' : 'asc',
              }))
            }
            sortKey={dir.sortConfig.key}
            sortOptions={[
              { value: 'name', label: 'Name' },
              { value: 'email', label: 'Email' },
              { value: 'title', label: 'Title' },
              { value: 'phone', label: 'Phone' },
            ]}
            onSortKeyChange={(key) =>
              dir.setSortConfig((prev) => ({
                ...prev,
                key: key as 'name' | 'email' | 'title' | 'phone',
              }))
            }
          />

          {(dir.filtered.length > 0 || filters.isAnyFilterActive) && (
            <ListFilters
              hasNotesFilter={filters.hasNotesFilter}
              selectedTags={filters.selectedTags}
              availableTags={filters.availableTags}
              activeExtras={filters.activeExtras}
              extraFilters={filters.extraFilters}
              isAnyFilterActive={filters.isAnyFilterActive}
              onToggleHasNotes={filters.toggleHasNotes}
              onToggleTag={filters.toggleTag}
              onToggleExtra={filters.toggleExtra}
              onClearAll={filters.clearAll}
            />
          )}

          <div
            ref={listContainerRef}
            onKeyDown={handleListKeyDown}
            role="listbox"
            aria-label="Contacts list"
            tabIndex={0}
            className="tab-list-container"
          >
            <AutoSizer
              renderProp={({ height, width }) => (
                <List
                  listRef={listRef}
                  rowCount={filtered.length}
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
            {filtered.length === 0 && (
              <div className="tab-empty-state">
                <div className="tab-empty-state-icon">∅</div>
                <div>No contacts found</div>
              </div>
            )}
          </div>
        </div>
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
