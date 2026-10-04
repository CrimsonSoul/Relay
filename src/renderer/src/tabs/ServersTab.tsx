import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { Server, Contact } from '@shared/ipc';
import { ContextMenu } from '../components/ContextMenu';
import { ConfirmModal } from '../components/ConfirmModal';
import { AddServerModal } from '../components/AddServerModal';
import { TactileButton } from '../components/TactileButton';
import { ServerCard } from '../components/ServerCard';
import type { RowMenuAnchor } from '../components/directory/RowActionsButton';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { ListToolbar } from '../components/ListToolbar';
import { ListFilters } from '../components/ListFilters';
import { ServerDetailPanel } from '../components/ServerDetailPanel';
import { NotesModal } from '../components/NotesModal';
import { useServers } from '../hooks/useServers';
import { useServersKeyboard } from '../hooks/useServersKeyboard';
import { useListFilters, type FilterDef } from '../hooks/useListFilters';
import { useNotesContext } from '../contexts';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { SearchInput } from '../components/SearchInput';
import {
  serverRecordKey,
  type KnowledgeRecordOpenRequest,
} from '../features/knowledge/knowledgeRecordNavigation';

interface ServersTabProps {
  servers: Server[];
  contacts: Contact[];
  selectionRequest?: KnowledgeRecordOpenRequest | null;
  onSelectionUnavailable?: (request: KnowledgeRecordOpenRequest) => void;
}

/** Minimal mouse-event shape shared by native MouseEvent and React.MouseEvent */
type ContextMenuEvent = Pick<MouseEvent, 'preventDefault' | 'clientX' | 'clientY'>;

interface ServerVirtualRowData {
  servers: Server[];
  contactLookup: Map<string, Contact>;
  onContextMenu: (e: ContextMenuEvent, server: Server) => void;
  /** Opens the server's menu from the row's `⋯` button. */
  onOpenActions: (anchor: RowMenuAnchor, server: Server) => void;
  selectedIndex: number;
  /** Row an open context menu, notes editor or delete confirm acts on; -1 for none. */
  menuTargetIndex: number;
  onRowClick: (index: number) => void;
}

// Matches DirectoryTab's ROW_HEIGHT so People and Servers rows are identical.
const ROW_HEIGHT = 67;

const normalizeServerField = (value: string | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '-' || trimmed === '0') return '';
  return trimmed;
};

const getContactDisplayName = (email: string, contactLookup: Map<string, Contact>) => {
  const normalized = normalizeServerField(email).toLowerCase();
  if (!normalized) return '';
  return contactLookup.get(normalized)?.name || email;
};

function focusRenderedRecord(container: HTMLElement | null, recordKey: string): void {
  const row = Array.from(container?.querySelectorAll<HTMLElement>('[data-record-key]') ?? []).find(
    (node) => node.dataset.recordKey === recordKey,
  );
  row?.focus();
}

const usefulOsFilters: Array<{ key: string; label: string; matches: (os: string) => boolean }> = [
  {
    key: 'linux',
    label: 'Linux',
    matches: (os) => /\b(linux|ubuntu|debian|centos|rhel|red hat|fedora|suse|alpine)\b/.test(os),
  },
  {
    key: 'windows',
    label: 'Windows',
    matches: (os) => /\b(windows|win server)\b/.test(os),
  },
];

// Not wrapped in React.memo: react-window already memoises whatever it is handed, with a
// comparator that understands its own `style`/`ariaAttributes` props. A MemoExoticComponent also
// widens the return type to ReactNode, which its `rowComponent` prop rejects.
function VirtualRow({ index, style, ...data }: RowComponentProps<ServerVirtualRowData>) {
  const {
    servers,
    contactLookup,
    onContextMenu,
    onOpenActions,
    selectedIndex,
    menuTargetIndex,
    onRowClick,
  } = data;
  const server = servers[index];
  if (!server) return null;
  return (
    <ServerCard
      style={style}
      server={server}
      ownerName={getContactDisplayName(server.owner, contactLookup)}
      supportName={getContactDisplayName(server.contact, contactLookup)}
      recordKey={serverRecordKey(server)}
      onContextMenu={onContextMenu}
      selected={index === selectedIndex}
      menuTarget={index === menuTargetIndex}
      onRowClick={() => onRowClick(index)}
      onOpenActions={(anchor) => onOpenActions(anchor, server)}
    />
  );
}

