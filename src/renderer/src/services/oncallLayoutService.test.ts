import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockGetFullList = vi.fn();
const mockGetFirstListItem = vi.fn();

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      create: mockCreate,
      update: mockUpdate,
      getFullList: mockGetFullList,
      getFirstListItem: mockGetFirstListItem,
    }),
  }),
  handleApiError: vi.fn(),
  escapeFilter: (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
  requireOnline: vi.fn(),
}));

import {
  getLayout,
  saveLayout,
  type OncallLayoutRecord,
  type TeamLayoutMap,
} from './oncallLayoutService';
import { handleApiError, requireOnline } from './pocketbase';

const mockHandleApiError = vi.mocked(handleApiError);
const mockRequireOnline = vi.mocked(requireOnline);

const sampleRecord: OncallLayoutRecord = {
  id: 'ol1',
  team: 'TeamA',
  x: 0,
  y: 1,
  w: 2,
  h: 3,
  isStatic: false,
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLayout', () => {
  it('returns a TeamLayoutMap from all records', async () => {
    mockGetFullList.mockResolvedValueOnce([sampleRecord]);
    const result = await getLayout();
    expect(mockGetFullList).toHaveBeenCalledOnce();
    expect(result).toEqual<TeamLayoutMap>({
      TeamA: { x: 0, y: 1, w: 2, h: 3, isStatic: false },
    });
  });

  it('returns an empty map when no records exist', async () => {
    mockGetFullList.mockResolvedValueOnce([]);
    const result = await getLayout();
    expect(result).toEqual({});
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('fetch failed');
    mockGetFullList.mockRejectedValueOnce(err);
    await expect(getLayout()).rejects.toThrow('fetch failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('saveLayout', () => {
  it('calls requireOnline and creates a new layout record when none exists', async () => {
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    mockCreate.mockResolvedValueOnce(sampleRecord);

    const result = await saveLayout('TeamA', { x: 0, y: 1, w: 2, h: 3, isStatic: false });
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith({
      team: 'TeamA',
      x: 0,
      y: 1,
      w: 2,
      h: 3,
      isStatic: false,
    });
    expect(result).toEqual(sampleRecord);
  });

  it('updates an existing layout record', async () => {
    mockGetFirstListItem.mockResolvedValueOnce(sampleRecord);
    const updated = { ...sampleRecord, x: 5 };
    mockUpdate.mockResolvedValueOnce(updated);

    const result = await saveLayout('TeamA', { x: 5, y: 1 });
    expect(mockUpdate).toHaveBeenCalledWith('ol1', { team: 'TeamA', x: 5, y: 1 });
    expect(result).toEqual(updated);
  });

  it('omits undefined optional position fields', async () => {
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    mockCreate.mockResolvedValueOnce(sampleRecord);

    await saveLayout('TeamA', { x: 1, y: 2 });
    expect(mockCreate).toHaveBeenCalledWith({ team: 'TeamA', x: 1, y: 2 });
  });

  it('calls handleApiError and re-throws when getFirstListItem fails with non-404', async () => {
    const err = Object.assign(new Error('auth error'), { status: 401 });
    mockGetFirstListItem.mockRejectedValueOnce(err);
    await expect(saveLayout('TeamA', { x: 0, y: 0 })).rejects.toThrow('auth error');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });

  it('calls handleApiError and re-throws when create fails', async () => {
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    const err = new Error('create failed');
    mockCreate.mockRejectedValueOnce(err);
    await expect(saveLayout('TeamA', { x: 0, y: 0 })).rejects.toThrow('create failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});
