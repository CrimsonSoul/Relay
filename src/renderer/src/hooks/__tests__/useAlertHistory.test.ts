import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAlertHistory } from '../useAlertHistory';
import type { AlertHistoryEntry } from '@shared/ipc';

const showToast = vi.fn();

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

// Mock useCollection
const mockRefetch = vi.fn();
const mockCollectionData = { current: [] as unknown[] };
vi.mock('../useCollection', () => ({
  useCollection: () => ({
    data: mockCollectionData.current,
    loading: false,
    error: null,
    refetch: mockRefetch,
  }),
}));

// Mock PocketBase alert history service
const mockAddAlertHistory = vi.fn();
const mockDeleteAlertHistory = vi.fn();
const mockClearAlertHistory = vi.fn();
const mockPinAlertHistory = vi.fn();
const mockUpdateAlertLabel = vi.fn();
vi.mock('../../services/alertHistoryService', () => ({
  addAlertHistory: (...args: unknown[]) => mockAddAlertHistory(...args),
  deleteAlertHistory: (...args: unknown[]) => mockDeleteAlertHistory(...args),
  clearAlertHistory: (...args: unknown[]) => mockClearAlertHistory(...args),
  pinAlertHistory: (...args: unknown[]) => mockPinAlertHistory(...args),
  updateAlertLabel: (...args: unknown[]) => mockUpdateAlertLabel(...args),
}));

const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  severity: 'ISSUE',
  subject: 'Server down',
  bodyHtml: '<p>Details</p>',
  sender: 'ops@test.com',
  recipient: 'team@test.com',
  pinned: false,
  label: '',
  created: '2026-01-01T00:00:01Z',
  updated: '2026-01-01T00:00:01Z',
  ...overrides,
});

