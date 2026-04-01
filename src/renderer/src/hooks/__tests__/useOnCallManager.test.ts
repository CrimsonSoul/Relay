import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOnCallManager } from '../useOnCallManager';
import type { OnCallRow } from '@shared/ipc';
import type { BoardSettingsState } from '../useAppData';

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
vi.mock('../../services/oncallService', () => ({
  replaceTeamRecords: (...args: unknown[]) => mockReplaceTeamRecords(...args),
  deleteOnCallByTeam: (...args: unknown[]) => mockDeleteOnCallByTeam(...args),
  renameTeam: (...args: unknown[]) => mockRenameTeam(...args),
}));

// Mock board settings service
const mockUpdatePrimaryBoardSettings = vi.fn();
vi.mock('../../services/oncallBoardSettingsService', () => ({
  updatePrimaryBoardSettings: (...args: unknown[]) => mockUpdatePrimaryBoardSettings(...args),
}));

const makeRow = (overrides: Partial<OnCallRow> = {}): OnCallRow => ({
  id: 'r1',
  team: 'Alpha',
  teamId: 'alpha',
  role: 'Primary',
  name: 'Alice',
  contact: 'alice@test.com',
  timeWindow: '9-5',
  ...overrides,
});

const makeReadyBoardSettings = (
  overrides: Partial<BoardSettingsState> = {},
): BoardSettingsState => ({
  record: null,
  recordId: 'settings-1',
  effectiveTeamOrder: ['alpha', 'bravo'],
  effectiveLocked: false,
  status: 'ready',
  errors: [],
  ...overrides,
});