export const ServersTab: React.FC<ServersTabProps> = ({
  servers,
  contacts,
  selectionRequest,
  onSelectionUnavailable,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const h = useServers(servers, contacts, searchQuery);
  const listRef = useListRef(null);
  const listContainerRef = useRef<HTMLElement>(null);
  const { getServerNote, setServerNote } = useNotesContext();
  const [notesServer, setNotesServer] = useState<Server | null>(null);
  // The detail panel is bound to the stable navigation key, never a row position or name:
  // filters reorder the list, and duplicate names must not redirect edit or delete actions.
  const [selectedRecordKey, setSelectedRecordKey] = useState<string | null>(null);
  const lastConsumedRequestIdRef = useRef<number | null>(null);
  const [pendingSelectionKey, setPendingSelectionKey] = useState<string | null>(null);
  const [serverPendingDeletion, setServerPendingDeletion] = useState<Server | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const serverExtraFilters = useMemo<FilterDef<Server>[]>(() => {
    const availableOperatingSystems = new Set(
      servers.map((server) => normalizeServerField(server.os).toLowerCase()).filter(Boolean),
    );
    const operatingSystemFilters = usefulOsFilters
      .filter((os) => Array.from(availableOperatingSystems).some(os.matches))
      .map((os) => ({
        key: `os:${os.key}`,
        label: os.label,
        predicate: (server: Server) => os.matches(normalizeServerField(server.os).toLowerCase()),
      }));

    return [
      {
        key: 'missingOwner',
        label: 'Missing Owner',
        predicate: (s) => !normalizeServerField(s.owner),
      },
      {
        key: 'missingSupport',
        label: 'Missing Support',
        predicate: (s) => !normalizeServerField(s.contact),
      },
      {
        key: 'hasComment',
        label: 'Has Comment',
        predicate: (s) => !!s.comment?.trim(),
      },
      ...operatingSystemFilters,
    ];
  }, [servers]);

  const filters = useListFilters({
    items: h.filteredServers,
    tagSourceItems: servers,
    getNote: (s) => getServerNote(s.name),
    extraFilters: serverExtraFilters,
    storageKey: 'servers-list-filters',
  });

  const displayedServers = filters.filteredItems;
  const clearAllFilters = filters.clearAll;

  useEffect(() => {
    if (
      selectionRequest?.destination !== 'servers' ||
      lastConsumedRequestIdRef.current === selectionRequest.requestId
    ) {
      return;
    }

    lastConsumedRequestIdRef.current = selectionRequest.requestId;
    const hasRequestedServer = servers.some(
      (server) => serverRecordKey(server) === selectionRequest.recordKey,
    );
    if (!hasRequestedServer) {
      setPendingSelectionKey(null);
      setSelectedRecordKey('');
      onSelectionUnavailable?.(selectionRequest);
      return;
    }

    setSearchQuery('');
    clearAllFilters();
    setPendingSelectionKey(selectionRequest.recordKey);
  }, [clearAllFilters, onSelectionUnavailable, selectionRequest, servers]);

  useEffect(() => {
    if (!pendingSelectionKey) return;
    const requestedIndex = displayedServers.findIndex(
      (server) => serverRecordKey(server) === pendingSelectionKey,
    );
    if (requestedIndex < 0) return;

    const requestedServer = displayedServers[requestedIndex];
    if (!requestedServer) return;
    setSelectedRecordKey(serverRecordKey(requestedServer));
    setFocusedIndex(requestedIndex);
    listRef.current?.scrollToRow({ index: requestedIndex, align: 'smart' });

    const frame = requestAnimationFrame(() => {
      focusRenderedRecord(listContainerRef.current, pendingSelectionKey);
      setPendingSelectionKey(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [displayedServers, listRef, pendingSelectionKey]);

  const selectedServer = useMemo(() => {
    // Before anything is picked we land on the first record, matching the previous
    // index-0 default. Once chosen, stable-key resolution keeps duplicate names exact.
    if (selectedRecordKey === null) return displayedServers[0] ?? null;
    return displayedServers.find((server) => serverRecordKey(server) === selectedRecordKey) ?? null;
  }, [displayedServers, selectedRecordKey]);
  const selectedIndex = selectedServer ? displayedServers.indexOf(selectedServer) : -1;
  const selectedNote = selectedServer ? getServerNote(selectedServer.name) : undefined;

  const selectServer = useCallback(
    (server: Server) => setSelectedRecordKey(serverRecordKey(server)),
    [],
  );
  // '' resolves to no record, so the detail panel falls back to its placeholder.
  const clearSelection = useCallback(() => setSelectedRecordKey(''), []);
  const { handleListKeyDown } = useServersKeyboard({
    listRef,
    servers: displayedServers,
    focusedIndex,
    setFocusedIndex,
    onSelect: selectServer,
    onClearSelection: clearSelection,
    setContextMenu: h.setContextMenu,
    listContainerRef,
    rowHeight: ROW_HEIGHT,
  });

  // Keyboard focus follows the focused index so arrow keys move the real focus ring. Only when
  // focus is already inside the list: never steal it.
  useEffect(() => {
    const container = listContainerRef.current;
    const server = displayedServers[focusedIndex];
    if (!container || !server || !container.contains(document.activeElement)) return;
    const recordKey = serverRecordKey(server);
    if ((document.activeElement as HTMLElement | null)?.dataset.recordKey === recordKey) return;
    const frame = requestAnimationFrame(() => focusRenderedRecord(container, recordKey));
    return () => cancelAnimationFrame(frame);
  }, [displayedServers, focusedIndex]);

  // The row an open menu, notes editor or delete confirm acts on stays outlined.
  const menuTargetServer = h.contextMenu?.server ?? notesServer ?? serverPendingDeletion;
  const menuTargetKey = menuTargetServer ? serverRecordKey(menuTargetServer) : null;
  const menuTargetIndex = menuTargetKey
    ? displayedServers.findIndex((server) => serverRecordKey(server) === menuTargetKey)
    : -1;

  const setServerContextMenu = h.setContextMenu;
  const rowProps = useMemo(
    () => ({
      servers: displayedServers,
      contactLookup: h.contactLookup,
      onContextMenu: h.handleContextMenu,
      onOpenActions: (anchor: RowMenuAnchor, server: Server) =>
        setServerContextMenu({ ...anchor, server }),
      selectedIndex,
      menuTargetIndex,
      onRowClick: (i: number) => {
        const server = displayedServers[i];
        setFocusedIndex(i);
        setSelectedRecordKey(server ? serverRecordKey(server) : null);
      },
    }),
    [
      displayedServers,
      h.contactLookup,
      h.handleContextMenu,
      setServerContextMenu,
      selectedIndex,
      menuTargetIndex,
    ],
  );

  const handleListFocus = (e: React.FocusEvent<HTMLElement>) => {
    const recordKey = (e.target as HTMLElement).dataset?.recordKey;
    if (!recordKey) return;
    const index = displayedServers.findIndex((server) => serverRecordKey(server) === recordKey);
    if (index >= 0 && index !== focusedIndex) setFocusedIndex(index);
  };

  const { requestDeleteServer } = h;
  const handleConfirmDeleteServer = useCallback(() => {
    if (!serverPendingDeletion) return;
    // The row hides at once; the delete is written when the Undo toast closes, and a
    // rejected write brings the row back with an error toast.
    requestDeleteServer(serverPendingDeletion);
  }, [requestDeleteServer, serverPendingDeletion]);
  // Server names repeat across environments; area and OS say exactly which record goes.
  const pendingDeletionContext = serverPendingDeletion
    ? [serverPendingDeletion.businessArea, serverPendingDeletion.os]
        .map((value) => normalizeServerField(value))
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div className="tab-layout">
      <div className="tab-split-layout">
        <div className="tab-main-content">
          <CollapsibleHeader isCollapsed={h.isHeaderCollapsed}>
            {displayedServers.length > 0 && (
              <div className="match-count">{displayedServers.length} servers</div>
            )}
            <ListToolbar
              sortDirection={h.sortOrder}
              onToggleSortDirection={() =>
                h.setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
              }
              sortKey={h.sortKey}
              sortOptions={[
                { value: 'name', label: 'Name' },
                { value: 'businessArea', label: 'Business Area' },
                { value: 'lob', label: 'LOB' },
                { value: 'owner', label: 'Owner' },
                { value: 'os', label: 'OS' },
              ]}
              onSortKeyChange={(key) =>
                h.setSortKey(key as 'name' | 'businessArea' | 'lob' | 'owner' | 'os')
              }
            >
              <div className="directory-search-control scoped-search-control">
                <SearchInput
                  type="search"
                  aria-label="Filter servers"
                  placeholder="Filter servers"
                  className="scoped-search-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
            </ListToolbar>
            <TactileButton
              onClick={h.openAddModal}
              variant="secondary"
              size="sm"
              className="btn-collapsible directory-add-button"
              tooltip="Add Server"
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
                  <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                  <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                  <line x1="12" y1="6" x2="12" y2="6.01" strokeWidth="3" />
                  <line x1="12" y1="18" x2="12" y2="18.01" strokeWidth="3" />
                </svg>
              }
            >
              Add Server
            </TactileButton>
          </CollapsibleHeader>

          {(h.filteredServers.length > 0 || filters.isAnyFilterActive) && (
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

          {/* Delegates keys bubbling from the focusable rows inside; the section itself is not a control. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <section
            ref={listContainerRef}
            className="tab-list-container"
            aria-label="Servers list"
            onFocus={handleListFocus}
            onKeyDown={handleListKeyDown}
          >
            <AutoSizer
              renderProp={({ height, width }) => (
                <List
                  listRef={listRef}
                  style={{ height: height ?? 0, width: width ?? 0 }}
                  rowCount={displayedServers.length}
                  rowHeight={ROW_HEIGHT}
                  rowComponent={VirtualRow}
                  rowProps={rowProps}
                  onScroll={(e) =>
                    h.setIsHeaderCollapsed((e.target as HTMLDivElement).scrollTop > 30)
                  }
                />
              )}
            />
            {displayedServers.length === 0 && (
              <EmptyState
                title="No infrastructure found"
                description={
                  searchQuery.trim() || filters.isAnyFilterActive
                    ? 'Nothing matches the current filter.'
                    : 'Choose Add Server to record a server and its owners.'
                }
                actions={
                  (searchQuery.trim() || filters.isAnyFilterActive) && (
                    <TactileButton
                      onClick={() => {
                        setSearchQuery('');
                        clearAllFilters();
                      }}
                    >
                      Show All Servers
                    </TactileButton>
                  )
                }
              />
            )}
          </section>
        </div>
        {selectedServer ? (
          <ServerDetailPanel
            server={selectedServer}
            contactLookup={h.contactLookup}
            noteText={selectedNote?.note}
            tags={selectedNote?.tags}
            onEditNotes={() => setNotesServer(selectedServer)}
            onEdit={() => h.editServer(selectedServer)}
            onDelete={() => setServerPendingDeletion(selectedServer)}
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
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
              <span>Select a server</span>
            </div>
          </div>
        )}
      </div>

      {h.contextMenu && (
        <ContextMenu
          x={h.contextMenu.x}
          y={h.contextMenu.y}
          onClose={() => h.setContextMenu(null)}
          items={[
            {
              label: getServerNote(h.contextMenu.server.name) ? 'Edit Notes' : 'Add Notes',
              onClick: () => {
                setNotesServer(h.contextMenu!.server);
                h.setContextMenu(null);
              },
              icon: (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                </svg>
              ),
            },
            {
              label: 'Edit Server',
              onClick: h.handleEdit,
              icon: (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              ),
            },
            {
              label: 'Delete Server',
              onClick: () => {
                setServerPendingDeletion(h.contextMenu!.server);
                h.setContextMenu(null);
              },
              danger: true,
              icon: (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              ),
            },
          ]}
        />
      )}
      <AddServerModal
        isOpen={h.isAddModalOpen}
        onClose={() => h.setIsAddModalOpen(false)}
        serverToEdit={h.editingServer}
      />

      {/* Both delete paths land here: the confirm names the exact record (names repeat
          across environments), and the Undo toast that follows keeps it recoverable */}
      <ConfirmModal
        isOpen={!!serverPendingDeletion}
        onClose={() => setServerPendingDeletion(null)}
        onConfirm={handleConfirmDeleteServer}
        title="Delete server"
        message={`Delete ${serverPendingDeletion?.name ?? ''}${
          pendingDeletionContext ? ` (${pendingDeletionContext})` : ''
        }? You can undo this from the notice that follows.`}
        confirmLabel="Delete Server"
        isDanger
      />

      <NotesModal
        isOpen={!!notesServer}
        onClose={() => setNotesServer(null)}
        entityType="server"
        entityId={notesServer?.name || ''}
        entityName={notesServer?.name || ''}
        existingNote={notesServer ? getServerNote(notesServer.name) : undefined}
        // setServerNote resolves an IpcResult, which is truthy even when it reports a failure.
        // Returning it unchanged made NotesModal close on a failed save and drop the note.
        onSave={async (note, tags) => {
          if (!notesServer) return false;
          const saved = await setServerNote(notesServer.name, note, tags);
          return saved?.success;
        }}
      />

      <StatusBar
        left={<StatusBarLive />}
        right={
          <span>
            Showing {displayedServers.length} of {servers.length}
          </span>
        }
      />
    </div>
  );
};
