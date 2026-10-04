import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    }),
  }),
  handleApiError: vi.fn(),
  escapeFilter: (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
  requireOnline: vi.fn(),
  getConnectionState: vi.fn(() => 'online'),
}));

import {
  addServer,
  updateServer,
  deleteServer,
  type ServerRecord,
  type ServerInput,
} from './serverService';
import { handleApiError, requireOnline } from './pocketbase';

const mockHandleApiError = vi.mocked(handleApiError);
const mockRequireOnline = vi.mocked(requireOnline);

const sampleServer: ServerRecord = {
  id: 'srv1',
  name: 'web-01',
  businessArea: 'IT',
  lob: 'Core',
  comment: '',
  owner: 'alice',
  contact: 'alice@example.com',
  os: 'Linux',
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
};

const sampleInput: ServerInput = {
  name: 'web-01',
  businessArea: 'IT',
  lob: 'Core',
  comment: '',
  owner: 'alice',
  contact: 'alice@example.com',
  os: 'Linux',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addServer', () => {
  it('calls requireOnline and creates a server', async () => {
    mockCreate.mockResolvedValueOnce(sampleServer);
    const result = await addServer(sampleInput);
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(sampleInput);
    expect(result).toEqual(sampleServer);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('create failed');
    mockCreate.mockRejectedValueOnce(err);
    await expect(addServer(sampleInput)).rejects.toThrow('create failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('updateServer', () => {
  it('calls requireOnline and updates a server', async () => {
    mockUpdate.mockResolvedValueOnce(sampleServer);
    const result = await updateServer('srv1', { name: 'web-02' });
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('srv1', { name: 'web-02' });
    expect(result).toEqual(sampleServer);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('update failed');
    mockUpdate.mockRejectedValueOnce(err);
    await expect(updateServer('srv1', { name: 'web-02' })).rejects.toThrow('update failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('deleteServer', () => {
  it('calls requireOnline and deletes a server', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    await deleteServer('srv1');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledWith('srv1');
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('delete failed');
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteServer('srv1')).rejects.toThrow('delete failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});
