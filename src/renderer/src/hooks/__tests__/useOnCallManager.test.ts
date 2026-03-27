import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOnCallManager } from '../useOnCallManager';
import type { OnCallRow } from '@shared/ipc';

const showToast = vi.fn();

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

// Mock PocketBase oncall service
const mockReplaceTeamRecords = vi.fn();
const mockDeleteOnCallByTeam = vi.fn();
const mockRenameTeam = vi.fn();
const mockReorderTeams = vi.fn();
vi.mock('../../services/oncallService', () => ({
  replaceTeamRecords: (...args: unknown[]) => mockReplaceTeamRecords(...args),
  deleteOnCallByTeam: (...args: unknown[]) => mockDeleteOnCallByTeam(...args),
  renameTeam: (...args: unknown[]) => mockRenameTeam(...args),
  reorderTeams: (...args: unknown[]) => mockReorderTeams(...args),
}));

const makeRow = (overrides: Partial<OnCallRow> = {}): OnCallRow => ({
  id: 'r1',
  team: 'Alpha',
  role: 'Primary',
  name: 'Alice',
  contact: 'alice@test.com',
  timeWindow: '9-5',
  ...overrides,
});

describe('useOnCallManager', () => {
  const dismissAlert = vi.fn();

  const defaultRows: OnCallRow[] = [
    makeRow({ id: 'r1', team: 'Alpha', name: 'Alice' }),
    makeRow({ id: 'r2', team: 'Alpha', role: 'Secondary', name: 'Bob' }),
    makeRow({ id: 'r3', team: 'Bravo', name: 'Charlie' }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('initialization', () => {
    it('initializes localOnCall from the provided onCall prop', () => {
      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));
      expect(result.current.localOnCall).toEqual(defaultRows);
    });

    it('computes unique team names from localOnCall', () => {
      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));
      expect(result.current.teams).toEqual(['Alpha', 'Bravo']);
    });

    it('returns a weekRange string', () => {
      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));
      expect(typeof result.current.weekRange).toBe('string');
      expect(result.current.weekRange.length).toBeGreaterThan(0);
    });

    it('handles empty onCall array', () => {
      const { result } = renderHook(() => useOnCallManager([], dismissAlert));
      expect(result.current.localOnCall).toEqual([]);
      expect(result.current.teams).toEqual([]);
    });
  });

  describe('external sync', () => {
    it('syncs localOnCall when the onCall prop changes and no mutations are in-flight', () => {
      const { result, rerender } = renderHook(
        ({ onCall }) => useOnCallManager(onCall, dismissAlert),
        { initialProps: { onCall: defaultRows } },
      );

      expect(result.current.localOnCall).toEqual(defaultRows);

      const updatedRows = [makeRow({ id: 'r4', team: 'Delta', name: 'Dave' })];
      rerender({ onCall: updatedRows });

      expect(result.current.localOnCall).toEqual(updatedRows);
    });
  });

  describe('weekRange interval', () => {
    it('updates weekRange periodically', () => {
      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      const initialWeekRange = result.current.weekRange;
      expect(typeof initialWeekRange).toBe('string');

      act(() => {
        vi.advanceTimersByTime(60000);
      });

      expect(typeof result.current.weekRange).toBe('string');
    });

    it('cleans up interval on unmount', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

      const { unmount } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));
      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });

  describe('handleUpdateRows', () => {
    it('optimistically updates local state with new rows for existing team', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      const updatedRows = [
        makeRow({ id: 'r1', team: 'Alpha', name: 'Alice Updated' }),
        makeRow({ id: 'r2', team: 'Alpha', role: 'Secondary', name: 'Bob Updated' }),
      ];

      await act(async () => {
        await result.current.handleUpdateRows('Alpha', updatedRows);
      });

      expect(mockReplaceTeamRecords).toHaveBeenCalled();

      const alphaRows = result.current.localOnCall.filter((r) => r.team === 'Alpha');
      expect(alphaRows).toEqual(updatedRows);

      const bravoRows = result.current.localOnCall.filter((r) => r.team === 'Bravo');
      expect(bravoRows).toEqual([defaultRows[2]]);
    });

    it('rolls back to previous state when API throws', async () => {
      mockReplaceTeamRecords.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleUpdateRows('Alpha', [
          makeRow({ id: 'r1', team: 'Alpha', name: 'Alice Updated' }),
        ]);
      });

      expect(result.current.localOnCall).toEqual(defaultRows);
      expect(showToast).toHaveBeenCalledWith('Failed to save changes', 'error');
    });

    it('dismisses first-responder alert on Sunday for first responder team', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      vi.setSystemTime(new Date(2026, 2, 1)); // 2026-03-01 is a Sunday

      const rows = [makeRow({ id: 'r1', team: 'First Responder', name: 'Alice' })];
      const { result } = renderHook(() => useOnCallManager(rows, dismissAlert));

      await act(async () => {
        await result.current.handleUpdateRows('First Responder', rows);
      });

      expect(dismissAlert).toHaveBeenCalledWith('first-responder');
    });

    it('dismisses general alert on Monday', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      vi.setSystemTime(new Date(2026, 2, 2)); // 2026-03-02 is a Monday

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleUpdateRows('Alpha', [defaultRows[0]]);
      });

      expect(dismissAlert).toHaveBeenCalledWith('general');
    });

    it('dismisses sql alert on Wednesday for SQL team', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      vi.setSystemTime(new Date(2026, 2, 4)); // 2026-03-04 is a Wednesday

      const sqlRows = [makeRow({ id: 'r10', team: 'SQL Support', name: 'Dave' })];
      const { result } = renderHook(() => useOnCallManager(sqlRows, dismissAlert));

      await act(async () => {
        await result.current.handleUpdateRows('SQL Support', sqlRows);
      });

      expect(dismissAlert).toHaveBeenCalledWith('sql');
    });

    it('dismisses oracle alert on Thursday for Oracle team', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      vi.setSystemTime(new Date(2026, 2, 5)); // 2026-03-05 is a Thursday

      const oracleRows = [makeRow({ id: 'r11', team: 'Oracle DBA', name: 'Eve' })];
      const { result } = renderHook(() => useOnCallManager(oracleRows, dismissAlert));

      await act(async () => {
        await result.current.handleUpdateRows('Oracle DBA', oracleRows);
      });

      expect(dismissAlert).toHaveBeenCalledWith('oracle');
    });

    it('does not dismiss any alert when conditions do not match', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      vi.setSystemTime(new Date(2026, 2, 3)); // 2026-03-03 is a Tuesday

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleUpdateRows('Alpha', [defaultRows[0]]);
      });

      expect(dismissAlert).not.toHaveBeenCalled();
    });
  });

  describe('handleRemoveTeam', () => {
    it('removes team from local state on success', async () => {
      mockDeleteOnCallByTeam.mockResolvedValue(undefined);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleRemoveTeam('Alpha');
      });

      expect(mockDeleteOnCallByTeam).toHaveBeenCalledWith('Alpha');
      expect(result.current.localOnCall).toEqual([defaultRows[2]]);
      expect(result.current.teams).toEqual(['Bravo']);
      expect(showToast).toHaveBeenCalledWith('Removed Alpha', 'success');
    });

    it('does not remove team on API failure and shows error toast', async () => {
      mockDeleteOnCallByTeam.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleRemoveTeam('Alpha');
      });

      expect(result.current.localOnCall).toEqual(defaultRows);
      expect(showToast).toHaveBeenCalledWith('Failed to remove team', 'error');
    });
  });

  describe('handleRenameTeam', () => {
    it('renames team in local state on success', async () => {
      mockRenameTeam.mockResolvedValue(undefined);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleRenameTeam('Alpha', 'AlphaRenamed');
      });

      expect(mockRenameTeam).toHaveBeenCalledWith('Alpha', 'AlphaRenamed');

      const renamedRows = result.current.localOnCall.filter((r) => r.team === 'AlphaRenamed');
      expect(renamedRows).toHaveLength(2);
      expect(result.current.localOnCall.filter((r) => r.team === 'Alpha')).toHaveLength(0);
      expect(result.current.teams).toContain('AlphaRenamed');
      expect(result.current.teams).not.toContain('Alpha');
      expect(showToast).toHaveBeenCalledWith('Renamed Alpha to AlphaRenamed', 'success');
    });

    it('does not rename on API failure and shows error toast', async () => {
      mockRenameTeam.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleRenameTeam('Alpha', 'AlphaRenamed');
      });

      expect(result.current.teams).toContain('Alpha');
      expect(result.current.teams).not.toContain('AlphaRenamed');
      expect(showToast).toHaveBeenCalledWith('Failed to rename team', 'error');
    });
  });

  describe('handleAddTeam', () => {
    it('adds a new team optimistically and calls API', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      mockReorderTeams.mockResolvedValue(undefined);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleAddTeam('NewTeam');
      });

      expect(mockReplaceTeamRecords).toHaveBeenCalled();
      expect(mockReorderTeams).toHaveBeenCalled();

      expect(result.current.teams).toContain('NewTeam');
      expect(showToast).toHaveBeenCalledWith('Added team NewTeam', 'success');
    });

    it('rolls back optimistic add when replaceTeamRecords fails', async () => {
      mockReplaceTeamRecords.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleAddTeam('FailTeam');
      });

      expect(result.current.teams).not.toContain('FailTeam');
      expect(result.current.localOnCall).toHaveLength(3);
      expect(showToast).toHaveBeenCalledWith('Failed to add team', 'error');
    });

    it('rolls back when reorderTeams throws after successful add', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      mockReorderTeams.mockRejectedValue(new Error('Reorder failed'));

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleAddTeam('ReorderFailTeam');
      });

      expect(result.current.teams).not.toContain('ReorderFailTeam');
      expect(showToast).toHaveBeenCalledWith('Failed to add team', 'error');
    });
  });

  describe('handleReorderTeams', () => {
    it('reorders teams optimistically and calls API', async () => {
      mockReorderTeams.mockResolvedValue(undefined);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      expect(result.current.teams).toEqual(['Alpha', 'Bravo']);

      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      expect(mockReorderTeams).toHaveBeenCalledWith(['Bravo', 'Alpha']);
      expect(result.current.teams).toEqual(['Bravo', 'Alpha']);
      expect(showToast).toHaveBeenCalledWith('Teams reordered', 'success');
    });

    it('rolls back on API failure', async () => {
      mockReorderTeams.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      expect(result.current.teams).toEqual(['Alpha', 'Bravo']);
      expect(showToast).toHaveBeenCalledWith('Failed to save team order', 'error');
    });

    it('does nothing when oldIndex equals newIndex', async () => {
      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleReorderTeams(0, 0);
      });

      expect(mockReorderTeams).not.toHaveBeenCalled();
      expect(result.current.teams).toEqual(['Alpha', 'Bravo']);
    });

    it('does nothing when oldIndex is out of bounds', async () => {
      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleReorderTeams(99, 0);
      });

      expect(mockReorderTeams).not.toHaveBeenCalled();
    });
  });

  describe('setLocalOnCall', () => {
    it('allows direct state updates via the exposed setter', () => {
      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      const newRows = [makeRow({ id: 'r99', team: 'Direct', name: 'Zara' })];

      act(() => {
        result.current.setLocalOnCall(newRows);
      });

      expect(result.current.localOnCall).toEqual(newRows);
      expect(result.current.teams).toEqual(['Direct']);
    });
  });
});
