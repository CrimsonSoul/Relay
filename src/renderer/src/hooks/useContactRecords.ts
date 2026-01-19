import { useState, useEffect, useCallback } from "react";
import type { ContactRecord } from "@shared/ipc";

export function useContactRecords() {
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadContacts = useCallback(async () => {
    try {
      const data = await window.api?.getContacts();
      setContacts(data || []);
    } catch (e) {
      console.error("Failed to load contacts:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  const addContact = useCallback(
    async (contact: Omit<ContactRecord, "id" | "createdAt" | "updatedAt">) => {
      try {
        if (!window.api) {
          console.error("[useContactRecords] API not available");
          return null;
        }
        const result = await window.api.addContactRecord(contact);
        if (result.success && result.data) {
          const record = result.data;
          setContacts((prev) => {
            // Check if this was an update (same email)
            const existingIndex = prev.findIndex(
              (c) => c.email.toLowerCase() === record.email.toLowerCase()
            );
            if (existingIndex !== -1) {
              const updated = [...prev];
              updated[existingIndex] = record;
              return updated;
            }
            return [...prev, record];
          });
          return record;
        }
        return null;
      } catch (e) {
        console.error("[useContactRecords] Failed to add contact:", e);
        return null;
      }
    },
    []
  );

  const updateContact = useCallback(
    async (
      id: string,
      updates: Partial<Omit<ContactRecord, "id" | "createdAt">>
    ) => {
      try {
        if (!window.api) {
          console.error("[useContactRecords] API not available");
          return false;
        }
        const result = await window.api.updateContactRecord(id, updates);
        if (result.success) {
          setContacts((prev) =>
            prev.map((c) =>
              c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c
            )
          );
        }
        return result.success;
      } catch (e) {
        console.error("[useContactRecords] Failed to update contact:", e);
        return false;
      }
    },
    []
  );

  const deleteContact = useCallback(async (id: string) => {
    try {
      if (!window.api) {
        console.error("[useContactRecords] API not available");
        return false;
      }
      const result = await window.api.deleteContactRecord(id);
      if (result.success) {
        setContacts((prev) => prev.filter((c) => c.id !== id));
      }
      return result.success;
    } catch (e) {
      console.error("[useContactRecords] Failed to delete contact:", e);
      return false;
    }
  }, []);

  const findByEmail = useCallback(
    (email: string) => {
      return contacts.find(
        (c) => c.email.toLowerCase() === email.toLowerCase()
      );
    },
    [contacts]
  );

  return {
    contacts,
    loading,
    addContact,
    updateContact,
    deleteContact,
    findByEmail,
    reloadContacts: loadContacts,
  };
}
