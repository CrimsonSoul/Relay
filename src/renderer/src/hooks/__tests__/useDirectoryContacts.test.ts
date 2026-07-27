import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { useDirectoryContacts } from '../useDirectoryContacts';
import { NoopToastProvider } from '../../components/Toast';
import type { Contact } from '@shared/ipc';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

// Mock PocketBase contact service
const mockAddContact = vi.fn();
const mockUpdateContact = vi.fn();
const mockDeleteContact = vi.fn();
const mockFindContactByEmail = vi.fn();
vi.mock('../../services/contactService', () => ({
  addContact: (...args: unknown[]) => mockAddContact(...args),
  updateContact: (...args: unknown[]) => mockUpdateContact(...args),
  deleteContact: (...args: unknown[]) => mockDeleteContact(...args),
  findContactByEmail: (...args: unknown[]) => mockFindContactByEmail(...args),
}));

const makeContact = (email: string, name?: string): Contact => {
  const displayName = name || email.split('@')[0] || email;
  return {
    name: displayName,
    email,
    phone: '',
    title: '',
    _searchString: `${displayName} ${email}`.toLowerCase(),
    raw: {},
  };
};

describe('useDirectoryContacts', () => {
  const alice = makeContact('alice@test.com', 'Alice');
  const bob = makeContact('bob@test.com', 'Bob');
  const contacts = [alice, bob, makeContact('charlie@test.com', 'Charlie')];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns contacts unchanged initially', () => {
    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });
    const effective = result.current.getEffectiveContacts();
    expect(effective).toEqual(contacts);
  });

  it('handles optimistic create and merges with existing', async () => {
    mockAddContact.mockResolvedValue({ id: 'new-1', name: 'Dave', email: 'dave@test.com' });

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    const newContact: Partial<Contact> = {
      name: 'Dave',
      email: 'dave@test.com',
      phone: '',
      title: '',
    };

    await act(async () => {
      await result.current.handleCreateContact(newContact);
    });

    const effective = result.current.getEffectiveContacts();
    const emails = effective.map((c) => c.email);
    expect(emails).toContain('dave@test.com');
    expect(effective[0].email).toBe('dave@test.com');
  });

  it('rolls back optimistic create on service failure', async () => {
    mockAddContact.mockRejectedValue(new Error('Duplicate'));

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    await expect(
      act(async () => {
        await result.current.handleCreateContact({ name: 'Dave', email: 'dave@test.com' });
      }),
    ).rejects.toThrow();

    const effective = result.current.getEffectiveContacts();
    const emails = effective.map((c) => c.email);
    expect(emails).not.toContain('dave@test.com');
  });

  it('handles optimistic update', async () => {
    mockFindContactByEmail.mockResolvedValue({
      id: 'c1',
      name: 'Alice',
      email: 'alice@test.com',
      phone: '',
      title: '',
    });
    mockUpdateContact.mockResolvedValue({
      id: 'c1',
      name: 'Alice',
      email: 'alice@test.com',
      phone: '',
      title: 'Lead Engineer',
    });

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    await act(async () => {
      await result.current.handleUpdateContact({ email: 'alice@test.com', title: 'Lead Engineer' });
    });

    const effective = result.current.getEffectiveContacts();
    const alice = effective.find((c) => c.email === 'alice@test.com');
    expect(alice?.title).toBe('Lead Engineer');
  });

  it('rolls back optimistic update on service failure', async () => {
    mockFindContactByEmail.mockRejectedValue(new Error('Error'));

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    await expect(
      act(async () => {
        await result.current.handleUpdateContact({
          email: 'alice@test.com',
          title: 'Lead Engineer',
        });
      }),
    ).rejects.toThrow();

    const effective = result.current.getEffectiveContacts();
    const alice = effective.find((c) => c.email === 'alice@test.com');
    expect(alice?.title).toBe('');
  });

  it('handles optimistic delete', async () => {
    mockFindContactByEmail.mockResolvedValue({ id: 'c1', name: 'Alice', email: 'alice@test.com' });
    mockDeleteContact.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    act(() => {
      result.current.setDeleteConfirmation(contacts[0]); // Alice
    });

    await act(async () => {
      await result.current.handleDeleteContact();
    });

    const effective = result.current.getEffectiveContacts();
    const emails = effective.map((c) => c.email);
    expect(emails).not.toContain('alice@test.com');
  });

  it('rolls back optimistic delete on service failure', async () => {
    mockFindContactByEmail.mockResolvedValue({ id: 'c1', name: 'Alice', email: 'alice@test.com' });
    mockDeleteContact.mockRejectedValue(new Error('Not found'));

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    act(() => {
      result.current.setDeleteConfirmation(contacts[0]); // Alice
    });

    await act(async () => {
      await result.current.handleDeleteContact();
    });

    const effective = result.current.getEffectiveContacts();
    const emails = effective.map((c) => c.email);
    expect(emails).toContain('alice@test.com');
  });

  it('deduplicates contacts by email', () => {
    const dupeContacts = [...contacts, makeContact('alice@test.com', 'Alice Duplicate')];

    const { result } = renderHook(() => useDirectoryContacts(dupeContacts), { wrapper });

    const effective = result.current.getEffectiveContacts();
    const aliceEntries = effective.filter((c) => c.email === 'alice@test.com');
    expect(aliceEntries).toHaveLength(1);
  });

  it('clears optimistic state when contacts prop changes', () => {
    const { result, rerender } = renderHook(({ contacts }) => useDirectoryContacts(contacts), {
      wrapper,
      initialProps: { contacts },
    });

    const newContacts = [...contacts, makeContact('dave@test.com', 'Dave')];
    rerender({ contacts: newContacts });

    const effective = result.current.getEffectiveContacts();
    expect(effective).toHaveLength(4);
  });

  it('does nothing when deleteConfirmation is null', async () => {
    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    await act(async () => {
      await result.current.handleDeleteContact();
    });

    expect(mockFindContactByEmail).not.toHaveBeenCalled();
    expect(mockDeleteContact).not.toHaveBeenCalled();
  });

  it('manages editing contact state', () => {
    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    expect(result.current.editingContact).toBeNull();

    act(() => {
      result.current.setEditingContact(contacts[1]);
    });
    expect(result.current.editingContact).toEqual(contacts[1]);

    act(() => {
      result.current.setEditingContact(null);
    });
    expect(result.current.editingContact).toBeNull();
  });

  it('handleUpdateContact skips optimistic update when email is missing', async () => {
    mockFindContactByEmail.mockResolvedValue(null);
    mockAddContact.mockResolvedValue({ id: 'new-1' });

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    await act(async () => {
      await result.current.handleUpdateContact({ title: 'Lead' });
    });

    const effective = result.current.getEffectiveContacts();
    expect(effective).toHaveLength(3);
  });

  it('handleDeleteContact rolls back on service exception', async () => {
    mockFindContactByEmail.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    act(() => {
      result.current.setDeleteConfirmation(contacts[1]); // Bob
    });

    await act(async () => {
      await result.current.handleDeleteContact();
    });

    const effective = result.current.getEffectiveContacts();
    const emails = effective.map((c) => c.email);
    expect(emails).toContain('bob@test.com');
  });

  it('handleUpdateContact rolls back optimistic update when update service fails with email', async () => {
    mockFindContactByEmail.mockResolvedValue({
      id: 'c1',
      name: 'Alice',
      email: 'alice@test.com',
      phone: '',
      title: '',
    });
    mockUpdateContact.mockRejectedValue(new Error('update failed'));

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    await expect(
      act(async () => {
        await result.current.handleUpdateContact({
          email: 'alice@test.com',
          title: 'Senior Eng',
        });
      }),
    ).rejects.toThrow();

    // Optimistic update should be rolled back
    const effective = result.current.getEffectiveContacts();
    const alice = effective.find((c) => c.email === 'alice@test.com');
    expect(alice?.title).toBe('');
  });

  it('handleUpdateContact creates contact when existing is not found in PocketBase', async () => {
    mockFindContactByEmail.mockResolvedValue(null);
    mockAddContact.mockResolvedValue({ id: 'new-1' });

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    await act(async () => {
      await result.current.handleUpdateContact({
        email: 'alice@test.com',
        name: 'Alice Updated',
      });
    });

    expect(mockAddContact).toHaveBeenCalledWith({
      name: 'Alice Updated',
      email: 'alice@test.com',
      phone: '',
      title: '',
    });
  });

  it('handleDeleteContact shows not found toast when contact does not exist in PocketBase', async () => {
    mockFindContactByEmail.mockResolvedValue(null);

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    act(() => {
      result.current.setDeleteConfirmation(contacts[0]); // Alice
    });

    await act(async () => {
      await result.current.handleDeleteContact();
    });

    // Contact should be rolled back (not deleted) since PB record not found
    const effective = result.current.getEffectiveContacts();
    const emails = effective.map((c) => c.email);
    expect(emails).toContain('alice@test.com');
  });

  it('renames the existing record when the email changes, rather than duplicating', async () => {
    // clearAllMocks() resets calls but not implementations, so pin these here.
    mockUpdateContact.mockResolvedValue({});
    mockAddContact.mockResolvedValue({});
    mockFindContactByEmail.mockResolvedValue({
      id: 'rec-alice',
      name: 'Alice',
      email: 'alice@test.com',
      phone: '5551234567',
      title: 'Engineer',
    });

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    act(() => {
      result.current.setEditingContact(contacts[0]); // editing alice@test.com
    });

    await act(async () => {
      await result.current.handleUpdateContact({
        name: 'Alice',
        email: 'alice.renamed@test.com',
        phone: '5551234567',
        title: 'Engineer',
      });
    });

    // Looked up by the address the record actually has, not the new one.
    expect(mockFindContactByEmail).toHaveBeenCalledWith('alice@test.com');
    expect(mockAddContact).not.toHaveBeenCalled();
    expect(mockUpdateContact).toHaveBeenCalledWith(
      'rec-alice',
      expect.objectContaining({ email: 'alice.renamed@test.com' }),
    );
  });

  it('persists a cleared phone and title instead of reverting to the stored values', async () => {
    mockUpdateContact.mockResolvedValue({});
    mockFindContactByEmail.mockResolvedValue({
      id: 'rec-alice',
      name: 'Alice',
      email: 'alice@test.com',
      phone: '5551234567',
      title: 'Engineer',
    });

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    await act(async () => {
      await result.current.handleUpdateContact({
        name: 'Alice',
        email: 'alice@test.com',
        phone: '',
        title: '',
      });
    });

    expect(mockUpdateContact).toHaveBeenCalledWith(
      'rec-alice',
      expect.objectContaining({ phone: '', title: '' }),
    );
  });
});
