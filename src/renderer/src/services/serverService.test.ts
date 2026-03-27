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
  addServer,
  updateServer,
  deleteServer,
  findServerByName,
  bulkUpsertServers,
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

describe('findServerByName', () => {
  it('returns a server when found', async () => {
    mockGetFirstListItem.mockResolvedValueOnce(sampleServer);
    const result = await findServerByName('web-01');
    expect(mockGetFirstListItem).toHaveBeenCalledWith('name="web-01"');
    expect(result).toEqual(sampleServer);
  });

  it('returns null on 404', async () => {
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    const result = await findServerByName('missing');
    expect(result).toBeNull();
    expect(mockHandleApiError).not.toHaveBeenCalled();
  });

  it('calls handleApiError and re-throws on non-404 errors', async () => {
    const err = Object.assign(new Error('server error'), { status: 500 });
    mockGetFirstListItem.mockRejectedValueOnce(err);
    await expect(findServerByName('web-01')).rejects.toThrow('server error');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });

  it('escapes special characters in name', async () => {
    mockGetFirstListItem.mockResolvedValueOnce(sampleServer);
    await findServerByName('server"name');
    expect(mockGetFirstListItem).toHaveBeenCalledWith('name="server\\"name"');
  });
});

describe('bulkUpsertServers', () => {
  it('creates servers that do not exist', async () => {
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    mockCreate.mockResolvedValueOnce(sampleServer);
    const results = await bulkUpsertServers([sampleInput]);
    expect(mockCreate).toHaveBeenCalledWith(sampleInput);
    expect(results).toEqual([sampleServer]);
  });

  it('updates servers that already exist', async () => {
    mockGetFirstListItem.mockResolvedValueOnce(sampleServer);
    const updated = { ...sampleServer, comment: 'updated' };
    mockUpdate.mockResolvedValueOnce(updated);
    const results = await bulkUpsertServers([{ ...sampleInput, comment: 'updated' }]);
    expect(mockUpdate).toHaveBeenCalledWith('srv1', { ...sampleInput, comment: 'updated' });
    expect(results).toEqual([updated]);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('bulk fail');
    mockGetFirstListItem.mockRejectedValueOnce(err);
    await expect(bulkUpsertServers([sampleInput])).rejects.toThrow('bulk fail');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});
