import React, { memo, useMemo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { Server, Contact } from '@shared/ipc';
import { SearchInput } from '../components/SearchInput';
import { ContextMenu } from '../components/ContextMenu';
import { AddServerModal } from '../components/AddServerModal';
import { TactileButton } from '../components/TactileButton';
import { ServerCard } from '../components/ServerCard';
import { CollapsibleHeader } from '../components/CollapsibleHeader';
import { useServers } from '../hooks/useServers';

interface ServersTabProps { servers: Server[]; contacts: Contact[] }

const VirtualRow = memo(({ index, style, data }: ListChildComponentProps<{ servers: Server[]; contactLookup: Map<string, Contact>; onContextMenu: (e: React.MouseEvent, server: Server) => void; isWide: boolean }>) => {
  const { servers, contactLookup, onContextMenu, isWide } = data;
  if (index >= servers.length) return null;
  return <ServerCard style={style} server={servers[index]} contactLookup={contactLookup} onContextMenu={onContextMenu} isWide={isWide} />;
});

export const ServersTab: React.FC<ServersTabProps> = ({ servers, contacts }) => {
  const h = useServers(servers, contacts);
  const itemData = useMemo(() => ({ servers: h.filteredServers, contactLookup: h.contactLookup, onContextMenu: h.handleContextMenu }), [h.filteredServers, h.contactLookup, h.handleContextMenu]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '20px 24px 24px 24px', background: 'var(--color-bg-app)', overflow: 'hidden' }}>
      <CollapsibleHeader title="Infrastructure Hub" subtitle="Management and status of distributed node infrastructure" isCollapsed={h.isHeaderCollapsed}
        search={<SearchInput placeholder="Search infrastructure..." value={h.search} onChange={(e) => h.setSearch(e.target.value)} autoFocus />}>
        {h.filteredServers.length > 0 && <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', marginRight: '8px' }}>{h.filteredServers.length} matches</div>}
        <TactileButton onClick={() => h.setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')} title={`Sort: ${h.sortOrder === 'asc' ? 'Ascending' : 'Descending'}`} icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points={h.sortOrder === 'asc' ? "19 12 12 19 5 12" : "19 12 12 5 5 12"}></polyline></svg>} style={{ marginRight: '8px', flexShrink: 0, width: '44px', height: '44px', padding: 0 }} />
        <TactileButton onClick={h.openAddModal} variant="primary" style={{ padding: h.isHeaderCollapsed ? '8px 16px' : '15px 32px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>}>ADD SERVER</TactileButton>
      </CollapsibleHeader>

      <div style={{ flex: 1 }}>
        <AutoSizer>
          {({ height, width }) => <List height={height} width={width} itemCount={h.filteredServers.length} itemSize={104} itemData={{ ...itemData, isWide: width > 900 }} onScroll={({ scrollOffset }) => h.setIsHeaderCollapsed(scrollOffset > 30)}>{VirtualRow}</List>}
        </AutoSizer>
        {h.filteredServers.length === 0 && <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', fontStyle: 'italic', flexDirection: 'column', gap: '8px' }}><div style={{ fontSize: '24px', opacity: 0.3 }}>∅</div><div>No infrastructure found</div></div>}
      </div>

      {h.contextMenu && <ContextMenu x={h.contextMenu.x} y={h.contextMenu.y} onClose={() => h.setContextMenu(null)} items={[{ label: 'Edit Server', onClick: h.handleEdit, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> }, { label: 'Delete Server', onClick: h.handleDelete, danger: true, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> }]} />}
      <AddServerModal isOpen={h.isAddModalOpen} onClose={() => h.setIsAddModalOpen(false)} serverToEdit={h.editingServer} />
    </div>
  );
};