describe('useOnCallManager', () => {
  const dismissAlert = vi.fn();

  const defaultRows: OnCallRow[] = [
    makeRow({ id: 'r1', team: 'Alpha', teamId: 'alpha', name: 'Alice' }),
    makeRow({ id: 'r2', team: 'Alpha', teamId: 'alpha', role: 'Secondary', name: 'Bob' }),
    makeRow({ id: 'r3', team: 'Bravo', teamId: 'bravo', name: 'Charlie' }),
  ];

  const defaultBoardSettings = makeReadyBoardSettings();

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
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );
      expect(result.current.localOnCall).toEqual(defaultRows);
    });

    it('derives teams from boardSettings.effectiveTeamOrder when ready', () => {
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );
      expect(result.current.teams).toEqual(['alpha', 'bravo']);
    });

    it('falls back to row-derived teamIds when board settings not ready', () => {
      const loadingSettings = makeReadyBoardSettings({
        status: 'loading',
        effectiveTeamOrder: [],
      });
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, loadingSettings),
      );
      expect(result.current.teams).toEqual(['alpha', 'bravo']);
    });

    it('provides teamIdToName mapping', () => {
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );
      expect(result.current.teamIdToName.get('alpha')).toBe('Alpha');
      expect(result.current.teamIdToName.get('bravo')).toBe('Bravo');
    });

    it('returns a weekRange string', () => {
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );
      expect(typeof result.current.weekRange).toBe('string');
      expect(result.current.weekRange.length).toBeGreaterThan(0);
    });

    it('handles empty onCall array', () => {
      const emptySettings = makeReadyBoardSettings({ effectiveTeamOrder: [] });
      const { result } = renderHook(() => useOnCallManager([], dismissAlert, emptySettings));
      expect(result.current.localOnCall).toEqual([]);
      expect(result.current.teams).toEqual([]);
    });
  });

  describe('external sync', () => {
    it('syncs localOnCall when the onCall prop changes and no mutations are in-flight', () => {
      const { result, rerender } = renderHook(
        ({ onCall, bs }) => useOnCallManager(onCall, dismissAlert, bs),
        { initialProps: { onCall: defaultRows, bs: defaultBoardSettings } },
      );

      expect(result.current.localOnCall).toEqual(defaultRows);

      const updatedRows = [makeRow({ id: 'r4', team: 'Delta', teamId: 'delta', name: 'Dave' })];
      const updatedSettings = makeReadyBoardSettings({ effectiveTeamOrder: ['delta'] });
      rerender({ onCall: updatedRows, bs: updatedSettings });

      expect(result.current.localOnCall).toEqual(updatedRows);
    });
  });

  describe('weekRange interval', () => {
    it('updates weekRange periodically', () => {
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      const initialWeekRange = result.current.weekRange;
      expect(typeof initialWeekRange).toBe('string');

      act(() => {
        vi.advanceTimersByTime(60000);
      });

      expect(typeof result.current.weekRange).toBe('string');
    });

    it('cleans up interval on unmount', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

      const { unmount } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );
      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });

  describe('handleUpdateRows', () => {
    it('optimistically updates local state with new rows for existing team', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

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

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

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

      const rows = [
        makeRow({ id: 'r1', team: 'First Responder', teamId: 'first responder', name: 'Alice' }),
      ];
      const bs = makeReadyBoardSettings({ effectiveTeamOrder: ['first responder'] });
      const { result } = renderHook(() => useOnCallManager(rows, dismissAlert, bs));

      await act(async () => {
        await result.current.handleUpdateRows('First Responder', rows);
      });

      expect(dismissAlert).toHaveBeenCalledWith('first-responder');
    });

    it('dismisses general alert on Monday', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      vi.setSystemTime(new Date(2026, 2, 2)); // 2026-03-02 is a Monday

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleUpdateRows('Alpha', [defaultRows[0]]);
      });

      expect(dismissAlert).toHaveBeenCalledWith('general');
    });

    it('dismisses sql alert on Wednesday for SQL team', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      vi.setSystemTime(new Date(2026, 2, 4)); // 2026-03-04 is a Wednesday

      const sqlRows = [
        makeRow({ id: 'r10', team: 'SQL Support', teamId: 'sql support', name: 'Dave' }),
      ];
      const bs = makeReadyBoardSettings({ effectiveTeamOrder: ['sql support'] });
      const { result } = renderHook(() => useOnCallManager(sqlRows, dismissAlert, bs));

      await act(async () => {
        await result.current.handleUpdateRows('SQL Support', sqlRows);
      });

      expect(dismissAlert).toHaveBeenCalledWith('sql');
    });

    it('dismisses oracle alert on Thursday for Oracle team', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      vi.setSystemTime(new Date(2026, 2, 5)); // 2026-03-05 is a Thursday

      const oracleRows = [
        makeRow({ id: 'r11', team: 'Oracle DBA', teamId: 'oracle dba', name: 'Eve' }),
      ];
      const bs = makeReadyBoardSettings({ effectiveTeamOrder: ['oracle dba'] });
      const { result } = renderHook(() => useOnCallManager(oracleRows, dismissAlert, bs));

      await act(async () => {
        await result.current.handleUpdateRows('Oracle DBA', oracleRows);
      });

      expect(dismissAlert).toHaveBeenCalledWith('oracle');
    });

    it('does not dismiss any alert when conditions do not match', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      vi.setSystemTime(new Date(2026, 2, 3)); // 2026-03-03 is a Tuesday

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleUpdateRows('Alpha', [defaultRows[0]]);
      });

      expect(dismissAlert).not.toHaveBeenCalled();
    });
  });

  describe('handleRemoveTeam', () => {
    it('removes team from local state on success', async () => {
      mockDeleteOnCallByTeam.mockResolvedValue(undefined);
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleRemoveTeam('Alpha');
      });

      expect(mockDeleteOnCallByTeam).toHaveBeenCalledWith('Alpha');
      expect(result.current.localOnCall).toEqual([defaultRows[2]]);
      expect(showToast).toHaveBeenCalledWith('Removed Alpha', 'success');
    });

    it('updates board settings teamOrder when removing a team', async () => {
      mockDeleteOnCallByTeam.mockResolvedValue(undefined);
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleRemoveTeam('Alpha');
      });

      expect(mockUpdatePrimaryBoardSettings).toHaveBeenCalledWith('settings-1', {
        teamOrder: ['bravo'],
      });
    });

    it('does not remove team on API failure and shows error toast', async () => {
      mockDeleteOnCallByTeam.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

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

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleRenameTeam('Alpha', 'AlphaRenamed');
      });

      expect(mockRenameTeam).toHaveBeenCalledWith('Alpha', 'AlphaRenamed');

      const renamedRows = result.current.localOnCall.filter((r) => r.team === 'AlphaRenamed');
      expect(renamedRows).toHaveLength(2);
      expect(result.current.localOnCall.filter((r) => r.team === 'Alpha')).toHaveLength(0);
      expect(showToast).toHaveBeenCalledWith('Renamed Alpha to AlphaRenamed', 'success');
    });

    it('does not rename on API failure and shows error toast', async () => {
      mockRenameTeam.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleRenameTeam('Alpha', 'AlphaRenamed');
      });

      // Team names should be unchanged
      const alphaRows = result.current.localOnCall.filter((r) => r.team === 'Alpha');
      expect(alphaRows).toHaveLength(2);
      expect(showToast).toHaveBeenCalledWith('Failed to rename team', 'error');
    });
  });

  describe('handleAddTeam', () => {
    it('adds a new team optimistically and calls API', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleAddTeam('NewTeam');
      });

      expect(mockReplaceTeamRecords).toHaveBeenCalled();
      // Should update board settings to append the new teamId
      expect(mockUpdatePrimaryBoardSettings).toHaveBeenCalledWith('settings-1', {
        teamOrder: ['alpha', 'bravo', 'newteam'],
      });

      expect(result.current.localOnCall.some((r) => r.team === 'NewTeam')).toBe(true);
      expect(showToast).toHaveBeenCalledWith('Added team NewTeam', 'success');
    });

    it('rolls back optimistic add when replaceTeamRecords fails', async () => {
      mockReplaceTeamRecords.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleAddTeam('FailTeam');
      });

      expect(result.current.localOnCall.some((r) => r.team === 'FailTeam')).toBe(false);
      expect(result.current.localOnCall).toHaveLength(3);
      expect(showToast).toHaveBeenCalledWith('Failed to add team', 'error');
    });

    it('rolls back when updatePrimaryBoardSettings throws after successful add', async () => {
      mockReplaceTeamRecords.mockResolvedValue([]);
      mockUpdatePrimaryBoardSettings.mockRejectedValue(new Error('Settings failed'));

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleAddTeam('ReorderFailTeam');
      });

      expect(result.current.localOnCall.some((r) => r.team === 'ReorderFailTeam')).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Failed to add team', 'error');
    });
  });

  describe('handleReorderTeams', () => {
    it('reorders teams via updatePrimaryBoardSettings, not pbReorderTeams', async () => {
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      expect(result.current.teams).toEqual(['alpha', 'bravo']);

      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      expect(mockUpdatePrimaryBoardSettings).toHaveBeenCalledWith('settings-1', {
        teamOrder: ['bravo', 'alpha'],
      });
      expect(showToast).toHaveBeenCalledWith('Teams reordered', 'success');
    });

    it('preserves member order inside each card during reorder', async () => {
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});

      const rows: OnCallRow[] = [
        makeRow({ id: 'a1', team: 'Alpha', teamId: 'alpha', name: 'Alice', role: 'Primary' }),
        makeRow({ id: 'a2', team: 'Alpha', teamId: 'alpha', name: 'Bob', role: 'Secondary' }),
        makeRow({ id: 'a3', team: 'Alpha', teamId: 'alpha', name: 'Carol', role: 'Tertiary' }),
        makeRow({ id: 'b1', team: 'Bravo', teamId: 'bravo', name: 'Dave', role: 'Primary' }),
        makeRow({ id: 'b2', team: 'Bravo', teamId: 'bravo', name: 'Eve', role: 'Secondary' }),
      ];

      const { result } = renderHook(() =>
        useOnCallManager(rows, dismissAlert, defaultBoardSettings),
      );

      // Reorder: move Alpha (index 0) to after Bravo (index 1)
      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      // Bravo should be first now, Alpha second
      const bravoRows = result.current.localOnCall.filter((r) => r.teamId === 'bravo');
      const alphaRows = result.current.localOnCall.filter((r) => r.teamId === 'alpha');

      // Member order inside each card must be preserved
      expect(bravoRows.map((r) => r.name)).toEqual(['Dave', 'Eve']);
      expect(alphaRows.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Carol']);

      // Bravo rows should come before Alpha rows in the flat list
      const bravoFirstIdx = result.current.localOnCall.findIndex((r) => r.teamId === 'bravo');
      const alphaFirstIdx = result.current.localOnCall.findIndex((r) => r.teamId === 'alpha');
      expect(bravoFirstIdx).toBeLessThan(alphaFirstIdx);
    });

    it('rolls back on API failure', async () => {
      mockUpdatePrimaryBoardSettings.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      // Should rollback — order should be original
      expect(result.current.localOnCall).toEqual(defaultRows);
      expect(showToast).toHaveBeenCalledWith('Failed to save team order', 'error');
    });

    it('does nothing when oldIndex equals newIndex', async () => {
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleReorderTeams(0, 0);
      });

      expect(mockUpdatePrimaryBoardSettings).not.toHaveBeenCalled();
      expect(result.current.teams).toEqual(['alpha', 'bravo']);
    });

    it('does nothing when oldIndex is out of bounds', async () => {
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleReorderTeams(99, 0);
      });

      expect(mockUpdatePrimaryBoardSettings).not.toHaveBeenCalled();
    });

    it('shows error when board settings not ready', async () => {
      const loadingSettings = makeReadyBoardSettings({
        status: 'loading',
        effectiveTeamOrder: [],
      });

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, loadingSettings),
      );

      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      expect(mockUpdatePrimaryBoardSettings).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith('Board settings not ready', 'error');
    });
  });

  describe('board lock', () => {
    it('toggleBoardLock calls updatePrimaryBoardSettings to flip lock state', async () => {
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.toggleBoardLock();
      });

      // Default is unlocked (false), so toggle should set to true
      expect(mockUpdatePrimaryBoardSettings).toHaveBeenCalledWith('settings-1', {
        locked: true,
      });
    });

    it('toggleBoardLock is a no-op when board settings not ready', async () => {
      const loadingSettings = makeReadyBoardSettings({
        status: 'loading',
        recordId: null,
      });

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, loadingSettings),
      );

      await act(async () => {
        await result.current.toggleBoardLock();
      });

      expect(mockUpdatePrimaryBoardSettings).not.toHaveBeenCalled();
    });

    it('shows error toast when toggleBoardLock fails', async () => {
      mockUpdatePrimaryBoardSettings.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.toggleBoardLock();
      });

      expect(showToast).toHaveBeenCalledWith('Failed to toggle board lock', 'error');
    });
  });

  describe('setLocalOnCall', () => {
    it('allows direct state updates via the exposed setter', () => {
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      const newRows = [makeRow({ id: 'r99', team: 'Direct', teamId: 'direct', name: 'Zara' })];

      act(() => {
        result.current.setLocalOnCall(newRows);
      });

      expect(result.current.localOnCall).toEqual(newRows);
    });
  });
});
