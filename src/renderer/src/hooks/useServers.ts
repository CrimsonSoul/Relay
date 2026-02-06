import { useState, useMemo, useCallback, useEffect } from 'react';
import { Server, Contact } from '@shared/ipc';
import { useDebounce } from './useDebounce';

export function useServers(servers: Server[], contacts: Contact[]) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; server: Server } | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | undefined>(undefined);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);

  const contactLookup = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const contact of contacts) { if (contact.email) map.set(contact.email.toLowerCase(), contact); if (contact.name) map.set(contact.name.toLowerCase(), contact); }
    return map;
  }, [contacts]);

  const filteredServers = useMemo(() => {
    let result = [...servers];
    if (debouncedSearch) { const q = debouncedSearch.toLowerCase(); result = result.filter(s => s._searchString.includes(q)); }
    return result.sort((a, b) => { const valA = (a.name || '').toLowerCase(), valB = (b.name || '').toLowerCase(); if (valA < valB) return sortOrder === 'asc' ? -1 : 1; if (valA > valB) return sortOrder === 'asc' ? 1 : -1; return 0; });
  }, [servers, debouncedSearch, sortOrder]);

  const handleContextMenu = useCallback((e: React.MouseEvent, server: Server) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, server }); }, []);

  useEffect(() => { if (contextMenu) { const handler = () => setContextMenu(null); window.addEventListener('click', handler); return () => window.removeEventListener('click', handler); } }, [contextMenu]);

  const handleDelete = async () => { if (contextMenu) { try { await window.api?.removeServer(contextMenu.server.name); } catch { /* handled by IPC layer */ } setContextMenu(null); } };
  const handleEdit = () => { if (contextMenu) { setEditingServer(contextMenu.server); setIsAddModalOpen(true); setContextMenu(null); } };
  const openAddModal = () => { setEditingServer(undefined); setIsAddModalOpen(true); };

  return { search, setSearch, sortOrder, setSortOrder, contextMenu, setContextMenu, isAddModalOpen, setIsAddModalOpen, editingServer, isHeaderCollapsed, setIsHeaderCollapsed, contactLookup, filteredServers, handleContextMenu, handleDelete, handleEdit, openAddModal };
}
