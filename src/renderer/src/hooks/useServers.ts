import { useState, useMemo, useCallback, useEffect } from 'react';
import { Server, Contact } from '@shared/ipc';
import { useSearchContext } from '../contexts/SearchContext';
import { deleteServer as pbDeleteServer } from '../services/serverService';

export function useServers(servers: Server[], contacts: Contact[]) {
  const { debouncedQuery: debouncedSearch } = useSearchContext();
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [sortKey, setSortKey] = useState<'name' | 'businessArea' | 'lob' | 'owner' | 'os'>('name');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; server: Server } | null>(
    null,
  );
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | undefined>(undefined);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);

  const contactLookup = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const contact of contacts) {
      if (contact.email) map.set(contact.email.toLowerCase(), contact);
      if (contact.name) map.set(contact.name.toLowerCase(), contact);
    }
    return map;
  }, [contacts]);

  const filteredServers = useMemo(() => {
    let result = [...servers];
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((s) => s._searchString.includes(q));
    }
    return result.sort((a, b) => {
      const valA = (a[sortKey] || '').toLowerCase(),
        valB = (b[sortKey] || '').toLowerCase();
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [servers, debouncedSearch, sortOrder, sortKey]);

  const handleContextMenu = useCallback(
    (e: Pick<MouseEvent, 'preventDefault' | 'clientX' | 'clientY'>, server: Server) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, server });
    },
    [],
  );

  useEffect(() => {
    if (contextMenu) {
      const handler = () => setContextMenu(null);
      globalThis.addEventListener('click', handler);
      return () => globalThis.removeEventListener('click', handler);
    }
  }, [contextMenu]);

  const handleDelete = useCallback(async () => {
    if (contextMenu) {
      try {
        const serverId = contextMenu.server.raw?.id;
        if (serverId) {
          await pbDeleteServer(serverId);
        }
      } catch {
        // Errors surface via useCollection realtime updates
      }
      setContextMenu(null);
    }
  }, [contextMenu]);

  const handleEdit = useCallback(() => {
    if (contextMenu) {
      setEditingServer(contextMenu.server);
      setIsAddModalOpen(true);
      setContextMenu(null);
    }
  }, [contextMenu]);

  const editServer = useCallback((server: Server) => {
    setEditingServer(server);
    setIsAddModalOpen(true);
  }, []);

  const deleteServer = useCallback(async (server: Server) => {
    try {
      const serverId = server.raw?.id;
      if (serverId) {
        await pbDeleteServer(serverId);
      }
    } catch {
      // Errors surface via useCollection realtime updates
    }
  }, []);

  const openAddModal = useCallback(() => {
    setEditingServer(undefined);
    setIsAddModalOpen(true);
  }, []);

  return {
    sortOrder,
    setSortOrder,
    sortKey,
    setSortKey,
    contextMenu,
    setContextMenu,
    isAddModalOpen,
    setIsAddModalOpen,
    editingServer,
    isHeaderCollapsed,
    setIsHeaderCollapsed,
    contactLookup,
    filteredServers,
    handleContextMenu,
    handleDelete,
    handleEdit,
    editServer,
    deleteServer,
    openAddModal,
  };
}
