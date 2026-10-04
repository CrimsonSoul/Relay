import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { useDirectoryContacts } from '../useDirectoryContacts';
import { NoopToastProvider, type ToastOptions } from '../../components/Toast';
import type * as ToastModule from '../../components/Toast';
import type { Contact } from '@shared/ipc';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

const { mockShowToast } = vi.hoisted(() => ({ mockShowToast: vi.fn() }));
vi.mock('../../components/Toast', async (importOriginal) => ({
  ...(await importOriginal<typeof ToastModule>()),
  useToast: () => ({ showToast: mockShowToast }),
}));

/** The Undo toast raised by the latest delete request. */
const lastUndoToast = (): Required<Pick<ToastOptions, 'action' | 'onDismiss'>> => {
  const options = mockShowToast.mock.calls.findLast(([, , opts]) => opts?.onDismiss)?.[2];
  if (!options) throw new Error('No undo toast was shown');
  return options;
};

/** Lets the Undo toast close without Undo, which commits the pending delete. */
const closeUndoToast = async () => {
  await act(async () => lastUndoToast().onDismiss());
};

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

  it('updates and deletes cached IDs without an online identity lookup', async () => {
    const cached = { ...alice, raw: { id: 'cached-alice' } };
    mockFindContactByEmail.mockRejectedValue(new Error('offline'));
    mockUpdateContact.mockResolvedValue({});
    mockDeleteContact.mockResolvedValue(undefined);
    const cachedContacts = [cached];
    const { result } = renderHook(() => useDirectoryContacts(cachedContacts), { wrapper });
    act(() => result.current.setEditingContact(cached));
    await act(async () => result.current.handleUpdateContact({ title: 'Lead' }));
    expect(mockUpdateContact).toHaveBeenCalledWith(
      'cached-alice',
      expect.objectContaining({ title: 'Lead', email: alice.email }),
    );
    act(() => result.current.setDeleteConfirmation(cached));
    act(() => result.current.handleDeleteContact());
    expect(mockDeleteContact).not.toHaveBeenCalled();
    await closeUndoToast();
    await vi.waitFor(() => expect(mockDeleteContact).toHaveBeenCalledWith('cached-alice'));
    expect(mockFindContactByEmail).not.toHaveBeenCalled();
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
    expect(effective[0]?.email).toBe('dave@test.com');
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

  it('hides a confirmed delete at once and commits it when the Undo toast closes', async () => {
    mockFindContactByEmail.mockResolvedValue({ id: 'c1', name: 'Alice', email: 'alice@test.com' });
    mockDeleteContact.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    act(() => {
      result.current.setDeleteConfirmation(alice);
    });
    act(() => {
      result.current.handleDeleteContact();
    });

    expect(result.current.getEffectiveContacts().map((c) => c.email)).not.toContain(
      'alice@test.com',
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      'Deleted Alice',
      'info',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
    );
    expect(mockDeleteContact).not.toHaveBeenCalled();

    await closeUndoToast();
    await vi.waitFor(() => expect(mockDeleteContact).toHaveBeenCalledWith('c1'));
    expect(result.current.getEffectiveContacts().map((c) => c.email)).not.toContain(
      'alice@test.com',
    );
  });

  it('restores the contact without writing anything when Undo is taken', () => {
    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    act(() => {
      result.current.setDeleteConfirmation(alice);
    });
    act(() => {
      result.current.handleDeleteContact();
    });
    act(() => {
      lastUndoToast().action.onClick();
    });

    expect(result.current.getEffectiveContacts().map((c) => c.email)).toContain('alice@test.com');
    expect(mockFindContactByEmail).not.toHaveBeenCalled();
    expect(mockDeleteContact).not.toHaveBeenCalled();
    expect(mockAddContact).not.toHaveBeenCalled();
  });

  it('commits a pending delete when the hook unmounts, and a later Undo re-creates it', async () => {
    const cached = { ...alice, raw: { id: 'cached-alice' } };
    mockDeleteContact.mockResolvedValue(undefined);
    mockAddContact.mockResolvedValue({ id: 'restored' });
    const cachedContacts = [cached];
    const { result, unmount } = renderHook(() => useDirectoryContacts(cachedContacts), {
      wrapper,
    });

    act(() => result.current.setDeleteConfirmation(cached));
    act(() => result.current.handleDeleteContact());
    const undoToast = lastUndoToast();
    unmount();

    await vi.waitFor(() => expect(mockDeleteContact).toHaveBeenCalledWith('cached-alice'));
    undoToast.action.onClick();
    await vi.waitFor(() =>
      expect(mockAddContact).toHaveBeenCalledWith({
        name: 'Alice',
        email: 'alice@test.com',
        phone: '',
        title: '',
      }),
    );
  });

  it('shows the contact again when the committed delete fails', async () => {
    mockFindContactByEmail.mockResolvedValue({ id: 'c1', name: 'Alice', email: 'alice@test.com' });
    mockDeleteContact.mockRejectedValue(new Error('Not found'));

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    act(() => {
      result.current.setDeleteConfirmation(alice);
    });
    act(() => {
      result.current.handleDeleteContact();
    });
    await closeUndoToast();

    await vi.waitFor(() =>
      expect(result.current.getEffectiveContacts().map((c) => c.email)).toContain('alice@test.com'),
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      "Couldn't delete Alice. Not found. It is back in the list. Try again.",
      'error',
    );
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

  it('does nothing when deleteConfirmation is null', () => {
    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    act(() => {
      result.current.handleDeleteContact();
    });

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockFindContactByEmail).not.toHaveBeenCalled();
    expect(mockDeleteContact).not.toHaveBeenCalled();
  });

  it('manages editing contact state', () => {
    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    expect(result.current.editingContact).toBeNull();

    act(() => {
      result.current.setEditingContact(bob);
    });
    expect(result.current.editingContact).toEqual(bob);

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
      result.current.setDeleteConfirmation(bob);
    });
    act(() => {
      result.current.handleDeleteContact();
    });
    await closeUndoToast();

    await vi.waitFor(() =>
      expect(result.current.getEffectiveContacts().map((c) => c.email)).toContain('bob@test.com'),
    );
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
      result.current.setDeleteConfirmation(alice);
    });
    act(() => {
      result.current.handleDeleteContact();
    });
    await closeUndoToast();

    // Contact should be rolled back (not deleted) since PB record not found
    await vi.waitFor(() =>
      expect(result.current.getEffectiveContacts().map((c) => c.email)).toContain('alice@test.com'),
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      "Couldn't delete Alice. Relay could not find its saved record; another Relay user may have deleted it. Wait for the list to refresh before trying again.",
      'error',
    );
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
      result.current.setEditingContact(alice); // editing alice@test.com
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
