import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Contact, BridgeGroup } from '@shared/ipc';
import { useDebounce } from './useDebounce';
import { useDirectoryContacts } from './useDirectoryContacts';

type SortConfig = { key: keyof Contact | 'groups'; direction: 'asc' | 'desc' };

export function useDirectory(contacts: Contact[], groups: BridgeGroup[], onAddToAssembler: (contact: Contact) => void) {
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

  // Build maps from email to groups for display and sorting
  const { groupMap, groupStringMap } = useMemo(() => {
    const groupMap = new Map<string, string[]>();
    const groupStringMap = new Map<string, string>();

    groups.forEach(group => {
      group.contacts.forEach(email => {
        const emailLower = email.toLowerCase();
        const existing = groupMap.get(emailLower) || [];
        if (!existing.includes(group.name)) {
          existing.push(group.name);
          groupMap.set(emailLower, existing);
          groupStringMap.set(emailLower, existing.join(', '));
        }
      });
    });

    return { groupMap, groupStringMap };
  }, [groups]);

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

  // Track timeouts for cleanup to prevent memory leaks
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      timeoutsRef.current.clear();
    };
  }, []);

  const handleAddWrapper = useCallback((contact: Contact) => {
    onAddToAssembler(contact);
    setRecentlyAdded(prev => new Set(prev).add(contact.email));

    // Clear any existing timeout for this email
    const existingTimeout = timeoutsRef.current.get(contact.email);
    if (existingTimeout) clearTimeout(existingTimeout);

    // Set new timeout and track it
    const timeout = setTimeout(() => {
      setRecentlyAdded(prev => { const s = new Set(prev); s.delete(contact.email); return s; });
      timeoutsRef.current.delete(contact.email);
    }, 2000);
    timeoutsRef.current.set(contact.email, timeout);
  }, [onAddToAssembler]);

  const handleCreateContact = (contact: Partial<Contact>) => contactOps.handleCreateContact(contact);

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
