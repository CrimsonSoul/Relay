import { useState, useEffect, useCallback } from 'react';
import { Contact } from '@shared/ipc';
import { useToast } from '../components/Toast';
import {
  addContact as pbAddContact,
  updateContact as pbUpdateContact,
  deleteContact as pbDeleteContact,
  findContactByEmail,
} from '../services/contactService';

export function useDirectoryContacts(contacts: Contact[]) {
  const { showToast } = useToast();
  const [optimisticAdds, setOptimisticAdds] = useState<Contact[]>([]);
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, Partial<Contact>>>(
    new Map(),
  );
  const [optimisticDeletes, setOptimisticDeletes] = useState<Set<string>>(new Set());
  const [deleteConfirmation, setDeleteConfirmation] = useState<Contact | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  useEffect(() => {
    setOptimisticAdds([]);
    setOptimisticUpdates(new Map());
    setOptimisticDeletes(new Set());
  }, [contacts]);

  const getEffectiveContacts = useCallback(() => {
    let result = contacts
      .filter((c) => !optimisticDeletes.has(c.email))
      .map((c) =>
        optimisticUpdates.has(c.email) ? { ...c, ...optimisticUpdates.get(c.email) } : c,
      );
    result = [...optimisticAdds, ...result];
    const seen = new Set<string>();
    return result.filter((c) => (seen.has(c.email) ? false : (seen.add(c.email), true)));
  }, [contacts, optimisticAdds, optimisticUpdates, optimisticDeletes]);

  const handleCreateContact = async (contact: Partial<Contact>) => {
    const newContact = {
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || '',
      title: contact.title || '',
      _searchString: (
        contact.name +
        (contact.email || '') +
        (contact.title || '') +
        (contact.phone || '')
      ).toLowerCase(),
      avatar: undefined,
    } as Contact;

    setOptimisticAdds((prev) => [newContact, ...prev]);

    try {
      await pbAddContact({
        name: contact.name || '',
        email: contact.email || '',
        phone: contact.phone || '',
        title: contact.title || '',
      });
      showToast('Contact created successfully', 'success');
    } catch (error) {
      setOptimisticAdds((prev) => prev.filter((c) => c.email !== contact.email));
      const errorMsg = error instanceof Error ? error.message : 'Failed to create contact';
      showToast(errorMsg, 'error');
      throw error;
    }
  };

  const handleUpdateContact = async (updated: Partial<Contact>) => {
    if (updated.email) setOptimisticUpdates((prev) => new Map(prev).set(updated.email!, updated));

    try {
      // Find existing record by email to get the PocketBase id
      const existing = await findContactByEmail(updated.email || '');
      if (existing) {
        await pbUpdateContact(existing.id, {
          name: updated.name || existing.name,
          email: updated.email || existing.email,
          phone: updated.phone || existing.phone,
          title: updated.title || existing.title,
        });
      } else {
        // If not found, create it
        await pbAddContact({
          name: updated.name || '',
          email: updated.email || '',
          phone: updated.phone || '',
          title: updated.title || '',
        });
      }
      showToast('Contact updated successfully', 'success');
    } catch (error) {
      if (updated.email)
        setOptimisticUpdates((prev) => {
          const next = new Map(prev);
          next.delete(updated.email!);
          return next;
        });
      const errorMsg = error instanceof Error ? error.message : 'Failed to update contact';
      showToast(errorMsg, 'error');
      throw error;
    }
  };

  const handleDeleteContact = async () => {
    if (!deleteConfirmation) return;
    const email = deleteConfirmation.email;
    setOptimisticDeletes((prev) => new Set(prev).add(email));
    setDeleteConfirmation(null);
    try {
      // Find the record by email to get the PocketBase id
      const existing = await findContactByEmail(email);
      if (existing) {
        await pbDeleteContact(existing.id);
      } else {
        setOptimisticDeletes((prev) => {
          const next = new Set(prev);
          next.delete(email);
          return next;
        });
        showToast('Contact not found', 'error');
      }
    } catch (error) {
      setOptimisticDeletes((prev) => {
        const next = new Set(prev);
        next.delete(email);
        return next;
      });
      showToast(
        `Failed to delete contact: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error',
      );
    }
  };

  return {
    getEffectiveContacts,
    handleCreateContact,
    handleUpdateContact,
    handleDeleteContact,
    editingContact,
    setEditingContact,
    deleteConfirmation,
    setDeleteConfirmation,
  };
}