describe('useAlertHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollectionData.current = [
      makeRecord({ id: 'a1', created: '2026-01-01T00:00:01Z' }),
      makeRecord({
        id: 'a2',
        severity: 'MAINTENANCE',
        subject: 'High latency',
        created: '2026-01-01T00:00:02Z',
      }),
    ];
  });

  describe('loadHistory', () => {
    it('loads history from useCollection and maps to entries', () => {
      const { result } = renderHook(() => useAlertHistory());

      expect(result.current.history).toHaveLength(2);
      expect(result.current.history[0]?.id).toBe('a1');
      expect(result.current.loading).toBe(false);
    });

    it('returns empty array when no records', () => {
      mockCollectionData.current = [];
      const { result } = renderHook(() => useAlertHistory());
      expect(result.current.history).toEqual([]);
    });

    it('includes pinned and label when present', () => {
      mockCollectionData.current = [makeRecord({ id: 'p1', pinned: true, label: 'My Template' })];
      const { result } = renderHook(() => useAlertHistory());
      expect(result.current.history[0]?.pinned).toBe(true);
      expect(result.current.history[0]?.label).toBe('My Template');
    });
  });

  describe('addHistory', () => {
    it('adds entry via PocketBase service', async () => {
      const newRecord = makeRecord({
        id: 'a3',
        subject: 'New alert',
        created: '2026-01-01T00:00:03Z',
      });
      mockAddAlertHistory.mockResolvedValue(newRecord);

      const { result } = renderHook(() => useAlertHistory());

      let returned: AlertHistoryEntry | null = null;
      await act(async () => {
        returned = await result.current.addHistory({
          severity: 'ISSUE',
          subject: 'New alert',
          bodyHtml: '<p>Details</p>',
          sender: 'ops@test.com',
          recipient: 'team@test.com',
        });
      });

      expect(returned).not.toBeNull();
      expect(returned!.id).toBe('a3');
      expect(mockAddAlertHistory).toHaveBeenCalled();
    });

    it('shows error toast and returns null on thrown error', async () => {
      mockAddAlertHistory.mockRejectedValue(new Error('Save failed'));

      const { result } = renderHook(() => useAlertHistory());

      let returned: AlertHistoryEntry | null = null;
      await act(async () => {
        returned = await result.current.addHistory({
          severity: 'MAINTENANCE',
          subject: 'Test',
          bodyHtml: '<p>Test</p>',
          sender: 'a@b.com',
          recipient: 'c@d.com',
        });
      });

      expect(returned).toBeNull();
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't save to alert history. Save failed. Try again.",
        'error',
      );
    });
  });

  describe('deleteHistory', () => {
    it('deletes entry and shows success toast', async () => {
      mockDeleteAlertHistory.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAlertHistory());

      let success = false;
      await act(async () => {
        success = await result.current.deleteHistory('a1');
      });

      expect(success).toBe(true);
      expect(showToast).toHaveBeenCalledWith('Deleted the alert history entry', 'success');
    });

    it('handles thrown error and shows error toast', async () => {
      mockDeleteAlertHistory.mockRejectedValue(new Error('Delete failed'));

      const { result } = renderHook(() => useAlertHistory());

      let success = true;
      await act(async () => {
        success = await result.current.deleteHistory('a1');
      });

      expect(success).toBe(false);
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't delete the alert history entry. Delete failed. It is still in alert history. Try again.",
        'error',
      );
    });
  });

  describe('deleteHistoryEntries', () => {
    it('deletes exactly the given entries without a toast of its own', async () => {
      mockDeleteAlertHistory.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAlertHistory());

      let deleted: string[] = [];
      await act(async () => {
        deleted = await result.current.deleteHistoryEntries(['a1', 'a2']);
      });

      expect(deleted).toEqual(['a1', 'a2']);
      expect(mockDeleteAlertHistory).toHaveBeenCalledWith('a1');
      expect(mockDeleteAlertHistory).toHaveBeenCalledWith('a2');
      expect(mockClearAlertHistory).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
    });

    it('reports the entries it could not delete and resolves with the ones it did', async () => {
      mockDeleteAlertHistory
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Clear failed'));

      const { result } = renderHook(() => useAlertHistory());

      let deleted: string[] = [];
      await act(async () => {
        deleted = await result.current.deleteHistoryEntries(['a1', 'a2']);
      });

      expect(deleted).toEqual(['a1']);
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't clear 1 of 2 alert history entries. Clear failed. They are still in alert history. Try again.",
        'error',
      );
    });
  });

  describe('pinHistory', () => {
    it('pins an entry and shows success toast', async () => {
      mockPinAlertHistory.mockResolvedValue({ id: 'a1', pinned: true });

      const { result } = renderHook(() => useAlertHistory());

      let success = false;
      await act(async () => {
        success = await result.current.pinHistory('a1', true);
      });

      expect(success).toBe(true);
      expect(showToast).toHaveBeenCalledWith('Pinned "Server down" as a template', 'success');
    });

    it('unpins an entry and shows success toast', async () => {
      mockPinAlertHistory.mockResolvedValue({ id: 'a1', pinned: false });

      const { result } = renderHook(() => useAlertHistory());

      await act(async () => {
        await result.current.pinHistory('a1', false);
      });

      expect(showToast).toHaveBeenCalledWith('Unpinned "Server down"', 'success');
    });

    it('handles thrown error and shows error toast', async () => {
      mockPinAlertHistory.mockRejectedValue(new Error('Pin failed'));

      const { result } = renderHook(() => useAlertHistory());

      let success = true;
      await act(async () => {
        success = await result.current.pinHistory('a1', true);
      });

      expect(success).toBe(false);
      expect(showToast).toHaveBeenCalledWith(
        'Couldn\'t pin "Server down" as a template. Pin failed. Nothing changed. Try again.',
        'error',
        { action: expect.objectContaining({ label: 'Retry' }) },
      );

      mockPinAlertHistory.mockResolvedValueOnce({ id: 'a1', pinned: true });
      await act(async () => {
        showToast.mock.calls.at(-1)?.[2]?.action.onClick();
      });
      expect(mockPinAlertHistory).toHaveBeenLastCalledWith('a1', true);
      await vi.waitFor(() =>
        expect(showToast).toHaveBeenLastCalledWith('Pinned "Server down" as a template', 'success'),
      );
    });
  });

  describe('updateLabel', () => {
    it('updates label on an entry', async () => {
      mockUpdateAlertLabel.mockResolvedValue({ id: 'a1', label: 'Outage Template' });

      const { result } = renderHook(() => useAlertHistory());

      let success = false;
      await act(async () => {
        success = await result.current.updateLabel('a1', 'Outage Template');
      });

      expect(success).toBe(true);
    });

    it('handles thrown error and shows error toast', async () => {
      mockUpdateAlertLabel.mockRejectedValue(new Error('Label failed'));

      const { result } = renderHook(() => useAlertHistory());

      let success = true;
      await act(async () => {
        success = await result.current.updateLabel('a1', 'New Label');
      });

      expect(success).toBe(false);
      expect(showToast).toHaveBeenCalledWith(
        'Couldn\'t rename "Server down". Label failed. The previous label is kept. Try again.',
        'error',
      );
    });
  });
});
