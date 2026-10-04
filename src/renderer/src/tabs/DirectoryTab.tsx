import React, { useEffect, useMemo, useState, useRef } from 'react';
import { EmptyState } from '../components/EmptyState';
import { List, useListRef } from 'react-window';
import type { ListImperativeAPI, RowComponentProps } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { Contact, BridgeGroup, Server } from '@shared/ipc';

import { AddContactModal } from '../components/AddContactModal';
import { Modal } from '../components/Modal';
import { TactileButton } from '../components/TactileButton';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { ListToolbar } from '../components/ListToolbar';
import { ListFilters } from '../components/ListFilters';
import { GroupSelector } from '../components/directory/GroupSelector';
import { VirtualRow, type DirectoryVirtualRowData } from '../components/directory/VirtualRow';
import { DeleteConfirmationModal } from '../components/directory/DeleteConfirmationModal';
import { DirectoryContextMenu } from '../components/directory/DirectoryContextMenu';
import type { RowMenuAnchor } from '../components/directory/RowActionsButton';
import { ContactDetailPanel } from '../components/ContactDetailPanel';
import { NotesModal } from '../components/NotesModal';
import { useDirectory } from '../hooks/useDirectory';
import { useDirectoryKeyboard } from '../hooks/useDirectoryKeyboard';
import { useListFilters, type FilterDef } from '../hooks/useListFilters';
import { useNotesContext } from '../contexts';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { SearchInput } from '../components/SearchInput';
import {
  contactRecordKey,
  type KnowledgeRecordOpenRequest,
} from '../features/knowledge/knowledgeRecordNavigation';

type Props = {
  contacts: Contact[];
  groups: BridgeGroup[];
  servers?: Server[];
  onAddToAssembler: (contact: Contact) => void;
  selectionRequest?: KnowledgeRecordOpenRequest | null;
  onSelectionUnavailable?: (request: KnowledgeRecordOpenRequest) => void;
};

// Define constant for row height to avoid magic numbers and allow easy updates
const ROW_HEIGHT = 67;

// components/directory/VirtualRow is wrapped in React.memo, whose call signature is typed as
// returning ReactNode; react-window's `rowComponent` prop requires ReactElement | null. Rendering
// it as an element keeps the memo boundary while satisfying that prop type.
const DirectoryVirtualRow = (props: RowComponentProps<DirectoryVirtualRowData>) => (
  <VirtualRow {...props} />
);

const normalizeRelationshipEmail = (value: string | undefined) => {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || trimmed === '-' || trimmed === '0') return '';
  return trimmed;
};

function focusRenderedRecord(container: HTMLElement | null, recordKey: string): void {
  const row = Array.from(container?.querySelectorAll<HTMLElement>('[data-record-key]') ?? []).find(
    (node) => node.dataset.recordKey === recordKey,
  );
  row?.focus();
}

const ScrollController = ({
  listRef,
  focusedIndex,
  itemCount,
}: {
  listRef: React.RefObject<ListImperativeAPI | null>;
  focusedIndex: number;
  itemCount: number;
}) => {
  useEffect(() => {
    if (focusedIndex >= 0 && focusedIndex < itemCount && listRef.current) {
      listRef.current.scrollToRow({ index: focusedIndex, align: 'smart' });
    }
  }, [focusedIndex, itemCount, listRef]);
  return null;
};

