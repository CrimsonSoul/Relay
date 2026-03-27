import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockGetFirstListItem = vi.fn();
const mockGetFullList = vi.fn();

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
      getFirstListItem: mockGetFirstListItem,
      getFullList: mockGetFullList,
    }),
  }),
  handleApiError: vi.fn(),
  escapeFilter: (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
  requireOnline: vi.fn(),
}));

import {
  addContact,
  updateContact,
  deleteContact,
  findContactByEmail,
  bulkUpsertContacts,
  type ContactRecord,
  type ContactInput,
} from './contactService';
import { handleApiError, requireOnline } from './pocketbase';

const mockHandleApiError = vi.mocked(handleApiError);
const mockRequireOnline = vi.mocked(requireOnline);

const sampleContact: ContactRecord = {
  id: 'abc123',
  name: 'Alice Smith',
  email: 'alice@example.com',
  phone: '555-1234',
  title: 'Engineer',
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
};

const sampleInput: ContactInput = {
  name: 'Alice Smith',
  email: 'alice@example.com',
  phone: '555-1234',
  title: 'Engineer',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// addContact
// ---------------------------------------------------------------------------
describe('addContact', () => {
  it('calls requireOnline and creates a contact', async () => {
    mockCreate.mockResolvedValueOnce(sampleContact);
    const result = await addContact(sampleInput);
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(sampleInput);
    expect(result).toEqual(sampleContact);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('network error');
    mockCreate.mockRejectedValueOnce(err);
    await expect(addContact(sampleInput)).rejects.toThrow('network error');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

// ---------------------------------------------------------------------------
// updateContact
// ---------------------------------------------------------------------------
describe('updateContact', () => {
  it('calls requireOnline and updates a contact', async () => {
    mockUpdate.mockResolvedValueOnce(sampleContact);
    const result = await updateContact('abc123', { name: 'Alice' });
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('abc123', { name: 'Alice' });
    expect(result).toEqual(sampleContact);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('update failed');
    mockUpdate.mockRejectedValueOnce(err);
    await expect(updateContact('abc123', { name: 'Alice' })).rejects.toThrow('update failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

// ---------------------------------------------------------------------------
// deleteContact
// ---------------------------------------------------------------------------
describe('deleteContact', () => {
  it('calls requireOnline and deletes a contact', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    await deleteContact('abc123');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledWith('abc123');
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('delete failed');
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteContact('abc123')).rejects.toThrow('delete failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

// ---------------------------------------------------------------------------
// findContactByEmail
// ---------------------------------------------------------------------------
describe('findContactByEmail', () => {
  it('returns a contact when found', async () => {
    mockGetFirstListItem.mockResolvedValueOnce(sampleContact);
    const result = await findContactByEmail('alice@example.com');
    expect(mockGetFirstListItem).toHaveBeenCalledWith('email="alice@example.com"');
    expect(result).toEqual(sampleContact);
  });

  it('returns null when PocketBase returns 404', async () => {
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    const result = await findContactByEmail('missing@example.com');
    expect(result).toBeNull();
    expect(mockHandleApiError).not.toHaveBeenCalled();
  });

  it('calls handleApiError and re-throws on non-404 errors', async () => {
    const err = Object.assign(new Error('server error'), { status: 500 });
    mockGetFirstListItem.mockRejectedValueOnce(err);
    await expect(findContactByEmail('alice@example.com')).rejects.toThrow('server error');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });

  it('escapes special characters in email', async () => {
    mockGetFirstListItem.mockResolvedValueOnce(sampleContact);
    await findContactByEmail('a"b@example.com');
    expect(mockGetFirstListItem).toHaveBeenCalledWith('email="a\\"b@example.com"');
  });
});

// ---------------------------------------------------------------------------
// bulkUpsertContacts
// ---------------------------------------------------------------------------
describe('bulkUpsertContacts', () => {
  it('creates contacts that do not exist', async () => {
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    mockCreate.mockResolvedValueOnce(sampleContact);
    const results = await bulkUpsertContacts([sampleInput]);
    expect(mockCreate).toHaveBeenCalledWith(sampleInput);
    expect(results).toEqual([sampleContact]);
  });

  it('updates contacts that already exist', async () => {
    mockGetFirstListItem.mockResolvedValueOnce(sampleContact);
    const updated = { ...sampleContact, name: 'Alice Updated' };
    mockUpdate.mockResolvedValueOnce(updated);
    const results = await bulkUpsertContacts([{ ...sampleInput, name: 'Alice Updated' }]);
    expect(mockUpdate).toHaveBeenCalledWith('abc123', { ...sampleInput, name: 'Alice Updated' });
    expect(results).toEqual([updated]);
  });

  it('handles a mix of creates and updates', async () => {
    const contact2: ContactRecord = { ...sampleContact, id: 'def456', email: 'bob@example.com' };
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem
      .mockResolvedValueOnce(sampleContact) // alice exists → update
      .mockRejectedValueOnce(notFound); // bob doesn't → create
    mockUpdate.mockResolvedValueOnce(sampleContact);
    mockCreate.mockResolvedValueOnce(contact2);

    const results = await bulkUpsertContacts([
      sampleInput,
      { ...sampleInput, email: 'bob@example.com' },
    ]);
    expect(results).toHaveLength(2);
  });

  it('calls handleApiError and re-throws when a nested call fails', async () => {
    const err = new Error('bulk fail');
    mockGetFirstListItem.mockRejectedValueOnce(err);
    await expect(bulkUpsertContacts([sampleInput])).rejects.toThrow('bulk fail');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});
