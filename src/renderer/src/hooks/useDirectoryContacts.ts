import { useState, useEffect, useCallback } from 'react';
import { Contact } from '@shared/ipc';
import { useToast } from '../components/Toast';

export function useDirectoryContacts(contacts: Contact[]) {
  const { showToast } = useToast();
  const [optimisticAdds, setOptimisticAdds] = useState<Contact[]>([]);
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, Partial<Contact>>>(new Map());
  const [optimisticDeletes, setOptimisticDeletes] = useState<Set<string>>(new Set());
  const [deleteConfirmation, setDeleteConfirmation] = useState<Contact | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  useEffect(() => { setOptimisticAdds([]); setOptimisticUpdates(new Map()); setOptimisticDeletes(new Set()); }, [contacts]);

  const getEffectiveContacts = useCallback(() => {
    let result = contacts.filter(c => !optimisticDeletes.has(c.email)).map(c => optimisticUpdates.has(c.email) ? { ...c, ...optimisticUpdates.get(c.email) } : c);
    result = [...optimisticAdds, ...result];
    const seen = new Set<string>(); return result.filter(c => seen.has(c.email) ? false : (seen.add(c.email), true));
  }, [contacts, optimisticAdds, optimisticUpdates, optimisticDeletes]);

  const handleCreateContact = async (contact: Partial<Contact>, setIsAddModalOpen: (v: boolean) => void) => {
    const newContact = { name: contact.name || '', email: contact.email || '', phone: contact.phone || '', title: contact.title || '', _searchString: (contact.name + contact.email + contact.title + contact.phone).toLowerCase(), avatar: undefined } as Contact;
    setOptimisticAdds(prev => [newContact, ...prev]);
    setIsAddModalOpen(false);
    try { 
      const result = await window.api?.addContact(contact); 
      if (!result?.success) { 
        setOptimisticAdds(prev => prev.filter(c => c.email !== contact.email)); 
        showToast(result?.error || 'Failed to create contact: Unable to save to file', 'error'); 
      } 
    }
    catch (error) { setOptimisticAdds(prev => prev.filter(c => c.email !== contact.email)); showToast(`Failed to create contact: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error'); }
  };

  const handleUpdateContact = async (updated: Partial<Contact>) => {
    if (updated.email) setOptimisticUpdates(prev => new Map(prev).set(updated.email!, updated));
    setEditingContact(null);
    try { 
      const result = await window.api?.addContact(updated); 
      if (!result?.success) { 
        if (updated.email) setOptimisticUpdates(prev => { const next = new Map(prev); next.delete(updated.email!); return next; }); 
        showToast(result?.error || 'Failed to update contact: Unable to save changes', 'error'); 
      } 
    }
    catch (error) { if (updated.email) setOptimisticUpdates(prev => { const next = new Map(prev); next.delete(updated.email!); return next; }); showToast(`Failed to update contact: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error'); }
  };

  const handleDeleteContact = async () => {
    if (!deleteConfirmation) return;
    const email = deleteConfirmation.email;
    setOptimisticDeletes(prev => new Set(prev).add(email));
    setDeleteConfirmation(null);
    try { 
      const result = await window.api?.removeContact(email); 
      if (!result?.success) { 
        setOptimisticDeletes(prev => { const next = new Set(prev); next.delete(email); return next; }); 
        showToast(result?.error || 'Failed to delete contact: Contact not found or file error', 'error'); 
      } 
    }
    catch (error) { setOptimisticDeletes(prev => { const next = new Set(prev); next.delete(email); return next; }); showToast(`Failed to delete contact: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error'); }
  };

  return { getEffectiveContacts, handleCreateContact, handleUpdateContact, handleDeleteContact, editingContact, setEditingContact, deleteConfirmation, setDeleteConfirmation };
}
