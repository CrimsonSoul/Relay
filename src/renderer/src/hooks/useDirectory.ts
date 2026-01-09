import { useState, useMemo, useCallback } from 'react';
import { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Contact, GroupMap } from '@shared/ipc';
import { useDebounce } from './useDebounce';
import { useGroupMaps } from './useGroupMaps';
import { useDirectoryContacts } from './useDirectoryContacts';
import { loadColumnWidths, saveColumnWidths, loadColumnOrder, saveColumnOrder } from '../utils/columnStorage';
import { scaleColumns, reverseScale } from '../utils/columnSizing';

const DEFAULT_WIDTHS = { name: 320, title: 200, email: 280, phone: 200, groups: 200 };
const DEFAULT_ORDER: (keyof typeof DEFAULT_WIDTHS)[] = ['name', 'title', 'email', 'phone', 'groups'];
type SortConfig = { key: keyof typeof DEFAULT_WIDTHS; direction: 'asc' | 'desc' };

export function useDirectory(contacts: Contact[], groups: GroupMap, onAddToAssembler: (contact: Contact) => void) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'name', direction: 'asc' });
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
  const [listWidth, setListWidth] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; contact: Contact } | null>(null);
  const [groupSelectorContact, setGroupSelectorContact] = useState<Contact | null>(null);

  const [baseWidths, setBaseWidths] = useState(() => loadColumnWidths({ storageKey: 'relay-directory-columns', defaults: DEFAULT_WIDTHS }));
  const [columnOrder, setColumnOrder] = useState<(keyof typeof DEFAULT_WIDTHS)[]>(() => loadColumnOrder({ storageKey: 'relay-directory-order', defaults: DEFAULT_ORDER }));

  const contactOps = useDirectoryContacts(contacts);
  const { groupMap, groupStringMap } = useGroupMaps(groups);

  const scaledWidths = useMemo(() => { if (!listWidth) return baseWidths; return scaleColumns({ baseWidths, availableWidth: listWidth, minColumnWidth: 50, reservedSpace: 108 }) as typeof DEFAULT_WIDTHS; }, [baseWidths, listWidth]);

  const handleResize = (key: keyof typeof DEFAULT_WIDTHS, width: number) => {
    let newBase = width; if (listWidth) { const totalBaseWidth = Object.values(baseWidths).reduce((a, b) => a + b, 0); newBase = reverseScale(width, listWidth, totalBaseWidth, 108); }
    const newWidths = { ...baseWidths, [key]: newBase }; setBaseWidths(newWidths); saveColumnWidths('relay-directory-columns', newWidths);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) setColumnOrder((items) => { const oldIdx = items.indexOf(active.id as any), newIdx = items.indexOf(over.id as any); const newOrder = arrayMove(items, oldIdx, newIdx); saveColumnOrder('relay-directory-order', newOrder); return newOrder; });
  };

  const handleSort = (key: keyof typeof DEFAULT_WIDTHS) => setSortConfig(cur => cur.key === key ? { key, direction: cur.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' });

  const effectiveContacts = useMemo(() => contactOps.getEffectiveContacts(), [contactOps, contacts]);

  const filtered = useMemo(() => {
    const res = effectiveContacts.filter(c => !debouncedSearch || c._searchString.includes(debouncedSearch.toLowerCase()));
    return res.sort((a, b) => {
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      if (sortConfig.key === 'groups') { const strA = groupStringMap.get(a.email.toLowerCase()) || '', strB = groupStringMap.get(b.email.toLowerCase()) || ''; return strA.localeCompare(strB) * dir; }
      return ((a[sortConfig.key as keyof Contact] || '').toString().toLowerCase()).localeCompare((b[sortConfig.key as keyof Contact] || '').toString().toLowerCase()) * dir;
    });
  }, [effectiveContacts, debouncedSearch, sortConfig, groupStringMap]);

  const handleAddWrapper = useCallback((contact: Contact) => { onAddToAssembler(contact); setRecentlyAdded(prev => new Set(prev).add(contact.email)); setTimeout(() => setRecentlyAdded(prev => { const s = new Set(prev); s.delete(contact.email); return s; }), 2000); }, [onAddToAssembler]);

  const handleCreateContact = (contact: Partial<Contact>) => contactOps.handleCreateContact(contact, setIsAddModalOpen);

  return {
    search, setSearch, filtered, recentlyAdded, isAddModalOpen, setIsAddModalOpen, focusedIndex, setFocusedIndex, sortConfig, setSortConfig,
    isHeaderCollapsed, setIsHeaderCollapsed, scaledWidths, columnOrder, handleResize, handleDragEnd, handleSort, contextMenu, setContextMenu,
    editingContact: contactOps.editingContact, setEditingContact: contactOps.setEditingContact, deleteConfirmation: contactOps.deleteConfirmation, setDeleteConfirmation: contactOps.setDeleteConfirmation,
    groupSelectorContact, setGroupSelectorContact, handleCreateContact, handleUpdateContact: contactOps.handleUpdateContact, handleDeleteContact: contactOps.handleDeleteContact, handleAddWrapper, groupMap, setListWidth
  };
}
