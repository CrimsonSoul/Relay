import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { useDirectoryContacts } from '../useDirectoryContacts';
import { NoopToastProvider } from '../../components/Toast';
import type { Contact } from '@shared/ipc';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

const makeContact = (email: string, name?: string): Contact => ({
  name: name || email.split('@')[0],
  email,
  phone: '',
  title: '',
  _searchString: `${name || email.split('@')[0]} ${email}`.toLowerCase(),
  raw: {},
});

describe('useDirectoryContacts', () => {
  const contacts = [
    makeContact('alice@test.com', 'Alice'),
    makeContact('bob@test.com', 'Bob'),
    makeContact('charlie@test.com', 'Charlie'),
  ];

  const mockApi = {
    addContact: vi.fn(),
    removeContact: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (window as Window & { api: typeof mockApi }).api = mockApi as Window['api'];
  });

  it('returns contacts unchanged initially', () => {
    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });
    const effective = result.current.getEffectiveContacts();
    expect(effective).toEqual(contacts);
  });

  it('handles optimistic create and merges with existing', async () => {
    mockApi.addContact.mockResolvedValue({ success: true });

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
    // New contact should be at the beginning (optimistic adds are prepended)
    expect(effective[0].email).toBe('dave@test.com');
  });

  it('rolls back optimistic create on API failure', async () => {
    mockApi.addContact.mockResolvedValue({ success: false, error: 'Duplicate' });

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
    mockApi.addContact.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    await act(async () => {
      await result.current.handleUpdateContact({ email: 'alice@test.com', title: 'Lead Engineer' });
    });

    const effective = result.current.getEffectiveContacts();
    const alice = effective.find((c) => c.email === 'alice@test.com');
    expect(alice?.title).toBe('Lead Engineer');
  });

  it('rolls back optimistic update on API failure', async () => {
    mockApi.addContact.mockResolvedValue({ success: false, error: 'Error' });

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
    expect(alice?.title).toBe(''); // Original value
  });

  it('handles optimistic delete', async () => {
    mockApi.removeContact.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    // Set up delete confirmation
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

  it('rolls back optimistic delete on API failure', async () => {
    mockApi.removeContact.mockResolvedValue({ success: false, error: 'Not found' });

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

  it('deduplicates contacts by email', async () => {
    mockApi.addContact.mockResolvedValue({ success: true });

    // Create a contact that has the same email as an existing one
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

    // The internal optimistic state should reset when contacts change
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

    // Should not have called the API
    expect(mockApi.removeContact).not.toHaveBeenCalled();
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
    mockApi.addContact.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    // Update without email — should not crash, guard: `if (updated.email)`
    await act(async () => {
      await result.current.handleUpdateContact({ title: 'Lead' });
    });

    // Effective contacts unchanged since no email to match
    const effective = result.current.getEffectiveContacts();
    expect(effective).toHaveLength(3);
  });

  it('handleDeleteContact rolls back on API exception', async () => {
    mockApi.removeContact.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useDirectoryContacts(contacts), { wrapper });

    act(() => {
      result.current.setDeleteConfirmation(contacts[1]); // Bob
    });

    await act(async () => {
      await result.current.handleDeleteContact();
    });

    // Should have been rolled back
    const effective = result.current.getEffectiveContacts();
    const emails = effective.map((c) => c.email);
    expect(emails).toContain('bob@test.com');
  });
});
