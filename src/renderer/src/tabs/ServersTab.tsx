import React, { memo, useMemo, useState, useCallback } from 'react';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { Server, Contact, NoteEntry } from '@shared/ipc';
import { SearchInput } from '../components/SearchInput';
import { ContextMenu } from '../components/ContextMenu';
import { AddServerModal } from '../components/AddServerModal';
import { TactileButton } from '../components/TactileButton';
import { ServerCard } from '../components/ServerCard';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { NotesModal } from '../components/NotesModal';
import { useServers } from '../hooks/useServers';
import { useNotesContext } from '../contexts';

interface ServersTabProps {
  servers: Server[];
  contacts: Contact[];
}

interface ServerVirtualRowData {
  servers: Server[];
  contactLookup: Map<string, Contact>;
  onContextMenu: (e: React.MouseEvent, server: Server) => void;
  getServerNote: (name: string) => NoteEntry | undefined;
  onNotesClick: (server: Server) => void;
}

const VirtualRow = memo(({ index, style, ...data }: RowComponentProps<ServerVirtualRowData>) => {
  const { servers, contactLookup, onContextMenu, getServerNote, onNotesClick } = data;
  if (index >= servers.length) return null;
  const server = servers[index];
  const noteEntry = getServerNote(server.name);
  return (
    <ServerCard
      style={style}
      server={server}
      contactLookup={contactLookup}
      onContextMenu={onContextMenu}
      hasNotes={!!noteEntry?.note}
      tags={noteEntry?.tags}
      onNotesClick={() => onNotesClick(server)}
    />
  );
});

export const ServersTab: React.FC<ServersTabProps> = ({ servers, contacts }) => {
  const h = useServers(servers, contacts);
  const { getServerNote, setServerNote } = useNotesContext();
  const [notesServer, setNotesServer] = useState<Server | null>(null);
  const handleNotesClick = useCallback((server: Server) => setNotesServer(server), []);
  const rowProps = useMemo(
    () => ({
      servers: h.filteredServers,
      contactLookup: h.contactLookup,
      onContextMenu: h.handleContextMenu,
      getServerNote,
      onNotesClick: handleNotesClick,
    }),
    [h.filteredServers, h.contactLookup, h.handleContextMenu, getServerNote, handleNotesClick],
  );

  return (
    <div
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 32px',
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      <CollapsibleHeader
        title="Infrastructure Hub"
        subtitle="Management and status of distributed node infrastructure"
        isCollapsed={h.isHeaderCollapsed}
        search={
          <SearchInput
            placeholder="Search infrastructure..."
            value={h.search}
            onChange={(e) => h.setSearch(e.target.value)}
            autoFocus
          />
        }
      >
        {h.filteredServers.length > 0 && (
          <div
            style={{
              fontSize: '13px',
              color: 'var(--color-text-tertiary)',
              whiteSpace: 'nowrap',
              marginRight: '8px',
            }}
          >
            {h.filteredServers.length} matches
          </div>
        )}
        <TactileButton
          onClick={() => h.setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
          title={`Sort: ${h.sortOrder === 'asc' ? 'Ascending' : 'Descending'}`}
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
                points={h.sortOrder === 'asc' ? '19 12 12 19 5 12' : '19 12 12 5 5 12'}
              ></polyline>
            </svg>
          }
          style={{ marginRight: '8px', flexShrink: 0, width: '44px', height: '44px', padding: 0 }}
        />
        <TactileButton
          onClick={h.openAddModal}
          variant="primary"
          style={{
            padding: h.isHeaderCollapsed ? '8px 16px' : '15px 32px',
            transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
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
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          }
        >
          ADD SERVER
        </TactileButton>
      </CollapsibleHeader>

      <div style={{ flex: 1, minHeight: 0 }}>
        <AutoSizer
          renderProp={({ height, width }) => (
            <List
              style={{ height: height ?? 0, width: width ?? 0 }}
              rowCount={h.filteredServers.length}
              rowHeight={104}
              rowComponent={VirtualRow}
              rowProps={rowProps}
              onScroll={(e) => h.setIsHeaderCollapsed((e.target as HTMLDivElement).scrollTop > 30)}
            />
          )}
        />
        {h.filteredServers.length === 0 && (
          <div
            style={{
              height: '200px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-tertiary)',
              fontStyle: 'italic',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '24px', opacity: 0.3 }}>∅</div>
            <div>No infrastructure found</div>
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
              onClick: h.handleDelete,
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
