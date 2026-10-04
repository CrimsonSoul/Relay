import { useState, useMemo, useCallback, useEffect } from 'react';
import { Server, Contact } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { formatFailure } from '../utils/failureMessage';
import { serverRecordKey } from '../features/knowledge/knowledgeRecordNavigation';
import {
  addServer as pbAddServer,
  deleteServer as pbDeleteServer,
} from '../services/serverService';
import { useUndoableRecordDelete } from './useUndoableRecordDelete';
import { secureStorage } from '../utils/secureStorage';

type ServerSortKey = 'name' | 'businessArea' | 'lob' | 'owner' | 'os';
type StoredServerSort = { key: ServerSortKey; order: 'asc' | 'desc' };

const SORT_STORAGE_KEY = 'servers-list-sort';
const DEFAULT_SORT: StoredServerSort = { key: 'name', order: 'asc' };
const SERVER_SORT_KEYS: Record<ServerSortKey, true> = {
  name: true,
  businessArea: true,
  lob: true,
  owner: true,
  os: true,
};

function readStoredSort(): StoredServerSort {
  const stored = secureStorage.getItemSync<Partial<StoredServerSort> | null>(SORT_STORAGE_KEY);
  if (
    typeof stored?.key === 'string' &&
    Object.hasOwn(SERVER_SORT_KEYS, stored.key) &&
    (stored.order === 'asc' || stored.order === 'desc')
  ) {
    return { key: stored.key, order: stored.order };
  }
  return DEFAULT_SORT;
}

export function useServers(servers: Server[], contacts: Contact[], searchQuery = '') {
  const { showToast } = useToast();
  const [initialSort] = useState(readStoredSort);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(initialSort.order);
  const [sortKey, setSortKey] = useState<ServerSortKey>(initialSort.key);

  useEffect(() => {
    secureStorage.setItemSync<StoredServerSort>(SORT_STORAGE_KEY, {
      key: sortKey,
      order: sortOrder,
    });
  }, [sortKey, sortOrder]);

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

  /** Writes a confirmed delete once its undo window closes; false when nothing was deleted. */
  const commitServerDelete = useCallback(
    async (server: Server) => {
      const serverId = server.raw?.id;
      if (!serverId) {
        showToast(
          formatFailure({
            what: `Couldn't delete ${server.name}`,
            error: 'It has no saved record yet',
            outcome: 'It is back in the list.',
            next: 'Wait for the list to refresh before trying again.',
          }),
          'error',
        );
        return false;
      }
      try {
        await pbDeleteServer(serverId);
        return true;
      } catch (error) {
        // A rejected delete produces no realtime event, so it must be reported; otherwise
        // the row would just reappear and look like a success that undid itself.
        showToast(
          formatFailure({
            what: `Couldn't delete ${server.name}`,
            error,
            outcome: 'It is back in the list.',
          }),
          'error',
        );
        return false;
      }
    },
    [showToast],
  );

  const restoreDeletedServer = useCallback(
    async (server: Server) => {
      try {
        await pbAddServer({
          name: server.name,
          businessArea: server.businessArea,
          lob: server.lob,
          comment: server.comment,
          owner: server.owner,
          contact: server.contact,
          os: server.os,
        });
        showToast(`Restored ${server.name}`, 'success');
      } catch (error) {
        showToast(
          formatFailure({
            what: `Couldn't restore ${server.name}`,
            error,
            outcome: 'It stays deleted.',
            next: 'Add the server again to bring it back.',
          }),
          'error',
        );
      }
    },
    [showToast],
  );

  const { requestDelete: requestDeleteServer, hiddenKeys } = useUndoableRecordDelete({
    records: servers,
    getKey: serverRecordKey,
    describe: (server) => `Deleted ${server.name}`,
    commitDelete: commitServerDelete,
    restoreDeleted: restoreDeletedServer,
    showToast,
  });

  const filteredServers = useMemo(() => {
    let result =
      hiddenKeys.size === 0
        ? [...servers]
        : servers.filter((server) => !hiddenKeys.has(serverRecordKey(server)));
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (normalizedQuery) {
      const q = normalizedQuery;
      result = result.filter((s) => s._searchString.includes(q));
    }
    return result.sort((a, b) => {
      const valA = (a[sortKey] || '').toLowerCase(),
        valB = (b[sortKey] || '').toLowerCase();
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [servers, hiddenKeys, searchQuery, sortOrder, sortKey]);

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
    handleEdit,
    editServer,
    requestDeleteServer,
    openAddModal,
  };
}
