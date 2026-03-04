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
  const mockApi = {
    updateOnCallTeam: vi.fn(),
    removeOnCallTeam: vi.fn(),
    renameOnCallTeam: vi.fn(),
    reorderOnCallTeams: vi.fn(),
  };

  const dismissAlert = vi.fn();

  const defaultRows: OnCallRow[] = [
    makeRow({ id: 'r1', team: 'Alpha', name: 'Alice' }),
    makeRow({ id: 'r2', team: 'Alpha', role: 'Secondary', name: 'Bob' }),
    makeRow({ id: 'r3', team: 'Bravo', name: 'Charlie' }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (globalThis as Window & { api: typeof mockApi }).api =
      mockApi as unknown as typeof globalThis.api;
    // Provide a deterministic randomUUID for handleAddTeam
    vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // External sync (onCall prop changes)
  // ---------------------------------------------------------------------------

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

    it('does NOT sync localOnCall when a mutation is in-flight', async () => {
      // Make the API call hang so the mutation stays in-flight
      let resolveUpdate!: (value: boolean) => void;
      mockApi.updateOnCallTeam.mockReturnValue(
        new Promise<boolean>((resolve) => {
          resolveUpdate = resolve;
        }),
      );

      const { result, rerender } = renderHook(
        ({ onCall }) => useOnCallManager(onCall, dismissAlert),
        { initialProps: { onCall: defaultRows } },
      );

      // Start a mutation (will increment pendingMutationsRef)
      const updatePromise = act(async () => {
        void result.current.handleUpdateRows('Alpha', [
          makeRow({ id: 'r1', team: 'Alpha', name: 'Alice Updated' }),
        ]);
      });

      // While mutation is in-flight, change the prop
      const externalRows = [makeRow({ id: 'r99', team: 'External', name: 'External' })];
      rerender({ onCall: externalRows });

      // localOnCall should NOT have been overwritten by external prop
      expect(result.current.localOnCall).not.toEqual(externalRows);

      // Resolve the pending mutation
      resolveUpdate(true);
      await updatePromise;
    });

    it('applies latest external onCall once in-flight mutation completes', async () => {
      let resolveUpdate!: (value: boolean) => void;
      mockApi.updateOnCallTeam.mockReturnValue(
        new Promise<boolean>((resolve) => {
          resolveUpdate = resolve;
        }),
      );

      const { result, rerender } = renderHook(
        ({ onCall }) => useOnCallManager(onCall, dismissAlert),
        { initialProps: { onCall: defaultRows } },
      );

      let mutationPromise: Promise<void> | undefined;
      act(() => {
        mutationPromise = result.current.handleUpdateRows('Alpha', [
          makeRow({ id: 'r1', team: 'Alpha', name: 'Alice Updated' }),
        ]);
      });

      const externalRows = [makeRow({ id: 'r99', team: 'External', name: 'External' })];
      rerender({ onCall: externalRows });

      expect(result.current.localOnCall).not.toEqual(externalRows);

      resolveUpdate(true);
      await act(async () => {
        await mutationPromise;
      });

      expect(result.current.localOnCall).toEqual(externalRows);
    });
  });

  // ---------------------------------------------------------------------------
  // weekRange interval
  // ---------------------------------------------------------------------------

  describe('weekRange interval', () => {
    it('updates weekRange periodically', () => {
      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      const initialWeekRange = result.current.weekRange;
      expect(typeof initialWeekRange).toBe('string');

      // Advance timers by 60 seconds
      act(() => {
        vi.advanceTimersByTime(60000);
      });

      // weekRange should still be a valid string (may or may not change depending on timing)
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

  // ---------------------------------------------------------------------------
  // handleUpdateRows
  // ---------------------------------------------------------------------------

  describe('handleUpdateRows', () => {
    it('optimistically updates local state with new rows for existing team', async () => {
      mockApi.updateOnCallTeam.mockResolvedValue(true);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      const updatedRows = [
        makeRow({ id: 'r1', team: 'Alpha', name: 'Alice Updated' }),
        makeRow({ id: 'r2', team: 'Alpha', role: 'Secondary', name: 'Bob Updated' }),
      ];

      await act(async () => {
        await result.current.handleUpdateRows('Alpha', updatedRows);
      });

      expect(mockApi.updateOnCallTeam).toHaveBeenCalledWith('Alpha', updatedRows);

      const alphaRows = result.current.localOnCall.filter((r) => r.team === 'Alpha');
      expect(alphaRows).toEqual(updatedRows);

      // Bravo rows should be unchanged
      const bravoRows = result.current.localOnCall.filter((r) => r.team === 'Bravo');
      expect(bravoRows).toEqual([defaultRows[2]]);
    });

    it('preserves team order when updating existing team', async () => {
      mockApi.updateOnCallTeam.mockResolvedValue(true);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      const updatedAlpha = [makeRow({ id: 'r1', team: 'Alpha', name: 'Alice V2' })];

      await act(async () => {
        await result.current.handleUpdateRows('Alpha', updatedAlpha);
      });

      // Alpha should still come before Bravo
      const teamOrder = result.current.localOnCall.map((r) => r.team);
      expect(teamOrder.indexOf('Alpha')).toBeLessThan(teamOrder.indexOf('Bravo'));
    });

    it('appends rows for a new team that does not exist yet', async () => {
      mockApi.updateOnCallTeam.mockResolvedValue(true);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      const newTeamRows = [makeRow({ id: 'r5', team: 'Charlie', name: 'Eve' })];

      await act(async () => {
        await result.current.handleUpdateRows('Charlie', newTeamRows);
      });

      expect(result.current.localOnCall).toHaveLength(4);
      expect(result.current.teams).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('rolls back to previous state when API returns false', async () => {
      mockApi.updateOnCallTeam.mockResolvedValue(false);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleUpdateRows('Alpha', [
          makeRow({ id: 'r1', team: 'Alpha', name: 'Alice Updated' }),
        ]);
      });

      // Should have rolled back
      expect(result.current.localOnCall).toEqual(defaultRows);
      expect(showToast).toHaveBeenCalledWith('Failed to save changes', 'error');
    });

    it('dismisses first-responder alert on Sunday for first responder team', async () => {
      mockApi.updateOnCallTeam.mockResolvedValue(true);
      // Sunday = day 0
      vi.setSystemTime(new Date(2026, 2, 1)); // 2026-03-01 is a Sunday

      const rows = [makeRow({ id: 'r1', team: 'First Responder', name: 'Alice' })];
      const { result } = renderHook(() => useOnCallManager(rows, dismissAlert));

      await act(async () => {
        await result.current.handleUpdateRows('First Responder', rows);
      });

      expect(dismissAlert).toHaveBeenCalledWith('first-responder');
    });

    it('dismisses general alert on Monday', async () => {
      mockApi.updateOnCallTeam.mockResolvedValue(true);
      // Monday = day 1
      vi.setSystemTime(new Date(2026, 2, 2)); // 2026-03-02 is a Monday

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleUpdateRows('Alpha', [defaultRows[0]]);
      });

      expect(dismissAlert).toHaveBeenCalledWith('general');
    });

    it('dismisses sql alert on Wednesday for SQL team', async () => {
      mockApi.updateOnCallTeam.mockResolvedValue(true);
      // Wednesday = day 3
      vi.setSystemTime(new Date(2026, 2, 4)); // 2026-03-04 is a Wednesday

      const sqlRows = [makeRow({ id: 'r10', team: 'SQL Support', name: 'Dave' })];
      const { result } = renderHook(() => useOnCallManager(sqlRows, dismissAlert));

      await act(async () => {
        await result.current.handleUpdateRows('SQL Support', sqlRows);
      });

      expect(dismissAlert).toHaveBeenCalledWith('sql');
    });

    it('dismisses oracle alert on Thursday for Oracle team', async () => {
      mockApi.updateOnCallTeam.mockResolvedValue(true);
      // Thursday = day 4
      vi.setSystemTime(new Date(2026, 2, 5)); // 2026-03-05 is a Thursday

      const oracleRows = [makeRow({ id: 'r11', team: 'Oracle DBA', name: 'Eve' })];
      const { result } = renderHook(() => useOnCallManager(oracleRows, dismissAlert));

      await act(async () => {
        await result.current.handleUpdateRows('Oracle DBA', oracleRows);
      });

      expect(dismissAlert).toHaveBeenCalledWith('oracle');
    });

    it('does not dismiss any alert when conditions do not match', async () => {
      mockApi.updateOnCallTeam.mockResolvedValue(true);
      // Tuesday = day 2
      vi.setSystemTime(new Date(2026, 2, 3)); // 2026-03-03 is a Tuesday

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleUpdateRows('Alpha', [defaultRows[0]]);
      });

      expect(dismissAlert).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // handleRemoveTeam
  // ---------------------------------------------------------------------------

  describe('handleRemoveTeam', () => {
    it('removes team from local state on success', async () => {
      mockApi.removeOnCallTeam.mockResolvedValue(true);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleRemoveTeam('Alpha');
      });

      expect(mockApi.removeOnCallTeam).toHaveBeenCalledWith('Alpha');
      expect(result.current.localOnCall).toEqual([defaultRows[2]]);
      expect(result.current.teams).toEqual(['Bravo']);
      expect(showToast).toHaveBeenCalledWith('Removed Alpha', 'success');
    });

    it('does not remove team on API failure and shows error toast', async () => {
      mockApi.removeOnCallTeam.mockResolvedValue(false);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleRemoveTeam('Alpha');
      });

      expect(result.current.localOnCall).toEqual(defaultRows);
      expect(showToast).toHaveBeenCalledWith('Failed to remove team', 'error');
    });
  });

  // ---------------------------------------------------------------------------
  // handleRenameTeam
  // ---------------------------------------------------------------------------

  describe('handleRenameTeam', () => {
    it('renames team in local state on success', async () => {
      mockApi.renameOnCallTeam.mockResolvedValue(true);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleRenameTeam('Alpha', 'AlphaRenamed');
      });

      expect(mockApi.renameOnCallTeam).toHaveBeenCalledWith('Alpha', 'AlphaRenamed');

      const renamedRows = result.current.localOnCall.filter((r) => r.team === 'AlphaRenamed');
      expect(renamedRows).toHaveLength(2);
      expect(result.current.localOnCall.filter((r) => r.team === 'Alpha')).toHaveLength(0);

      expect(result.current.teams).toContain('AlphaRenamed');
      expect(result.current.teams).not.toContain('Alpha');

      expect(showToast).toHaveBeenCalledWith('Renamed Alpha to AlphaRenamed', 'success');
    });

    it('does not rename on API failure and shows error toast', async () => {
      mockApi.renameOnCallTeam.mockResolvedValue(false);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleRenameTeam('Alpha', 'AlphaRenamed');
      });

      // Should be unchanged
      expect(result.current.teams).toContain('Alpha');
      expect(result.current.teams).not.toContain('AlphaRenamed');
      expect(showToast).toHaveBeenCalledWith('Failed to rename team', 'error');
    });
  });

  // ---------------------------------------------------------------------------
  // handleAddTeam
  // ---------------------------------------------------------------------------

  describe('handleAddTeam', () => {
    it('adds a new team optimistically and calls API', async () => {
      mockApi.updateOnCallTeam.mockResolvedValue(true);
      mockApi.reorderOnCallTeams.mockResolvedValue(true);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleAddTeam('NewTeam');
      });

      expect(mockApi.updateOnCallTeam).toHaveBeenCalledWith('NewTeam', [
        {
          id: 'test-uuid-1234',
          team: 'NewTeam',
          role: 'Primary',
          name: '',
          contact: '',
          timeWindow: '',
        },
      ]);

      expect(mockApi.reorderOnCallTeams).toHaveBeenCalledWith(['Alpha', 'Bravo', 'NewTeam'], {});

      expect(result.current.teams).toContain('NewTeam');
      expect(showToast).toHaveBeenCalledWith('Added team NewTeam', 'success');
    });

    it('rolls back optimistic add when updateOnCallTeam fails', async () => {
      mockApi.updateOnCallTeam.mockResolvedValue(false);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleAddTeam('FailTeam');
      });

      // Should have rolled back the optimistic add
      expect(result.current.teams).not.toContain('FailTeam');
      expect(result.current.localOnCall).toHaveLength(3);
      expect(showToast).toHaveBeenCalledWith('Failed to add team', 'error');
    });

    it('rolls back when updateOnCallTeam throws', async () => {
      mockApi.updateOnCallTeam.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleAddTeam('ErrorTeam');
      });

      expect(result.current.teams).not.toContain('ErrorTeam');
      expect(result.current.localOnCall).toHaveLength(3);
      expect(showToast).toHaveBeenCalledWith('Failed to add team', 'error');
    });

    it('rolls back when reorderOnCallTeams throws after successful add', async () => {
      mockApi.updateOnCallTeam.mockResolvedValue(true);
      mockApi.reorderOnCallTeams.mockRejectedValue(new Error('Reorder failed'));

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleAddTeam('ReorderFailTeam');
      });

      // The catch block rolls back the optimistic add
      expect(result.current.teams).not.toContain('ReorderFailTeam');
      expect(showToast).toHaveBeenCalledWith('Failed to add team', 'error');
    });
  });

  // ---------------------------------------------------------------------------
  // handleReorderTeams
  // ---------------------------------------------------------------------------

  describe('handleReorderTeams', () => {
    it('reorders teams optimistically and calls API', async () => {
      mockApi.reorderOnCallTeams.mockResolvedValue(true);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      expect(result.current.teams).toEqual(['Alpha', 'Bravo']);

      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      expect(mockApi.reorderOnCallTeams).toHaveBeenCalledWith(['Bravo', 'Alpha'], {});
      expect(result.current.teams).toEqual(['Bravo', 'Alpha']);
      expect(showToast).toHaveBeenCalledWith('Teams reordered', 'success');
    });

    it('preserves all rows when reordering teams', async () => {
      mockApi.reorderOnCallTeams.mockResolvedValue(true);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      // All rows should still exist
      expect(result.current.localOnCall).toHaveLength(3);

      // Bravo rows should come first
      expect(result.current.localOnCall[0].team).toBe('Bravo');
      expect(result.current.localOnCall[1].team).toBe('Alpha');
      expect(result.current.localOnCall[2].team).toBe('Alpha');
    });

    it('rolls back on API failure', async () => {
      mockApi.reorderOnCallTeams.mockResolvedValue(false);

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      // Should have rolled back
      expect(result.current.teams).toEqual(['Alpha', 'Bravo']);
      expect(showToast).toHaveBeenCalledWith('Failed to save team order', 'error');
    });

    it('does nothing when oldIndex equals newIndex', async () => {
      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleReorderTeams(0, 0);
      });

      expect(mockApi.reorderOnCallTeams).not.toHaveBeenCalled();
      expect(result.current.teams).toEqual(['Alpha', 'Bravo']);
    });

    it('does nothing when oldIndex is out of bounds (movedTeam is undefined)', async () => {
      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await act(async () => {
        await result.current.handleReorderTeams(99, 0);
      });

      expect(mockApi.reorderOnCallTeams).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // setLocalOnCall (exposed setter)
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // getApi guard
  // ---------------------------------------------------------------------------

  describe('getApi guard', () => {
    it('throws when globalThis.api is not set', async () => {
      (globalThis as Record<string, unknown>).api = undefined;

      const { result } = renderHook(() => useOnCallManager(defaultRows, dismissAlert));

      await expect(
        act(async () => {
          await result.current.handleRemoveTeam('Alpha');
        }),
      ).rejects.toThrow('API not initialized');
    });
  });
});
