import React, { useState, useMemo, memo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { Server, Contact } from '@shared/ipc';
import { Input } from '../components/Input';
import { ContextMenu } from '../components/ContextMenu';
import { AddServerModal } from '../components/AddServerModal';
import { ToolbarButton } from '../components/ToolbarButton';
import { ResizableHeader } from '../components/ResizableHeader';
import { getColorForString } from '../utils/colors';

interface ServersTabProps {
  servers: Server[];
  contacts: Contact[];
}

type SortField = keyof Server;
type SortOrder = 'asc' | 'desc';

// Default widths
const DEFAULT_WIDTHS = {
  name: 200,
  businessArea: 150,
  lob: 150,
  comment: 200,
  owner: 200,
  contact: 200,
  osType: 100,
  os: 150
};

// Row Component
const ServerRow = memo(({ index, style, data }: ListChildComponentProps<{
  servers: Server[],
  contacts: Contact[],
  columns: typeof DEFAULT_WIDTHS,
  onContextMenu: (e: React.MouseEvent, server: Server) => void
}>) => {
  const { servers, contacts, columns, onContextMenu } = data;
  if (index >= servers.length) return null;

  const server = servers[index];

  const formatValue = (val: string | undefined) => {
      if (!val) return '-';
      const s = String(val).trim();
      if (s === '' || s === '0' || s === '#N/A' || s.toLowerCase() === 'nan') return '-';
      return s;
  };

  const resolveContact = (val: string) => {
     if (!val) return null;
     const lowerVal = val.toLowerCase();
     // Match by email OR name since we might have cleaned it up
     return contacts.find(c =>
         c.email.toLowerCase() === lowerVal ||
         (c.name && c.name.toLowerCase() === lowerVal)
     );
  };

  const renderCell = (key: keyof typeof DEFAULT_WIDTHS, width: number) => {
      let content: React.ReactNode = formatValue(server[key]);
      const rawVal = server[key] || '';

      if ((key === 'owner' || key === 'contact') && rawVal && content !== '-') {
          const contact = resolveContact(rawVal);
          // If we found a contact, or if it's just a string name
          const displayName = contact ? contact.name : rawVal;
          const displayEmail = contact ? contact.email : '';
          const avatarLetter = displayName.charAt(0).toUpperCase();
          const color = getColorForString(displayName);

          content = (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                  <div style={{
                      width: '20px', height: '20px', borderRadius: '50%',
                      background: color, color: '#18181b',
                      fontSize: '10px', fontWeight: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0
                  }}>
                      {avatarLetter}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                       <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '1.2' }}>
                           {displayName}
                       </span>
                       {/* Optional: Show email if it differs? No, simpler is better for now match DirectoryTab */}
                  </div>
              </div>
          );
      }

      return (
          <div style={{
              width,
              paddingRight: '12px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '13px',
              color: 'var(--color-text-primary)'
          }}>
              {content}
          </div>
      );
  };

  return (
      <div
        style={{ ...style, display: 'flex', alignItems: 'center', borderBottom: 'var(--border-subtle)', padding: '0 16px' }}
        onContextMenu={(e) => onContextMenu(e, server)}
        className="contact-row hover-bg" // Reuse contact-row styling for consistency if defined, otherwise hover-bg
      >
          {renderCell('name', columns.name)}
          {renderCell('businessArea', columns.businessArea)}
          {renderCell('lob', columns.lob)}
          {renderCell('comment', columns.comment)}
          {renderCell('owner', columns.owner)}
          {renderCell('contact', columns.contact)}
          {renderCell('osType', columns.osType)}
          {renderCell('os', columns.os)}
      </div>
  );
});

