import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockGetFirstListItem = vi.fn();

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      create: mockCreate,
      update: mockUpdate,
      getFirstListItem: mockGetFirstListItem,
    }),
  }),
  handleApiError: vi.fn(),
  escapeFilter: (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
  requireOnline: vi.fn(),
}));

import { getNote, setNote, type NoteRecord } from './notesService';
import { handleApiError, requireOnline } from './pocketbase';

const mockHandleApiError = vi.mocked(handleApiError);
const mockRequireOnline = vi.mocked(requireOnline);

const sampleNote: NoteRecord = {
  id: 'n1',
  entityType: 'contact',
  entityKey: 'alice@example.com',
  note: 'Some note text',
  tags: ['tag1'],
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getNote', () => {
  it('returns a note when found', async () => {
    mockGetFirstListItem.mockResolvedValueOnce(sampleNote);
    const result = await getNote('contact', 'alice@example.com');
    expect(mockGetFirstListItem).toHaveBeenCalledWith(
      'entityType="contact" && entityKey="alice@example.com"',
    );
    expect(result).toEqual(sampleNote);
  });

  it('returns null on 404', async () => {
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    const result = await getNote('server', 'web-01');
    expect(result).toBeNull();
    expect(mockHandleApiError).not.toHaveBeenCalled();
  });

  it('calls handleApiError and re-throws on non-404 errors', async () => {
    const err = Object.assign(new Error('server error'), { status: 500 });
    mockGetFirstListItem.mockRejectedValueOnce(err);
    await expect(getNote('contact', 'alice@example.com')).rejects.toThrow('server error');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });

  it('escapes special characters in entityKey', async () => {
    mockGetFirstListItem.mockResolvedValueOnce(sampleNote);
    await getNote('contact', 'a"b@example.com');
    expect(mockGetFirstListItem).toHaveBeenCalledWith(
      'entityType="contact" && entityKey="a\\"b@example.com"',
    );
  });
});

describe('setNote', () => {
  it('calls requireOnline and creates a note when none exists', async () => {
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    mockCreate.mockResolvedValueOnce(sampleNote);
    const result = await setNote('contact', 'alice@example.com', 'Some note text', ['tag1']);
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith({
      entityType: 'contact',
      entityKey: 'alice@example.com',
      note: 'Some note text',
      tags: ['tag1'],
    });
    expect(result).toEqual(sampleNote);
  });

  it('updates an existing note', async () => {
    mockGetFirstListItem.mockResolvedValueOnce(sampleNote);
    const updated = { ...sampleNote, note: 'Updated note' };
    mockUpdate.mockResolvedValueOnce(updated);
    const result = await setNote('contact', 'alice@example.com', 'Updated note', ['tag1']);
    expect(mockUpdate).toHaveBeenCalledWith('n1', { note: 'Updated note', tags: ['tag1'] });
    expect(result).toEqual(updated);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    const err = new Error('create failed');
    mockCreate.mockRejectedValueOnce(err);
    await expect(setNote('contact', 'alice@example.com', 'note', [])).rejects.toThrow(
      'create failed',
    );
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});
