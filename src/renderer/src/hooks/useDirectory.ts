import { useState, useMemo, useCallback } from 'react';
import { Contact, GroupMap } from '@shared/ipc';
import { useDebounce } from './useDebounce';
import { useGroupMaps } from './useGroupMaps';
import { useDirectoryContacts } from './useDirectoryContacts';

type SortConfig = { key: keyof Contact | 'groups'; direction: 'asc' | 'desc' };

export function useDirectory(contacts: Contact[], groups: GroupMap, onAddToAssembler: (contact: Contact) => void) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'name', direction: 'asc' });
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; contact: Contact } | null>(null);
  const [groupSelectorContact, setGroupSelectorContact] = useState<Contact | null>(null);

  const contactOps = useDirectoryContacts(contacts);
  const { groupMap, groupStringMap } = useGroupMaps(groups);

  const handleSort = (key: keyof Contact | 'groups') => setSortConfig(cur => cur.key === key ? { key, direction: cur.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });

  const effectiveContacts = useMemo(() => contactOps.getEffectiveContacts(), [contactOps, contacts]);

  const filtered = useMemo(() => {
    const res = effectiveContacts.filter(c => !debouncedSearch || c._searchString.includes(debouncedSearch.toLowerCase()));
    return res.sort((a, b) => {
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      if (sortConfig.key === 'groups') { 
        const strA = groupStringMap.get(a.email.toLowerCase()) || '', strB = groupStringMap.get(b.email.toLowerCase()) || ''; 
        return strA.localeCompare(strB) * dir; 
      }
      const valA = (a[sortConfig.key as keyof Contact] || '').toString().toLowerCase();
      const valB = (b[sortConfig.key as keyof Contact] || '').toString().toLowerCase();
      return valA.localeCompare(valB) * dir;
    });
  }, [effectiveContacts, debouncedSearch, sortConfig, groupStringMap]);

  const handleAddWrapper = useCallback((contact: Contact) => { 
    onAddToAssembler(contact); 
    setRecentlyAdded(prev => new Set(prev).add(contact.email)); 
    setTimeout(() => setRecentlyAdded(prev => { const s = new Set(prev); s.delete(contact.email); return s; }), 2000); 
  }, [onAddToAssembler]);

  const handleCreateContact = (contact: Partial<Contact>) => contactOps.handleCreateContact(contact, setIsAddModalOpen);

  return {
    search, setSearch, filtered, recentlyAdded, isAddModalOpen, setIsAddModalOpen, focusedIndex, setFocusedIndex, sortConfig, setSortConfig,
    isHeaderCollapsed, setIsHeaderCollapsed, handleSort, contextMenu, setContextMenu,
    editingContact: contactOps.editingContact, setEditingContact: contactOps.setEditingContact, 
    deleteConfirmation: contactOps.deleteConfirmation, setDeleteConfirmation: contactOps.setDeleteConfirmation,
    groupSelectorContact, setGroupSelectorContact, handleCreateContact, 
    handleUpdateContact: contactOps.handleUpdateContact, handleDeleteContact: contactOps.handleDeleteContact, 
    handleAddWrapper, groupMap
  };
}
