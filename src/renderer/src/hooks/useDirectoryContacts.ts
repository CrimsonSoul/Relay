import { useState, useEffect, useCallback } from 'react';
import { Contact } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { formatFailure } from '../utils/failureMessage';
import { contactRecordKey } from '../features/knowledge/knowledgeRecordNavigation';
import { useUndoableRecordDelete } from './useUndoableRecordDelete';
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
  const [deleteConfirmation, setDeleteConfirmation] = useState<Contact | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  useEffect(() => {
    setOptimisticAdds([]);
    setOptimisticUpdates(new Map());
  }, [contacts]);

  /** Writes a confirmed delete once its undo window closes; false when nothing was deleted. */
  const commitContactDelete = useCallback(
    async (contact: Contact) => {
      const label = contact.name || contact.email;
      try {
        // Find the record by email to get the PocketBase id
        const cachedId = contact.raw.id;
        const existing =
          typeof cachedId === 'string' && cachedId
            ? { id: cachedId }
            : await findContactByEmail(contact.email);
        if (!existing) {
          showToast(
            formatFailure({
              what: `Couldn't delete ${label}`,
              error:
                'Relay could not find its saved record; another Relay user may have deleted it',
              next: 'Wait for the list to refresh before trying again.',
            }),
            'error',
          );
          return false;
        }
        await pbDeleteContact(existing.id);
        return true;
      } catch (error) {
        showToast(
          formatFailure({
            what: `Couldn't delete ${label}`,
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

  const restoreDeletedContact = useCallback(
    async (contact: Contact) => {
      const label = contact.name || contact.email;
      try {
        await pbAddContact({
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          title: contact.title,
        });
        showToast(`Restored ${label}`, 'success');
      } catch (error) {
        showToast(
          formatFailure({
            what: `Couldn't restore ${label}`,
            error,
            outcome: 'It stays deleted.',
            next: 'Add the contact again to bring it back.',
          }),
          'error',
        );
      }
    },
    [showToast],
  );

  const { requestDelete, hiddenKeys } = useUndoableRecordDelete({
    records: contacts,
    getKey: contactRecordKey,
    describe: (contact) => `Deleted ${contact.name || contact.email}`,
    commitDelete: commitContactDelete,
    restoreDeleted: restoreDeletedContact,
    showToast,
  });

  const getEffectiveContacts = useCallback(() => {
    let result = contacts
      .filter((c) => hiddenKeys.size === 0 || !hiddenKeys.has(contactRecordKey(c)))
      .map((c) =>
        optimisticUpdates.has(c.email) ? { ...c, ...optimisticUpdates.get(c.email) } : c,
      );
    result = [...optimisticAdds, ...result];
    const seen = new Set<string>();
    return result.filter((c) => (seen.has(c.email) ? false : (seen.add(c.email), true)));
  }, [contacts, optimisticAdds, optimisticUpdates, hiddenKeys]);

  const handleCreateContact = async (contact: Partial<Contact>) => {
    const newContact: Contact = {
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
      // The optimistic row has no PocketBase record yet, so `raw` carries no id
      // until the create resolves and the real record replaces it.
      raw: {},
    };

    setOptimisticAdds((prev) => [newContact, ...prev]);

    const label = contact.name || contact.email || 'the contact';
    try {
      await pbAddContact({
        name: contact.name || '',
        email: contact.email || '',
        phone: contact.phone || '',
        title: contact.title || '',
      });
      showToast(`Added ${label} to contacts`, 'success');
    } catch (error) {
      setOptimisticAdds((prev) => prev.filter((c) => c.email !== contact.email));
      showToast(
        formatFailure({
          what: `Couldn't add ${label} to contacts`,
          error,
          outcome: 'Your entries are still in the form.',
        }),
        'error',
      );
      throw error;
    }
  };

  const handleUpdateContact = async (updated: Partial<Contact>) => {
    // Identify the record by the address it had when editing opened. Looking it
    // up by the *submitted* email misses the record whenever the user changed
    // it, and the not-found branch below would then create a second contact
    // instead of renaming the first. The optimistic map is keyed the same way,
    // since the rendered list still carries the original address.
    const originalEmail = editingContact?.email || updated.email || '';
    if (originalEmail) setOptimisticUpdates((prev) => new Map(prev).set(originalEmail, updated));

    try {
      const selected =
        editingContact ?? contacts.find((contact) => contact.email === originalEmail);
      const cachedId = selected?.raw.id;
      const existing =
        typeof cachedId === 'string' && cachedId
          ? { ...selected!, id: cachedId }
          : await findContactByEmail(originalEmail);
      if (existing) {
        await pbUpdateContact(existing.id, {
          name: updated.name || existing.name,
          email: updated.email || existing.email,
          // Optional fields use ?? so a deliberately cleared phone or title is
          // written through instead of silently reverting to the stored value.
          phone: updated.phone ?? existing.phone,
          title: updated.title ?? existing.title,
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
      showToast(`Saved changes to ${updated.name || originalEmail || 'the contact'}`, 'success');
    } catch (error) {
      if (originalEmail)
        setOptimisticUpdates((prev) => {
          const next = new Map(prev);
          next.delete(originalEmail);
          return next;
        });
      showToast(
        formatFailure({
          what: `Couldn't save changes to ${editingContact?.name || originalEmail || 'the contact'}`,
          error,
          outcome: 'Your edits are still in the form.',
        }),
        'error',
      );
      throw error;
    }
  };

  /** Confirmed deletes hide the row at once and are written only after the Undo toast closes. */
  const handleDeleteContact = () => {
    if (!deleteConfirmation) return;
    requestDelete(deleteConfirmation);
    setDeleteConfirmation(null);
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
