import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockGetFullList = vi.fn();

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
      getFullList: mockGetFullList,
    }),
  }),
  handleApiError: vi.fn(),
  requireOnline: vi.fn(),
  getConnectionState: vi.fn(() => 'online'),
}));

vi.mock('../stores/collectionStoreRegistry', () => ({ applyOfflineMutationToStores: vi.fn() }));

import {
  addAlertHistory,
  deleteAlertHistory,
  clearAlertHistory,
  pinAlertHistory,
  updateAlertLabel,
  type AlertHistoryRecord,
  type AlertHistoryInput,
} from './alertHistoryService';
import { getConnectionState, handleApiError, requireOnline } from './pocketbase';

const mockHandleApiError = vi.mocked(handleApiError);
const mockRequireOnline = vi.mocked(requireOnline);
const mockGetConnectionState = vi.mocked(getConnectionState);

const sampleRecord: AlertHistoryRecord = {
  id: 'ah1',
  severity: 'ISSUE',
  subject: 'Outage',
  bodyHtml: '<p>Outage details</p>',
  sender: 'monitor@example.com',
  recipient: 'ops@example.com',
  pinned: false,
  label: '',
  created: '2024-01-01T00:00:00Z',
  updated: '2024-01-01T00:00:00Z',
};

const sampleInput: AlertHistoryInput = {
  severity: 'ISSUE',
  subject: 'Outage',
  bodyHtml: '<p>Outage details</p>',
  sender: 'monitor@example.com',
  recipient: 'ops@example.com',
  pinned: false,
  label: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConnectionState.mockReturnValue('online');
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const guideInput: AlertHistoryInput = {
  ...sampleInput,
  bodyHtml: `<p>Steps</p><figure class="alert-body-figure"><img src="${PNG}" alt="step" class="alert-body-image"><figcaption>One</figcaption></figure>`,
};

describe('addAlertHistory', () => {
  it('calls requireOnline and creates an alert history record', async () => {
    mockCreate.mockResolvedValueOnce(sampleRecord);
    const result = await addAlertHistory(sampleInput);
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(sampleInput);
    expect(result).toEqual({ record: sampleRecord, warning: null });
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('create failed');
    mockCreate.mockRejectedValueOnce(err);
    await expect(addAlertHistory(sampleInput)).rejects.toThrow('create failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });

  it('uploads files with the create when online', async () => {
    mockCreate.mockResolvedValueOnce({ ...sampleRecord, images: ['image-0_abc.png'] });
    const result = await addAlertHistory(guideInput);
    const sent = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.bodyHtml).toBe(
      '<p>Steps</p><figure class="alert-body-figure"><img data-relay-image="0" alt="step"><figcaption>One</figcaption></figure>',
    );
    expect(sent.images).toHaveLength(1);
    expect((sent.images as File[])[0]).toBeInstanceOf(File);
    expect(result.warning).toBeNull();
  });

  it('warns when the server drops images', async () => {
    mockCreate.mockResolvedValueOnce(sampleRecord);
    const result = await addAlertHistory(guideInput);
    expect(result.warning).toBe('server-images-dropped');
  });

  it('refuses more than 30 images before upload', async () => {
    const body = Array.from({ length: 31 }, () => `<img src="${PNG}" alt="">`).join('');
    await expect(addAlertHistory({ ...guideInput, bodyHtml: body })).rejects.toThrow(
      'This guide has 31 images; alert history holds up to 30.',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('saves text only and warns when offline', async () => {
    mockGetConnectionState.mockReturnValue('offline');
    const mutateOffline = vi.fn(async (input: { data?: Record<string, unknown> }) => ({
      ok: true,
      record: { ...sampleRecord, ...input.data },
    }));
    vi.stubGlobal('api', { mutateOffline });
    try {
      const result = await addAlertHistory(guideInput);
      const input = mutateOffline.mock.calls[0]![0];
      expect(input.data?.bodyHtml).toBe(
        '<p>Steps</p><figure class="alert-body-figure"><figcaption>One</figcaption></figure>',
      );
      expect(input.data).not.toHaveProperty('images');
      expect(result.warning).toBe('offline-images-dropped');
      expect(mockCreate).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('saves a text-only body offline without a warning', async () => {
    mockGetConnectionState.mockReturnValue('offline');
    const mutateOffline = vi.fn(async () => ({ ok: true, record: sampleRecord }));
    vi.stubGlobal('api', { mutateOffline });
    try {
      expect((await addAlertHistory(sampleInput)).warning).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('deleteAlertHistory', () => {
  it('calls requireOnline and deletes an alert history record', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    await deleteAlertHistory('ah1');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledWith('ah1');
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('delete failed');
    mockDelete.mockRejectedValueOnce(err);
    await expect(deleteAlertHistory('ah1')).rejects.toThrow('delete failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('clearAlertHistory', () => {
  it('fetches all records and deletes each one', async () => {
    const record2: AlertHistoryRecord = { ...sampleRecord, id: 'ah2' };
    mockGetFullList.mockResolvedValueOnce([sampleRecord, record2]);
    mockDelete.mockResolvedValue(undefined);
    await clearAlertHistory();
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenCalledWith('ah1');
    expect(mockDelete).toHaveBeenCalledWith('ah2');
  });

  it('does nothing when there are no records', async () => {
    mockGetFullList.mockResolvedValueOnce([]);
    await clearAlertHistory();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('fetch failed');
    mockGetFullList.mockRejectedValueOnce(err);
    await expect(clearAlertHistory()).rejects.toThrow('fetch failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('pinAlertHistory', () => {
  it('calls requireOnline and updates the pinned field', async () => {
    const pinned = { ...sampleRecord, pinned: true };
    mockUpdate.mockResolvedValueOnce(pinned);
    const result = await pinAlertHistory('ah1', true);
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('ah1', { pinned: true });
    expect(result).toEqual(pinned);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('pin failed');
    mockUpdate.mockRejectedValueOnce(err);
    await expect(pinAlertHistory('ah1', true)).rejects.toThrow('pin failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});

describe('updateAlertLabel', () => {
  it('calls requireOnline and updates the label field', async () => {
    const labeled = { ...sampleRecord, label: 'P1' };
    mockUpdate.mockResolvedValueOnce(labeled);
    const result = await updateAlertLabel('ah1', 'P1');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('ah1', { label: 'P1' });
    expect(result).toEqual(labeled);
  });

  it('calls handleApiError and re-throws on failure', async () => {
    const err = new Error('label failed');
    mockUpdate.mockRejectedValueOnce(err);
    await expect(updateAlertLabel('ah1', 'P1')).rejects.toThrow('label failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(err);
  });
});
