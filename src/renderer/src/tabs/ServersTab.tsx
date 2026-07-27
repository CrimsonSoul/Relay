import React, { useCallback, useMemo, useState } from 'react';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { Server, Contact } from '@shared/ipc';
import { ContextMenu } from '../components/ContextMenu';
import { ConfirmModal } from '../components/ConfirmModal';
import { AddServerModal } from '../components/AddServerModal';
import { TactileButton } from '../components/TactileButton';
import { ServerCard } from '../components/ServerCard';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { ListToolbar } from '../components/ListToolbar';
import { ListFilters } from '../components/ListFilters';
import { ServerDetailPanel } from '../components/ServerDetailPanel';
import { NotesModal } from '../components/NotesModal';
import { useServers } from '../hooks/useServers';
import { useListFilters, type FilterDef } from '../hooks/useListFilters';
import { useNotesContext } from '../contexts';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { SearchInput } from '../components/SearchInput';

interface ServersTabProps {
  servers: Server[];
  contacts: Contact[];
}

/** Minimal mouse-event shape shared by native MouseEvent and React.MouseEvent */
type ContextMenuEvent = Pick<MouseEvent, 'preventDefault' | 'clientX' | 'clientY'>;

interface ServerVirtualRowData {
  servers: Server[];
  contactLookup: Map<string, Contact>;
  onContextMenu: (e: ContextMenuEvent, server: Server) => void;
  selectedIndex: number;
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
  const { servers, contactLookup, onContextMenu, selectedIndex, onRowClick } = data;
  const server = servers[index];
  if (!server) return null;
  return (
    <ServerCard
      style={style}
      server={server}
      ownerName={getContactDisplayName(server.owner, contactLookup)}
      supportName={getContactDisplayName(server.contact, contactLookup)}
      onContextMenu={onContextMenu}
      selected={index === selectedIndex}
      onRowClick={() => onRowClick(index)}
    />
  );
}

export const ServersTab: React.FC<ServersTabProps> = ({ servers, contacts }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const h = useServers(servers, contacts, searchQuery);
  const { getServerNote, setServerNote } = useNotesContext();
  const [notesServer, setNotesServer] = useState<Server | null>(null);
  // The detail panel is bound to a server by name, never by row position: filters reorder
  // and shorten the list, and a positional index would silently repoint the panel — and
  // its Delete button — at a machine the operator is not looking at.
  const [selectedServerName, setSelectedServerName] = useState<string | null>(null);
  const [serverPendingDeletion, setServerPendingDeletion] = useState<Server | null>(null);

  const serverExtraFilters = useMemo<FilterDef<Server>[]>(() => {
    const availableOperatingSystems = new Set(
      servers.map((server) => normalizeServerField(server.os).toLowerCase()).filter(Boolean),
    );
    const operatingSystemFilters = usefulOsFilters
      .filter((os) => Array.from(availableOperatingSystems).some(os.matches))
      .map((os) => ({
        key: `os:${os.key}`,
        label: os.label,
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
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
          </svg>
        ),
        predicate: (server: Server) => os.matches(normalizeServerField(server.os).toLowerCase()),
      }));

    return [
      {
        key: 'missingOwner',
        label: 'Missing Owner',
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
            <circle cx="12" cy="7" r="4" />
            <path d="M4 21v-2a4 4 0 0 1 4-4h4" />
            <path d="M17 17l4 4M21 17l-4 4" />
          </svg>
        ),
        predicate: (s) => !normalizeServerField(s.owner),
      },
      {
        key: 'missingSupport',
        label: 'Missing Support',
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
            <path d="M9 11a3 3 0 1 0 6 0 3 3 0 0 0-6 0" />
            <path d="M17 17l4 4M21 17l-4 4" />
          </svg>
        ),
        predicate: (s) => !normalizeServerField(s.contact),
      },
      {
        key: 'hasComment',
        label: 'Has Comment',
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
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
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
  });

  const displayedServers = filters.filteredItems;

  const selectedServer = useMemo(() => {
    // Before anything is picked we land on the first record, matching the previous
    // index-0 default. Once a server is chosen we resolve it by name, so re-filtering
    // can only clear the panel — never swap it for a different machine.
    if (selectedServerName === null) return displayedServers[0] ?? null;
    return displayedServers.find((server) => server.name === selectedServerName) ?? null;
  }, [displayedServers, selectedServerName]);
  const selectedIndex = selectedServer ? displayedServers.indexOf(selectedServer) : -1;
  const selectedNote = selectedServer ? getServerNote(selectedServer.name) : undefined;

  const rowProps = useMemo(
    () => ({
      servers: displayedServers,
      contactLookup: h.contactLookup,
      onContextMenu: h.handleContextMenu,
      selectedIndex,
      onRowClick: (i: number) => setSelectedServerName(displayedServers[i]?.name ?? null),
    }),
    [displayedServers, h.contactLookup, h.handleContextMenu, selectedIndex],
  );

  const { deleteServer } = h;
  const handleConfirmDeleteServer = useCallback(() => {
    if (!serverPendingDeletion) return;
    // Returned so ConfirmModal keeps itself open and reports a rejected delete inline
    return deleteServer(serverPendingDeletion);
  }, [deleteServer, serverPendingDeletion]);

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
              variant="primary"
              className="btn-collapsible"
              tooltip="Add server"
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
              ADD SERVER
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

          <section className="tab-list-container" aria-label="Servers list">
            <AutoSizer
              renderProp={({ height, width }) => (
                <List
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
              <div className="tab-empty-state">
                <div className="tab-empty-state-icon">∅</div>
                <div>No infrastructure found</div>
              </div>
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

      {/* Both delete paths land here — contacts and on-call cards already confirm, and a
          server record is no cheaper to lose */}
      <ConfirmModal
        isOpen={!!serverPendingDeletion}
        onClose={() => setServerPendingDeletion(null)}
        onConfirm={handleConfirmDeleteServer}
        title="Delete Server"
        message={`Delete ${serverPendingDeletion?.name ?? ''}? This action cannot be undone.`}
        confirmLabel="Delete"
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
