import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate, mockRequireOnline } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRequireOnline: vi.fn(),
}));

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      create: mockCreate,
    }),
  }),
  handleApiError: vi.fn(),
  escapeFilter: (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
  requireOnline: mockRequireOnline,
  getConnectionState: vi.fn(() => 'online'),
}));

import { dismissAlert } from './oncallDismissalService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('oncallDismissalService', () => {
  it('dismissAlert creates a record with alertType and dateKey', async () => {
    const record = {
      id: 'rec1',
      alertType: 'oracle',
      dateKey: '2026-03-26',
      created: '',
      updated: '',
    };
    mockCreate.mockResolvedValue(record);
    const result = await dismissAlert('oracle', '2026-03-26');
    expect(mockCreate).toHaveBeenCalledWith({
      alertType: 'oracle',
      dateKey: '2026-03-26',
    });
    expect(result).toEqual(record);
  });

  it('dismissAlert requires an online connection before writing', async () => {
    mockRequireOnline.mockImplementationOnce(() => {
      throw new Error('offline');
    });

    await expect(dismissAlert('oracle', '2026-03-26')).rejects.toThrow('offline');

    expect(mockCreate).not.toHaveBeenCalled();
  });
});
