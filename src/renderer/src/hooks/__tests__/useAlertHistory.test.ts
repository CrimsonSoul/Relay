import { renderHook, act, waitFor } from '@testing-library/react';
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

const makeEntry = (overrides: Partial<AlertHistoryEntry> = {}): AlertHistoryEntry => ({
  id: 'a1',
  timestamp: 1000,
  severity: 'ISSUE',
  subject: 'Server down',
  bodyHtml: '<p>Details</p>',
  sender: 'ops@test.com',
  recipient: 'team@test.com',
  ...overrides,
});

describe('useAlertHistory', () => {
  const mockHistory: AlertHistoryEntry[] = [
    makeEntry({ id: 'a1', timestamp: 1000 }),
    makeEntry({ id: 'a2', timestamp: 2000, severity: 'MAINTENANCE', subject: 'High latency' }),
  ];

  const mockApi = {
    getAlertHistory: vi.fn(),
    addAlertHistory: vi.fn(),
    deleteAlertHistory: vi.fn(),
    clearAlertHistory: vi.fn(),
    pinAlertHistory: vi.fn(),
    updateAlertHistoryLabel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Window & { api: typeof mockApi }).api = mockApi as typeof globalThis.api;
    mockApi.getAlertHistory.mockResolvedValue(mockHistory);
  });

  // ---------------------------------------------------------------------------
  // loadHistory
  // ---------------------------------------------------------------------------

  describe('loadHistory', () => {
    it('loads history on mount and sets loading to false', async () => {
      const { result } = renderHook(() => useAlertHistory());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.history).toEqual(mockHistory);
      expect(mockApi.getAlertHistory).toHaveBeenCalledTimes(1);
    });

    it('normalizes entries and filters out invalid ones', async () => {
      mockApi.getAlertHistory.mockResolvedValue([
        makeEntry({ id: 'valid1' }),
        { id: 123, timestamp: 'not-a-number' }, // invalid: id not string, timestamp not number
        { missing: 'fields' }, // invalid: missing required fields
        null, // invalid: not an object
        makeEntry({ id: 'valid2', severity: 'RESOLVED' }),
      ]);

      const { result } = renderHook(() => useAlertHistory());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.history).toHaveLength(2);
      expect(result.current.history[0].id).toBe('valid1');
      expect(result.current.history[1].id).toBe('valid2');
    });

    it('normalizes entries with missing optional fields', async () => {
      mockApi.getAlertHistory.mockResolvedValue([
        {
          id: 'e1',
          timestamp: 5000,
          severity: 'INFO',
          subject: 'Info alert',
          bodyHtml: '<p>Info</p>',
          sender: 'ops@test.com',
          // recipient missing -> should default to ''
          // pinned missing -> should be absent
          // label missing -> should be absent
        },
      ]);

      const { result } = renderHook(() => useAlertHistory());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.history).toHaveLength(1);
      expect(result.current.history[0].recipient).toBe('');
      expect(result.current.history[0].pinned).toBeUndefined();
      expect(result.current.history[0].label).toBeUndefined();
    });

    it('includes pinned and label when present', async () => {
      mockApi.getAlertHistory.mockResolvedValue([
        makeEntry({ id: 'p1', pinned: true, label: 'My Template' }),
      ]);

      const { result } = renderHook(() => useAlertHistory());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.history[0].pinned).toBe(true);
      expect(result.current.history[0].label).toBe('My Template');
    });

    it('filters entries with invalid severity', async () => {
      mockApi.getAlertHistory.mockResolvedValue([
        makeEntry({ id: 'ok', severity: 'ISSUE' }),
        { ...makeEntry({ id: 'bad' }), severity: 'UNKNOWN' },
      ]);

      const { result } = renderHook(() => useAlertHistory());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.history).toHaveLength(1);
      expect(result.current.history[0].id).toBe('ok');
    });

    it('returns empty array when API returns non-array', async () => {
      mockApi.getAlertHistory.mockResolvedValue(null);

      const { result } = renderHook(() => useAlertHistory());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.history).toEqual([]);
    });

    it('returns empty array when API returns undefined', async () => {
      mockApi.getAlertHistory.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAlertHistory());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.history).toEqual([]);
    });

    it('handles API error during load', async () => {
      mockApi.getAlertHistory.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAlertHistory());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.history).toEqual([]);
      expect(showToast).toHaveBeenCalledWith('Failed to load alert history', 'error');
    });

    it('reloadHistory re-fetches data', async () => {
      const { result } = renderHook(() => useAlertHistory());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockApi.getAlertHistory).toHaveBeenCalledTimes(1);

      const updatedHistory = [makeEntry({ id: 'a3', timestamp: 3000 })];
      mockApi.getAlertHistory.mockResolvedValue(updatedHistory);

      await act(async () => {
        await result.current.reloadHistory();
      });

      expect(mockApi.getAlertHistory).toHaveBeenCalledTimes(2);
      expect(result.current.history).toEqual(updatedHistory);
    });
  });

  // ---------------------------------------------------------------------------
  // addHistory
  // ---------------------------------------------------------------------------

  describe('addHistory', () => {
    it('adds entry and prepends to state', async () => {
      const newEntry = makeEntry({ id: 'a3', timestamp: 3000, subject: 'New alert' });
      mockApi.addAlertHistory.mockResolvedValue(newEntry);

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

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

      expect(returned).toEqual(newEntry);
      expect(result.current.history).toHaveLength(3);
      expect(result.current.history[0]).toEqual(newEntry);
    });

    it('adds entry when API returns IpcResult wrapper', async () => {
      const newEntry = makeEntry({ id: 'a4', timestamp: 4000 });
      mockApi.addAlertHistory.mockResolvedValue({ success: true, data: newEntry });

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.addHistory({
          severity: 'ISSUE',
          subject: 'Server down',
          bodyHtml: '<p>Details</p>',
          sender: 'ops@test.com',
          recipient: 'team@test.com',
        });
      });

      expect(result.current.history).toHaveLength(3);
      expect(result.current.history[0]).toEqual(newEntry);
    });

    it('shows error toast when add returns non-normalizable result', async () => {
      mockApi.addAlertHistory.mockResolvedValue(null);

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

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

      expect(returned).toBeNull();
      expect(result.current.history).toHaveLength(2); // unchanged
      expect(showToast).toHaveBeenCalledWith('Failed to save alert history', 'error');
    });

    it('shows error toast and returns null on thrown error', async () => {
      mockApi.addAlertHistory.mockRejectedValue(new Error('Save failed'));

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

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
      expect(result.current.history).toHaveLength(2); // unchanged
      expect(showToast).toHaveBeenCalledWith('Failed to save alert history', 'error');
    });
  });

  // ---------------------------------------------------------------------------
  // deleteHistory
  // ---------------------------------------------------------------------------

  describe('deleteHistory', () => {
    it('removes entry from state and shows success toast', async () => {
      mockApi.deleteAlertHistory.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = false;
      await act(async () => {
        success = await result.current.deleteHistory('a1');
      });

      expect(success).toBe(true);
      expect(result.current.history).toHaveLength(1);
      expect(result.current.history[0].id).toBe('a2');
      expect(showToast).toHaveBeenCalledWith('History entry deleted', 'success');
    });

    it('does not remove entry on API failure and shows error toast', async () => {
      mockApi.deleteAlertHistory.mockResolvedValue({ success: false });

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = true;
      await act(async () => {
        success = await result.current.deleteHistory('a1');
      });

      expect(success).toBe(false);
      expect(result.current.history).toHaveLength(2);
      expect(showToast).toHaveBeenCalledWith('Failed to delete history entry', 'error');
    });

    it('handles non-IpcResult falsy response', async () => {
      mockApi.deleteAlertHistory.mockResolvedValue(false);

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = true;
      await act(async () => {
        success = await result.current.deleteHistory('a1');
      });

      expect(success).toBe(false);
      expect(result.current.history).toHaveLength(2);
    });

    it('handles thrown error and shows error toast', async () => {
      mockApi.deleteAlertHistory.mockRejectedValue(new Error('Delete failed'));

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = true;
      await act(async () => {
        success = await result.current.deleteHistory('a1');
      });

      expect(success).toBe(false);
      expect(result.current.history).toHaveLength(2);
      expect(showToast).toHaveBeenCalledWith('Failed to delete history entry', 'error');
    });
  });

  // ---------------------------------------------------------------------------
  // clearHistory
  // ---------------------------------------------------------------------------

  describe('clearHistory', () => {
    it('clears all entries and shows success toast', async () => {
      mockApi.clearAlertHistory.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = false;
      await act(async () => {
        success = await result.current.clearHistory();
      });

      expect(success).toBe(true);
      expect(result.current.history).toEqual([]);
      expect(showToast).toHaveBeenCalledWith('Alert history cleared', 'success');
    });

    it('does not clear on API failure and shows error toast', async () => {
      mockApi.clearAlertHistory.mockResolvedValue({ success: false });

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = true;
      await act(async () => {
        success = await result.current.clearHistory();
      });

      expect(success).toBe(false);
      expect(result.current.history).toHaveLength(2);
      expect(showToast).toHaveBeenCalledWith('Failed to clear history', 'error');
    });

    it('handles non-IpcResult falsy response', async () => {
      mockApi.clearAlertHistory.mockResolvedValue(false);

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = true;
      await act(async () => {
        success = await result.current.clearHistory();
      });

      expect(success).toBe(false);
      expect(result.current.history).toHaveLength(2);
    });

    it('handles thrown error and shows error toast', async () => {
      mockApi.clearAlertHistory.mockRejectedValue(new Error('Clear failed'));

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = true;
      await act(async () => {
        success = await result.current.clearHistory();
      });

      expect(success).toBe(false);
      expect(result.current.history).toHaveLength(2);
      expect(showToast).toHaveBeenCalledWith('Failed to clear history', 'error');
    });
  });

  // ---------------------------------------------------------------------------
  // pinHistory
  // ---------------------------------------------------------------------------

  describe('pinHistory', () => {
    it('pins an entry and shows success toast', async () => {
      mockApi.pinAlertHistory.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = false;
      await act(async () => {
        success = await result.current.pinHistory('a1', true);
      });

      expect(success).toBe(true);
      expect(result.current.history.find((h) => h.id === 'a1')?.pinned).toBe(true);
      expect(showToast).toHaveBeenCalledWith('Pinned as template', 'success');
    });

    it('unpins an entry, clears label, and shows success toast', async () => {
      // Start with a pinned + labeled entry
      mockApi.getAlertHistory.mockResolvedValue([
        makeEntry({ id: 'a1', pinned: true, label: 'My Template' }),
      ]);
      mockApi.pinAlertHistory.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.pinHistory('a1', false);
      });

      const entry = result.current.history.find((h) => h.id === 'a1');
      expect(entry?.pinned).toBeUndefined();
      expect(entry?.label).toBeUndefined();
      expect(showToast).toHaveBeenCalledWith('Unpinned', 'success');
    });

    it('shows error toast on API failure', async () => {
      mockApi.pinAlertHistory.mockResolvedValue({ success: false });

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = true;
      await act(async () => {
        success = await result.current.pinHistory('a1', true);
      });

      expect(success).toBe(false);
      expect(result.current.history.find((h) => h.id === 'a1')?.pinned).toBeUndefined();
      expect(showToast).toHaveBeenCalledWith('Failed to update pin', 'error');
    });

    it('handles thrown error and shows error toast', async () => {
      mockApi.pinAlertHistory.mockRejectedValue(new Error('Pin failed'));

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = true;
      await act(async () => {
        success = await result.current.pinHistory('a1', true);
      });

      expect(success).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Failed to update pin', 'error');
    });
  });

  // ---------------------------------------------------------------------------
  // updateLabel
  // ---------------------------------------------------------------------------

  describe('updateLabel', () => {
    it('updates label on an entry', async () => {
      mockApi.updateAlertHistoryLabel.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = false;
      await act(async () => {
        success = await result.current.updateLabel('a1', 'Outage Template');
      });

      expect(success).toBe(true);
      expect(result.current.history.find((h) => h.id === 'a1')?.label).toBe('Outage Template');
    });

    it('clears label when empty string is provided', async () => {
      mockApi.getAlertHistory.mockResolvedValue([makeEntry({ id: 'a1', label: 'Old Label' })]);
      mockApi.updateAlertHistoryLabel.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.updateLabel('a1', '');
      });

      expect(result.current.history.find((h) => h.id === 'a1')?.label).toBeUndefined();
    });

    it('shows error toast on API failure', async () => {
      mockApi.updateAlertHistoryLabel.mockResolvedValue({ success: false });

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = true;
      await act(async () => {
        success = await result.current.updateLabel('a1', 'New Label');
      });

      expect(success).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Failed to update label', 'error');
    });

    it('handles thrown error and shows error toast', async () => {
      mockApi.updateAlertHistoryLabel.mockRejectedValue(new Error('Label failed'));

      const { result } = renderHook(() => useAlertHistory());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let success = true;
      await act(async () => {
        success = await result.current.updateLabel('a1', 'New Label');
      });

      expect(success).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Failed to update label', 'error');
    });
  });
});
