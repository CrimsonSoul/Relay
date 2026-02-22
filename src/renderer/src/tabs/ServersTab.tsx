import React, { memo, useMemo, useState, useEffect } from 'react';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { Server, Contact } from '@shared/ipc';
import { ContextMenu } from '../components/ContextMenu';
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

interface ServersTabProps {
  servers: Server[];
  contacts: Contact[];
}

interface ServerVirtualRowData {
  servers: Server[];
  onContextMenu: (e: React.MouseEvent, server: Server) => void;
  selectedIndex: number;
  onRowClick: (index: number) => void;
}

const ROW_HEIGHT = 80;

const VirtualRow = memo(({ index, style, ...data }: RowComponentProps<ServerVirtualRowData>) => {
  const { servers, onContextMenu, selectedIndex, onRowClick } = data;
  if (index >= servers.length) return null;
  const server = servers[index];
  return (
    <ServerCard
      style={style}
      server={server}
      onContextMenu={onContextMenu}
      selected={index === selectedIndex}
      onRowClick={() => onRowClick(index)}
    />
  );
});

export const ServersTab: React.FC<ServersTabProps> = ({ servers, contacts }) => {
  const h = useServers(servers, contacts);
  const { getServerNote, setServerNote } = useNotesContext();
  const [notesServer, setNotesServer] = useState<Server | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const serverExtraFilters = useMemo<FilterDef<Server>[]>(
    () => [
      {
        key: 'hasOwner',
        label: 'Has Owner',
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
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ),
        predicate: (s) => !!s.owner?.trim(),
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
    ],
    [],
  );

  const filters = useListFilters({
    items: h.filteredServers,
    tagSourceItems: servers,
    getNote: (s) => getServerNote(s.name),
    extraFilters: serverExtraFilters,
  });

  const displayedServers = filters.filteredItems;

  // Clamp selection when list changes
  useEffect(() => {
    if (displayedServers.length === 0) {
      setSelectedIndex(0);
    } else if (selectedIndex >= displayedServers.length) {
      setSelectedIndex(displayedServers.length - 1);
    }
  }, [displayedServers.length, selectedIndex]);

  const selectedServer =
    selectedIndex >= 0 && selectedIndex < displayedServers.length
      ? displayedServers[selectedIndex]
      : null;
  const selectedNote = selectedServer ? getServerNote(selectedServer.name) : undefined;

  const rowProps = useMemo(
    () => ({
      servers: displayedServers,
      onContextMenu: h.handleContextMenu,
      selectedIndex,
      onRowClick: (i: number) => setSelectedIndex(i),
    }),
    [displayedServers, h.handleContextMenu, selectedIndex],
  );

  return (
    <div className="tab-layout">
      <div className="tab-split-layout">
        {selectedServer ? (
          <ServerDetailPanel
            server={selectedServer}
            contactLookup={h.contactLookup}
            noteText={selectedNote?.note}
            tags={selectedNote?.tags}
            onEditNotes={() => setNotesServer(selectedServer)}
            onEdit={() => h.editServer(selectedServer)}
            onDelete={() => {
              void h.deleteServer(selectedServer);
              setSelectedIndex(0);
            }}
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
        <div className="tab-main-content">
          <CollapsibleHeader isCollapsed={h.isHeaderCollapsed}>
            {displayedServers.length > 0 && (
              <div className="match-count">{displayedServers.length} servers</div>
            )}
            <TactileButton
              onClick={h.openAddModal}
              variant="primary"
              className="btn-collapsible"
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

          <ListToolbar
            search={h.search}
            onSearchChange={h.setSearch}
            placeholder="Search Servers"
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
          />

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
                void h.handleDelete();
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

      <NotesModal
        isOpen={!!notesServer}
        onClose={() => setNotesServer(null)}
        entityType="server"
        entityId={notesServer?.name || ''}
        entityName={notesServer?.name || ''}
        existingNote={notesServer ? getServerNote(notesServer.name) : undefined}
        onSave={(note, tags) => setServerNote(notesServer!.name, note, tags)}
      />
    </div>
  );
};