export const DirectoryTab: React.FC<Props> = ({
  contacts,
  groups,
  servers = [],
  onAddToAssembler,
  selectionRequest,
  onSelectionUnavailable,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const dir = useDirectory(contacts, groups, onAddToAssembler, searchQuery);
  const listRef = useListRef(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const { getContactNote, setContactNote } = useNotesContext();
  const [notesContact, setNotesContact] = useState<Contact | null>(null);

  const serverRelationMap = useMemo(() => {
    const relationMap = new Map<string, { owned: number; supported: number }>();
    for (const server of servers) {
      const owner = normalizeRelationshipEmail(server.owner);
      const support = normalizeRelationshipEmail(server.contact);
      if (owner) {
        const current = relationMap.get(owner) ?? { owned: 0, supported: 0 };
        relationMap.set(owner, { ...current, owned: current.owned + 1 });
      }
      if (support) {
        const current = relationMap.get(support) ?? { owned: 0, supported: 0 };
        relationMap.set(support, { ...current, supported: current.supported + 1 });
      }
    }
    return relationMap;
  }, [servers]);

  const contactExtraFilters = useMemo<FilterDef<Contact>[]>(
    () => [
      {
        key: 'hasEmail',
        label: 'Has Email',
        predicate: (c) => !!c.email?.trim(),
      },
      {
        key: 'hasPhone',
        label: 'Has Phone',
        predicate: (c) => !!c.phone?.trim(),
      },
      {
        key: 'hasTitle',
        label: 'Has Title',
        predicate: (c) => !!c.title?.trim(),
      },
      {
        key: 'ownsServer',
        label: 'Owns Server',
        predicate: (c) => (serverRelationMap.get(c.email.toLowerCase())?.owned ?? 0) > 0,
      },
      {
        key: 'supportsServer',
        label: 'Supports Server',
        predicate: (c) => (serverRelationMap.get(c.email.toLowerCase())?.supported ?? 0) > 0,
      },
    ],
    [serverRelationMap],
  );

  const filters = useListFilters({
    items: dir.filtered,
    tagSourceItems: contacts,
    getNote: (c) => getContactNote(c.email),
    extraFilters: contactExtraFilters,
    storageKey: 'contacts-list-filters',
  });

  const filtered = filters.filteredItems;
  const clearAllFilters = filters.clearAll;

  const { handleListKeyDown } = useDirectoryKeyboard({
    listRef,
    filtered,
    focusedIndex: dir.focusedIndex,
    setFocusedIndex: dir.setFocusedIndex,
    handleAddWrapper: dir.handleAddWrapper,
    setContextMenu: dir.setContextMenu,
    listContainerRef,
    rowHeight: ROW_HEIGHT,
  });

  const { contextMenu, setContextMenu } = dir;
  useEffect(() => {
    if (contextMenu) {
      const handler = () => setContextMenu(null);
      globalThis.addEventListener('click', handler);
      return () => globalThis.removeEventListener('click', handler);
    }
  }, [contextMenu, setContextMenu]);

  const { handleAddWrapper, groupMap, focusedIndex, setFocusedIndex } = dir;

  // The detail panel follows the stable navigation key, not its row or display identity.
  // Re-filtering can clear the panel but cannot rebind edit or delete actions to another
  // record that happens to share the same email address.
  const [selectedRecordKey, setSelectedRecordKey] = useState<string | null>(null);
  const lastConsumedRequestIdRef = useRef<number | null>(null);
  const [pendingSelectionKey, setPendingSelectionKey] = useState<string | null>(null);
  const lastFocusedIndex = useRef<number | null>(null);
  useEffect(() => {
    if (lastFocusedIndex.current === focusedIndex) return;
    lastFocusedIndex.current = focusedIndex;
    const focusedContact = filtered[focusedIndex];
    setSelectedRecordKey(focusedContact ? contactRecordKey(focusedContact) : null);
  }, [filtered, focusedIndex]);

  useEffect(() => {
    if (
      selectionRequest?.destination !== 'contacts' ||
      lastConsumedRequestIdRef.current === selectionRequest.requestId
    ) {
      return;
    }

    lastConsumedRequestIdRef.current = selectionRequest.requestId;
    const hasRequestedContact = contacts.some(
      (contact) => contactRecordKey(contact) === selectionRequest.recordKey,
    );
    if (!hasRequestedContact) {
      setPendingSelectionKey(null);
      setSelectedRecordKey('');
      setFocusedIndex(-1);
      onSelectionUnavailable?.(selectionRequest);
      return;
    }

    setSearchQuery('');
    clearAllFilters();
    setPendingSelectionKey(selectionRequest.recordKey);
  }, [clearAllFilters, contacts, onSelectionUnavailable, selectionRequest, setFocusedIndex]);

  useEffect(() => {
    if (!pendingSelectionKey) return;
    const requestedIndex = filtered.findIndex(
      (contact) => contactRecordKey(contact) === pendingSelectionKey,
    );
    if (requestedIndex < 0) return;

    const requestedContact = filtered[requestedIndex];
    if (!requestedContact) return;
    setSelectedRecordKey(contactRecordKey(requestedContact));
    setFocusedIndex(requestedIndex);
    listRef.current?.scrollToRow({ index: requestedIndex, align: 'smart' });

    const frame = requestAnimationFrame(() => {
      focusRenderedRecord(listContainerRef.current, pendingSelectionKey);
      setPendingSelectionKey(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [filtered, listRef, pendingSelectionKey, setFocusedIndex]);

  const selectedContact = useMemo(() => {
    // Nothing has been picked yet (the list was still empty when focus first landed),
    // so keep the old behaviour of showing whatever row is focused.
    if (selectedRecordKey === null) return filtered[focusedIndex] ?? null;
    return filtered.find((contact) => contactRecordKey(contact) === selectedRecordKey) ?? null;
  }, [filtered, focusedIndex, selectedRecordKey]);
  const selectedGroups = selectedContact
    ? groupMap.get(selectedContact.email.toLowerCase()) || []
    : [];
  const selectedNote = selectedContact ? getContactNote(selectedContact.email) : undefined;
  const selectedServerRelationships = useMemo(() => {
    if (!selectedContact) return { owned: [], supported: [] };
    const email = selectedContact.email.toLowerCase();
    return {
      owned: servers.filter((server) => normalizeRelationshipEmail(server.owner) === email),
      supported: servers.filter((server) => normalizeRelationshipEmail(server.contact) === email),
    };
  }, [selectedContact, servers]);

  // Keyboard focus follows the focused index so arrow keys move the real focus ring, not just
  // the selection highlight. Only when focus is already inside the list: never steal it.
  useEffect(() => {
    const container = listContainerRef.current;
    const contact = filtered[focusedIndex];
    if (!container || !contact || !container.contains(document.activeElement)) return;
    const recordKey = contactRecordKey(contact);
    if ((document.activeElement as HTMLElement | null)?.dataset.recordKey === recordKey) return;
    const frame = requestAnimationFrame(() => focusRenderedRecord(container, recordKey));
    return () => cancelAnimationFrame(frame);
  }, [filtered, focusedIndex]);

  // The row an open menu, notes editor or delete confirm acts on stays outlined.
  const menuTargetContact = dir.contextMenu?.contact ?? notesContact ?? dir.deleteConfirmation;
  const menuTargetKey = menuTargetContact ? contactRecordKey(menuTargetContact) : null;
  const menuTargetIndex = menuTargetKey
    ? filtered.findIndex((contact) => contactRecordKey(contact) === menuTargetKey)
    : -1;

  const itemData = useMemo(
    () => ({
      filtered,
      groupMap,
      serverRelationMap,
      onContextMenu: (e: React.MouseEvent, contact: Contact) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, contact });
      },
      onOpenActions: (anchor: RowMenuAnchor, contact: Contact) =>
        setContextMenu({ ...anchor, contact }),
      focusedIndex: selectedContact ? filtered.indexOf(selectedContact) : -1,
      menuTargetIndex,
      onRowClick: (i: number) => {
        setFocusedIndex(i);
        const contact = filtered[i];
        setSelectedRecordKey(contact ? contactRecordKey(contact) : null);
      },
    }),
    [
      filtered,
      groupMap,
      serverRelationMap,
      selectedContact,
      menuTargetIndex,
      setFocusedIndex,
      setContextMenu,
    ],
  );

  const handleListFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const recordKey = (e.target as HTMLElement).dataset?.recordKey;
    if (!recordKey) return;
    const index = filtered.findIndex((contact) => contactRecordKey(contact) === recordKey);
    if (index >= 0 && index !== focusedIndex) setFocusedIndex(index);
  };

  return (
    <div className="tab-layout">
      <div className="tab-split-layout">
        <div className="tab-main-content">
          <CollapsibleHeader isCollapsed={dir.isHeaderCollapsed}>
            {filtered.length > 0 && <div className="match-count">{filtered.length} contacts</div>}
            <ListToolbar
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
            >
              <div className="directory-search-control scoped-search-control">
                <SearchInput
                  type="search"
                  aria-label="Filter contacts"
                  placeholder="Filter contacts"
                  className="scoped-search-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
            </ListToolbar>
            <TactileButton
              variant="secondary"
              size="sm"
              className="btn-collapsible directory-add-button"
              onClick={() => dir.setIsAddModalOpen(true)}
              tooltip="Add Contact"
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
              Add Contact
            </TactileButton>
          </CollapsibleHeader>

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
              showNotesFilter={false}
              showTagFilters={false}
            />
          )}

          {/* Delegates keys bubbling from the focusable rows inside; the container itself is not a control. */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div
            ref={listContainerRef}
            aria-label="Contacts list"
            className="tab-list-container"
            onFocus={handleListFocus}
            onKeyDown={(e) => {
              // Notes and quick-action buttons inside a row keep their own Enter/Space behaviour.
              const target = e.target as HTMLElement;
              if (!target.dataset.recordKey && target.closest('button, a, input, textarea')) return;
              handleListKeyDown(e);
            }}
          >
            <AutoSizer
              renderProp={({ height, width }) => (
                <List
                  listRef={listRef}
                  rowCount={filtered.length}
                  rowHeight={ROW_HEIGHT}
                  rowComponent={DirectoryVirtualRow}
                  rowProps={itemData}
                  style={{ height: height ?? 0, width: width ?? 0 }}
                  onScroll={(e) =>
                    dir.setIsHeaderCollapsed((e.target as HTMLDivElement).scrollTop > 30)
                  }
                />
              )}
            />
            {filtered.length === 0 && (
              <EmptyState
                title="No contacts found"
                description={
                  searchQuery.trim() || filters.isAnyFilterActive
                    ? 'Nothing matches the current filter.'
                    : 'Choose Add Contact to make someone searchable and ready for Compose.'
                }
                actions={
                  (searchQuery.trim() || filters.isAnyFilterActive) && (
                    <TactileButton
                      onClick={() => {
                        setSearchQuery('');
                        clearAllFilters();
                      }}
                    >
                      Show All Contacts
                    </TactileButton>
                  )
                }
              />
            )}
          </div>
        </div>
        {selectedContact ? (
          <ContactDetailPanel
            contact={selectedContact}
            groups={selectedGroups}
            noteText={selectedNote?.note}
            tags={selectedNote?.tags}
            relatedServers={selectedServerRelationships}
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
      </div>

      <StatusBar
        left={<StatusBarLive />}
        right={
          <span>
            Showing {filtered.length} of {contacts.length}
          </span>
        }
      />

      <ScrollController
        listRef={listRef}
        focusedIndex={dir.focusedIndex}
        itemCount={filtered.length}
      />

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
          onAddToBridge={() => {
            dir.handleAddWrapper(dir.contextMenu!.contact);
            dir.setContextMenu(null);
          }}
          onManageGroups={() => {
            dir.setGroupSelectorContact(dir.contextMenu!.contact);
            dir.setContextMenu(null);
          }}
          onEditContact={() => {
            dir.setEditingContact(dir.contextMenu!.contact);
            dir.setContextMenu(null);
          }}
          onDeleteContact={() => {
            dir.setDeleteConfirmation(dir.contextMenu!.contact);
            dir.setContextMenu(null);
          }}
          onEditNotes={() => {
            setNotesContact(dir.contextMenu!.contact);
            dir.setContextMenu(null);
          }}
          hasNotes={!!getContactNote(dir.contextMenu.contact.email)}
        />
      )}
      <Modal
        isOpen={Boolean(dir.groupSelectorContact)}
        onClose={() => dir.setGroupSelectorContact(null)}
        title="Manage groups"
        variant="confirmation"
      >
        {dir.groupSelectorContact && (
          <GroupSelector contact={dir.groupSelectorContact} groups={groups} />
        )}
      </Modal>

      <NotesModal
        isOpen={!!notesContact}
        onClose={() => setNotesContact(null)}
        entityType="contact"
        entityId={notesContact?.email || ''}
        entityName={notesContact?.name || notesContact?.email || ''}
        existingNote={notesContact ? getContactNote(notesContact.email) : undefined}
        // setContactNote resolves an IpcResult, which is truthy even when it reports a failure.
        // Returning it unchanged made NotesModal close on a failed save and drop the note.
        onSave={async (note, tags) => {
          if (!notesContact) return false;
          const saved = await setContactNote(notesContact.email, note, tags);
          return saved?.success;
        }}
      />
    </div>
  );
};