export const ServersTab: React.FC<ServersTabProps> = ({ servers, contacts }) => {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, server: Server } | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | undefined>(undefined);

  // Column Widths State
  const [columnWidths, setColumnWidths] = useState(() => {
      try {
          const saved = localStorage.getItem('relay-servers-columns');
          const parsed = saved ? JSON.parse(saved) : DEFAULT_WIDTHS;
          return { ...DEFAULT_WIDTHS, ...parsed };
      } catch (e) {
          return DEFAULT_WIDTHS;
      }
  });

  const handleResize = (key: keyof typeof DEFAULT_WIDTHS, width: number) => {
      const newWidths = { ...columnWidths, [key]: width };
      setColumnWidths(newWidths);
      localStorage.setItem('relay-servers-columns', JSON.stringify(newWidths));
  };

  const filteredServers = useMemo(() => {
    let result = servers;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(s => s._searchString.includes(q));
    }
    return result.sort((a, b) => {
        const valA = (a[sortField] || '').toString().toLowerCase();
        const valB = (b[sortField] || '').toString().toLowerCase();
        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
    });
  }, [servers, search, sortField, sortOrder]);

  const handleHeaderSort = (field: any) => {
      if (sortField === field) {
          setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
      } else {
          setSortField(field as SortField);
          setSortOrder('asc');
      }
  };

  const handleContextMenu = (e: React.MouseEvent, server: Server) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, server });
  };

  const handleDelete = async () => {
      if (contextMenu) {
          await window.api.removeServer(contextMenu.server.name);
          setContextMenu(null);
      }
  };

  const handleEdit = () => {
      if (contextMenu) {
          setEditingServer(contextMenu.server);
          setIsAddModalOpen(true);
          setContextMenu(null);
      }
  };

  // Close context menu on click elsewhere
  React.useEffect(() => {
      if (contextMenu) {
          const handler = () => setContextMenu(null);
          window.addEventListener('click', handler);
          return () => window.removeEventListener('click', handler);
      }
      return;
  }, [contextMenu]);


  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--color-bg-app)' }}>
      {/* Header / Actions - Matching DirectoryTab Style */}
      <div style={{
        padding: '12px 16px',
        borderBottom: 'var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search servers..."
          icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          }
          style={{ width: '300px' }}
        />
        {filteredServers.length > 0 && (
          <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
            {filteredServers.length} matches
          </div>
        )}
        <div style={{ flex: 1 }}></div>
        <ToolbarButton
            label="ADD SERVER"
            onClick={() => { setEditingServer(undefined); setIsAddModalOpen(true); }}
            primary
        />
      </div>

      {/* Header Row */}
      <div style={{
          display: 'flex',
          padding: '10px 16px',
          borderBottom: 'var(--border-subtle)',
          background: 'rgba(255,255,255,0.02)',
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-tertiary)',
          gap: '16px', // Matches DirectoryTab
          overflow: 'hidden'
      }}>
          <ResizableHeader label="Name" width={columnWidths.name} sortKey="name" currentSort={{ key: sortField, direction: sortOrder }} onSort={handleHeaderSort} onResize={w => handleResize('name', w)} />
          <ResizableHeader label="Business Area" width={columnWidths.businessArea} sortKey="businessArea" currentSort={{ key: sortField, direction: sortOrder }} onSort={handleHeaderSort} onResize={w => handleResize('businessArea', w)} />
          <ResizableHeader label="LOB" width={columnWidths.lob} sortKey="lob" currentSort={{ key: sortField, direction: sortOrder }} onSort={handleHeaderSort} onResize={w => handleResize('lob', w)} />
          <ResizableHeader label="Comment" width={columnWidths.comment} sortKey="comment" currentSort={{ key: sortField, direction: sortOrder }} onSort={handleHeaderSort} onResize={w => handleResize('comment', w)} />
          <ResizableHeader label="Owner" width={columnWidths.owner} sortKey="owner" currentSort={{ key: sortField, direction: sortOrder }} onSort={handleHeaderSort} onResize={w => handleResize('owner', w)} />
          <ResizableHeader label="IT Contact" width={columnWidths.contact} sortKey="contact" currentSort={{ key: sortField, direction: sortOrder }} onSort={handleHeaderSort} onResize={w => handleResize('contact', w)} />
          <ResizableHeader label="OS Type" width={columnWidths.osType} sortKey="osType" currentSort={{ key: sortField, direction: sortOrder }} onSort={handleHeaderSort} onResize={w => handleResize('osType', w)} />
          <ResizableHeader label="OS" width={columnWidths.os} sortKey="os" currentSort={{ key: sortField, direction: sortOrder }} onSort={handleHeaderSort} onResize={w => handleResize('os', w)} />
      </div>

      {/* List */}
      <div style={{ flex: 1 }}>
        <AutoSizer>
          {({ height, width }) => (
            <List
              height={height}
              width={width}
              itemCount={filteredServers.length}
              itemSize={50} // Denser row
              itemData={{ servers: filteredServers, contacts, columns: columnWidths, onContextMenu: handleContextMenu }}
            >
              {ServerRow}
            </List>
          )}
        </AutoSizer>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={[
                { label: 'Edit Server', onClick: handleEdit, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> },
                { label: 'Delete Server', onClick: handleDelete, danger: true, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> }
            ]}
        />
      )}

      <AddServerModal
         isOpen={isAddModalOpen}
         onClose={() => setIsAddModalOpen(false)}
         serverToEdit={editingServer}
      />
    </div>
  );
};
