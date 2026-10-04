import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOnCallManager } from '../useOnCallManager';
import type { OnCallRow } from '@shared/ipc';
import type { BoardSettingsState } from '../useAppData';
import type { ToastOptions } from '../../components/Toast';

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
let mockPersistence: 'server' | 'queued' = 'server';
const mockDeleteOnCallByTeam = vi.fn();
const mockRenameTeam = vi.fn();
vi.mock('../../services/oncallService', () => ({
  replaceTeamRecords: (...args: unknown[]) => mockReplaceTeamRecords(...args),
  replaceTeamRecordsWithOutcome: async (...args: unknown[]) => ({
    records: await mockReplaceTeamRecords(...args),
    persistence: mockPersistence,
  }),
  deleteOnCallByTeam: (...args: unknown[]) => mockDeleteOnCallByTeam(...args),
  renameTeam: (...args: unknown[]) => mockRenameTeam(...args),
}));

// Mock board settings service
const mockUpdatePrimaryBoardSettings = vi.fn();
const mockEnsurePrimaryBoardSettings = vi.fn();
vi.mock('../../services/oncallBoardSettingsService', () => ({
  updatePrimaryBoardSettings: (...args: unknown[]) => mockUpdatePrimaryBoardSettings(...args),
  ensurePrimaryBoardSettings: (...args: unknown[]) => mockEnsurePrimaryBoardSettings(...args),
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

  const alphaPrimaryRow = makeRow({ id: 'r1', team: 'Alpha', teamId: 'alpha', name: 'Alice' });

  const defaultRows: OnCallRow[] = [
    alphaPrimaryRow,
    makeRow({ id: 'r2', team: 'Alpha', teamId: 'alpha', role: 'Secondary', name: 'Bob' }),
    makeRow({ id: 'r3', team: 'Bravo', teamId: 'bravo', name: 'Charlie' }),
  ];

  const defaultBoardSettings = makeReadyBoardSettings();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersistence = 'server';
    vi.useFakeTimers();
    vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps reminder active for queued changes and retains the saved timestamp', async () => {
    vi.setSystemTime(new Date(2026, 2, 2));
    mockPersistence = 'queued';
    mockReplaceTeamRecords.mockResolvedValueOnce([
      { ...alphaPrimaryRow, updated: '2026-03-01T00:00:00Z', queuedAt: '2026-03-02T00:00:00Z' },
    ]);
    const { result } = renderHook(() =>
      useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
    );
    await act(async () => {
      await result.current.handleUpdateRows('Alpha', [alphaPrimaryRow]);
    });
    expect(dismissAlert).not.toHaveBeenCalled();
    expect(result.current.localOnCall[0]).toMatchObject({
      updatedAt: Date.parse('2026-03-01T00:00:00Z'),
      queuedAt: '2026-03-02T00:00:00Z',
    });
  });
  it('uses the saved timestamp after successful persistence', async () => {
    mockReplaceTeamRecords.mockResolvedValueOnce([
      { ...alphaPrimaryRow, updated: '2026-03-05T00:00:00Z' },
    ]);
    const { result } = renderHook(() =>
      useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
    );
    await act(async () => {
      await result.current.handleUpdateRows('Alpha', [alphaPrimaryRow]);
    });
    expect(result.current.localOnCall[0]?.updatedAt).toBe(Date.parse('2026-03-05T00:00:00Z'));
  });

  it('keeps the reminder active when a save fails', async () => {
    vi.setSystemTime(new Date(2026, 2, 2));
    mockReplaceTeamRecords.mockRejectedValueOnce(new Error('partial failure'));
    const { result } = renderHook(() =>
      useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
    );
    await act(async () => {
      await expect(result.current.handleUpdateRows('Alpha', [alphaPrimaryRow])).rejects.toThrow(
        'partial failure',
      );
    });
    expect(dismissAlert).not.toHaveBeenCalled();
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

    it('replaces temporary row ids with saved PocketBase row ids after adding rows', async () => {
      mockReplaceTeamRecords.mockResolvedValue([
        makeRow({ id: 'r1', team: 'Alpha', teamId: 'alpha', name: 'Alice Updated' }),
        makeRow({ id: 'pb-created-row', team: 'Alpha', teamId: 'alpha', role: 'Backup' }),
      ]);

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.handleUpdateRows('Alpha', [
          makeRow({ id: 'r1', team: 'Alpha', teamId: 'alpha', name: 'Alice Updated' }),
          makeRow({ id: 'temporary-row-id', team: 'Alpha', teamId: 'alpha', role: 'Backup' }),
        ]);
      });

      const alphaRows = result.current.localOnCall.filter((r) => r.teamId === 'alpha');
      expect(alphaRows.map((r) => r.id)).toEqual(['r1', 'pb-created-row']);
    });

    it('rolls back to previous state when API throws', async () => {
      mockReplaceTeamRecords.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await expect(
          result.current.handleUpdateRows('Alpha', [
            makeRow({ id: 'r1', team: 'Alpha', name: 'Alice Updated' }),
          ]),
        ).rejects.toThrow('Failed');
      });

      expect(result.current.localOnCall).toEqual(defaultRows);
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't save Alpha. Failed. The board shows the last saved coverage. Your edits are still in the editor; save again.",
        'error',
      );
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
        await result.current.handleUpdateRows('Alpha', [alphaPrimaryRow]);
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
        await result.current.handleUpdateRows('Alpha', [alphaPrimaryRow]);
      });

      expect(dismissAlert).not.toHaveBeenCalled();
    });
  });

  describe('handleRemoveTeam', () => {
    type ToastCall = [string, string, ToastOptions | undefined];
    const toastCalls = () => showToast.mock.calls as ToastCall[];

    const removalToast = () => {
      const call = toastCalls().find(([message]) => message.startsWith('Removed '));
      if (!call) throw new Error('Expected a "Removed …" notice');
      return { message: call[0], type: call[1], options: call[2] ?? {} };
    };

    /** Commits chain several awaits; flush them inside act. */
    const flush = async () => {
      await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });
    };

    const closeUndoWindow = async () => {
      act(() => removalToast().options.onDismiss?.());
      await flush();
    };

    it('hides the card at once and writes nothing while Undo is offered', () => {
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      act(() => result.current.handleRemoveTeam('Alpha'));

      expect(result.current.teams).toEqual(['bravo']);
      expect(result.current.localOnCall).toEqual([defaultRows[2]]);
      expect(mockDeleteOnCallByTeam).not.toHaveBeenCalled();
      const toast = removalToast();
      expect(toast.message).toBe('Removed Alpha (2 members)');
      expect(toast.type).toBe('info');
      expect(toast.options.action?.label).toBe('Undo');
    });

    it('commits the removal and its board order when the notice leaves', async () => {
      mockDeleteOnCallByTeam.mockResolvedValue(undefined);
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      act(() => result.current.handleRemoveTeam('Alpha'));
      await closeUndoWindow();

      expect(mockDeleteOnCallByTeam).toHaveBeenCalledWith('Alpha');
      expect(mockUpdatePrimaryBoardSettings).toHaveBeenCalledWith('settings-1', {
        teamOrder: ['bravo'],
      });
      expect(result.current.localOnCall).toEqual([defaultRows[2]]);
    });

    it('Undo inside the window brings the card back in place without writing', () => {
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      act(() => result.current.handleRemoveTeam('Alpha'));
      act(() => removalToast().options.action?.onClick());

      expect(result.current.teams).toEqual(['alpha', 'bravo']);
      expect(result.current.localOnCall).toEqual(defaultRows);
      expect(mockDeleteOnCallByTeam).not.toHaveBeenCalled();
      expect(mockUpdatePrimaryBoardSettings).not.toHaveBeenCalled();
    });

    it('locally removes the team from board settings after the removal commits', async () => {
      mockDeleteOnCallByTeam.mockResolvedValue(undefined);
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});
      const onBoardSettingsChange = vi.fn();
      const boardSettings = makeReadyBoardSettings({
        record: {
          id: 'settings-1',
          key: 'primary',
          teamOrder: ['alpha', 'bravo'],
          locked: false,
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-01T00:00:00Z',
        },
      });

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, boardSettings, onBoardSettingsChange),
      );

      act(() => result.current.handleRemoveTeam('Alpha'));
      await closeUndoWindow();

      expect(onBoardSettingsChange).toHaveBeenCalledOnce();

      const applyUpdate = onBoardSettingsChange.mock.calls[0]?.[0] as (
        prev: BoardSettingsState,
      ) => BoardSettingsState;
      const updatedState = applyUpdate(boardSettings);
      expect(updatedState.effectiveTeamOrder).toEqual(['bravo']);
      expect(updatedState.record?.teamOrder).toEqual(['bravo']);
    });

    it('brings the card back and says why, with Retry, when the delete fails', async () => {
      mockDeleteOnCallByTeam.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      act(() => result.current.handleRemoveTeam('Alpha'));
      await closeUndoWindow();

      expect(result.current.teams).toEqual(['alpha', 'bravo']);
      expect(result.current.localOnCall).toEqual(defaultRows);
      const failure = toastCalls().find(([, type]) => type === 'error');
      expect(failure?.[0]).toBe(
        "Couldn't remove Alpha. Failed. The team is back on the board. Try again.",
      );
      expect(failure?.[2]?.action?.label).toBe('Retry');
    });

    it('re-creates the team in its old slot when Undo arrives after the tab closed', async () => {
      mockDeleteOnCallByTeam.mockResolvedValue(undefined);
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});
      mockReplaceTeamRecords.mockResolvedValue([]);

      const { result, unmount } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      act(() => result.current.handleRemoveTeam('Alpha'));
      unmount();
      await flush();
      expect(mockDeleteOnCallByTeam).toHaveBeenCalledWith('Alpha');

      act(() => removalToast().options.action?.onClick());
      await flush();

      expect(mockReplaceTeamRecords).toHaveBeenCalledWith('Alpha', [
        expect.objectContaining({ teamId: 'alpha', name: 'Alice', sortOrder: 0 }),
        expect.objectContaining({ teamId: 'alpha', name: 'Bob', sortOrder: 1 }),
      ]);
      expect(mockUpdatePrimaryBoardSettings).toHaveBeenLastCalledWith('settings-1', {
        teamOrder: ['alpha', 'bravo'],
      });
      expect(showToast).toHaveBeenCalledWith('Restored Alpha (2 members)', 'success');
    });

    it('brings an empty card back when the members were removed but the board order was not', async () => {
      mockDeleteOnCallByTeam.mockResolvedValue(undefined);
      mockUpdatePrimaryBoardSettings.mockRejectedValue(new Error('Settings failed'));

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      act(() => result.current.handleRemoveTeam('Alpha'));
      await closeUndoWindow();

      expect(result.current.teams).toEqual(['alpha', 'bravo']);
      expect(showToast).toHaveBeenCalledWith(
        "Removed the members of Alpha but couldn't update the board order. Settings failed. Its empty card is back on the board. Remove it again.",
        'error',
      );
    });

    it('maps a reorder made while a card is hidden onto the full saved order', async () => {
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});
      const rows = [
        ...defaultRows,
        makeRow({ id: 'r4', team: 'Charlie', teamId: 'charlie', name: 'Dana' }),
      ];
      const boardSettings = makeReadyBoardSettings({
        effectiveTeamOrder: ['alpha', 'bravo', 'charlie'],
      });

      const { result } = renderHook(() => useOnCallManager(rows, dismissAlert, boardSettings));

      act(() => result.current.handleRemoveTeam('Bravo'));
      expect(result.current.teams).toEqual(['alpha', 'charlie']);

      // Visible indices: drag Alpha (0) after Charlie (1); hidden Bravo keeps its saved slot.
      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      expect(mockUpdatePrimaryBoardSettings).toHaveBeenCalledWith('settings-1', {
        teamOrder: ['bravo', 'charlie', 'alpha'],
      });
      expect(showToast).toHaveBeenCalledWith('Moved Alpha to position 2 of 2', 'success');
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

    it('frees the old name for reuse and migrates its board order entry', async () => {
      mockRenameTeam.mockResolvedValue(undefined);
      mockReplaceTeamRecords.mockResolvedValue([]);
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});
      const rows = [makeRow({ id: 'r1', team: 'SQL', teamId: 'sql' })];
      const boardSettings = makeReadyBoardSettings({ effectiveTeamOrder: ['sql', 'bravo'] });

      const { result } = renderHook(() => useOnCallManager(rows, dismissAlert, boardSettings));

      await act(async () => {
        await result.current.handleRenameTeam('SQL', 'Oracle');
      });

      expect(result.current.localOnCall.every((r) => r.teamId === 'oracle')).toBe(true);
      expect(mockUpdatePrimaryBoardSettings).toHaveBeenCalledWith('settings-1', {
        teamOrder: ['oracle', 'bravo'],
      });

      // The renamed card no longer claims "SQL", so the name can be added back.
      let addResult: unknown;
      await act(async () => {
        addResult = await result.current.handleAddTeam('SQL');
      });

      expect(addResult).toEqual({ ok: true });
      expect(mockReplaceTeamRecords).toHaveBeenCalledWith('SQL', [
        { teamId: 'sql', role: 'Primary', name: '', contact: '', timeWindow: '', sortOrder: 0 },
      ]);
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
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't rename Alpha. Failed. It still shows as Alpha. Try again.",
        'error',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Retry' }) }),
      );
    });
  });

  describe('handleAddTeam', () => {
    it('adds a new team in a web client without randomUUID', async () => {
      vi.stubGlobal('crypto', {
        getRandomValues: (bytes: Uint8Array) => bytes.fill(13),
      });
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

    it('does not call replaceTeamRecords when the normalized team already exists', async () => {
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      let addResult: unknown;
      await act(async () => {
        addResult = await result.current.handleAddTeam(' alpha ');
      });

      expect(mockReplaceTeamRecords).not.toHaveBeenCalled();
      expect(mockUpdatePrimaryBoardSettings).not.toHaveBeenCalled();
      expect(result.current.localOnCall).toEqual(defaultRows);
      // The duplicate is reported to the caller for an inline error, not toasted.
      expect(addResult).toEqual({ ok: false, error: 'A team named "alpha" already exists' });
      expect(showToast).not.toHaveBeenCalled();
    });

    it('does not add a blank team', async () => {
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      let addResult: unknown;
      await act(async () => {
        addResult = await result.current.handleAddTeam('   ');
      });

      expect(mockReplaceTeamRecords).not.toHaveBeenCalled();
      expect(result.current.localOnCall).toEqual(defaultRows);
      expect(addResult).toEqual({ ok: false, error: 'Enter a team name' });
    });

    it('locally appends the new team to board settings after adding a team', async () => {
      mockReplaceTeamRecords.mockResolvedValue([
        makeRow({ id: 'pb-new-team-row', team: 'NewTeam', teamId: 'newteam' }),
      ]);
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});
      const onBoardSettingsChange = vi.fn();

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings, onBoardSettingsChange),
      );

      await act(async () => {
        await result.current.handleAddTeam('NewTeam');
      });

      expect(onBoardSettingsChange).toHaveBeenCalledOnce();

      const applyUpdate = onBoardSettingsChange.mock.calls[0]?.[0] as (
        prev: BoardSettingsState,
      ) => BoardSettingsState;
      const updatedState = applyUpdate(defaultBoardSettings);
      expect(updatedState.effectiveTeamOrder).toEqual(['alpha', 'bravo', 'newteam']);
      expect(result.current.localOnCall.some((r) => r.id === 'pb-new-team-row')).toBe(true);
      expect(result.current.localOnCall.some((r) => r.id === 'test-uuid-1234')).toBe(false);
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
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't add FailTeam. Failed. Nothing was added. Try again.",
        'error',
      );
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
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't add ReorderFailTeam. Settings failed. Nothing was added. Try again.",
        'error',
      );
    });

    it('repairs non-ready board settings when adding a team', async () => {
      mockReplaceTeamRecords.mockResolvedValue([
        makeRow({ id: 'pb-new-team-row', team: 'NewTeam', teamId: 'newteam' }),
      ]);
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});
      const onBoardSettingsChange = vi.fn();
      const invalidSettings = makeReadyBoardSettings({
        status: 'invalid',
        errors: ['Team order needs repair'],
      });

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, invalidSettings, onBoardSettingsChange),
      );

      await act(async () => {
        await result.current.handleAddTeam('NewTeam');
      });

      expect(mockUpdatePrimaryBoardSettings).toHaveBeenCalledWith('settings-1', {
        teamOrder: ['alpha', 'bravo', 'newteam'],
      });
      const applyUpdate = onBoardSettingsChange.mock.calls[0]?.[0] as (
        prev: BoardSettingsState,
      ) => BoardSettingsState;
      const updatedState = applyUpdate(invalidSettings);
      expect(updatedState.status).toBe('ready');
      expect(updatedState.errors).toEqual([]);
      expect(updatedState.effectiveTeamOrder).toEqual(['alpha', 'bravo', 'newteam']);
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
      expect(showToast).toHaveBeenCalledWith('Moved Alpha to position 2 of 2', 'success');
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
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't save team order. Failed. The board is back in its previous order. Drag the card again to retry.",
        'error',
      );
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

    it('does not reorder when the board is locked', async () => {
      const lockedSettings = makeReadyBoardSettings({ effectiveLocked: true });
      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, lockedSettings),
      );

      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      expect(mockUpdatePrimaryBoardSettings).not.toHaveBeenCalled();
      expect(result.current.localOnCall).toEqual(defaultRows);
      expect(showToast).toHaveBeenCalledWith('Unlock team order to reorder teams', 'info');
    });

    it('shows error when board settings repair fails', async () => {
      mockEnsurePrimaryBoardSettings.mockRejectedValue(new Error('settings unavailable'));
      const loadingSettings = makeReadyBoardSettings({
        status: 'loading',
        recordId: null,
        effectiveTeamOrder: [],
      });

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, loadingSettings),
      );

      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      expect(mockUpdatePrimaryBoardSettings).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't save team order. Settings unavailable. The board is back in its previous order. Drag the card again to retry.",
        'error',
      );
    });

    it('repairs non-ready board settings when reordering teams', async () => {
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});
      const onBoardSettingsChange = vi.fn();
      const invalidSettings = makeReadyBoardSettings({
        status: 'invalid',
        errors: ['Team order needs repair'],
      });

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, invalidSettings, onBoardSettingsChange),
      );

      await act(async () => {
        await result.current.handleReorderTeams(0, 1);
      });

      expect(mockUpdatePrimaryBoardSettings).toHaveBeenCalledWith('settings-1', {
        teamOrder: ['bravo', 'alpha'],
      });
      const applyUpdate = onBoardSettingsChange.mock.calls[0]?.[0] as (
        prev: BoardSettingsState,
      ) => BoardSettingsState;
      const updatedState = applyUpdate(invalidSettings);
      expect(updatedState.status).toBe('ready');
      expect(updatedState.errors).toEqual([]);
      expect(updatedState.effectiveTeamOrder).toEqual(['bravo', 'alpha']);
      expect(showToast).toHaveBeenCalledWith('Moved Alpha to position 2 of 2', 'success');
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

    it('toggleBoardLock locally reflects unlock when the board starts locked', async () => {
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});
      const onBoardSettingsChange = vi.fn();
      const lockedSettings = makeReadyBoardSettings({ effectiveLocked: true });

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, lockedSettings, onBoardSettingsChange),
      );

      await act(async () => {
        await result.current.toggleBoardLock();
      });

      expect(mockUpdatePrimaryBoardSettings).toHaveBeenCalledWith('settings-1', {
        locked: false,
      });
      expect(onBoardSettingsChange).toHaveBeenCalledOnce();

      const applyUpdate = onBoardSettingsChange.mock.calls[0]?.[0] as (
        prev: BoardSettingsState,
      ) => BoardSettingsState;
      const updatedState = applyUpdate(lockedSettings);
      expect(updatedState.effectiveLocked).toBe(false);
    });

    it('toggleBoardLock can update lock state when a settings record exists but board status is not ready', async () => {
      mockUpdatePrimaryBoardSettings.mockResolvedValue({});
      const onBoardSettingsChange = vi.fn();
      const invalidSettings = makeReadyBoardSettings({
        status: 'invalid',
        errors: ['Team order needs repair'],
      });

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, invalidSettings, onBoardSettingsChange),
      );

      await act(async () => {
        await result.current.toggleBoardLock();
      });

      expect(mockUpdatePrimaryBoardSettings).toHaveBeenCalledWith('settings-1', {
        teamOrder: ['alpha', 'bravo'],
        locked: true,
      });
      const applyUpdate = onBoardSettingsChange.mock.calls[0]?.[0] as (
        prev: BoardSettingsState,
      ) => BoardSettingsState;
      const updatedState = applyUpdate(invalidSettings);
      expect(updatedState.status).toBe('ready');
      expect(updatedState.errors).toEqual([]);
    });

    it('toggleBoardLock repairs missing board settings before toggling lock state', async () => {
      mockEnsurePrimaryBoardSettings.mockResolvedValue({
        id: 'settings-1',
        key: 'primary',
        teamOrder: ['alpha', 'bravo'],
        locked: true,
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-01T00:00:00Z',
      });
      mockUpdatePrimaryBoardSettings.mockResolvedValue({
        id: 'settings-1',
        key: 'primary',
        teamOrder: ['alpha', 'bravo'],
        locked: false,
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-01T00:01:00Z',
      });
      const onBoardSettingsChange = vi.fn();
      const loadingSettings = makeReadyBoardSettings({
        status: 'loading',
        recordId: null,
        record: null,
        effectiveLocked: true,
        effectiveTeamOrder: [],
      });

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, loadingSettings, onBoardSettingsChange),
      );

      await act(async () => {
        await result.current.toggleBoardLock();
      });

      expect(mockEnsurePrimaryBoardSettings).toHaveBeenCalledWith(['alpha', 'bravo']);
      expect(mockUpdatePrimaryBoardSettings).toHaveBeenCalledWith('settings-1', {
        locked: false,
      });
      expect(onBoardSettingsChange).toHaveBeenCalledOnce();

      const applyUpdate = onBoardSettingsChange.mock.calls[0]?.[0] as (
        prev: BoardSettingsState,
      ) => BoardSettingsState;
      const updatedState = applyUpdate(loadingSettings);
      expect(updatedState.recordId).toBe('settings-1');
      expect(updatedState.record?.id).toBe('settings-1');
      expect(updatedState.status).toBe('ready');
      expect(updatedState.errors).toEqual([]);
      expect(updatedState.effectiveLocked).toBe(false);
      expect(updatedState.effectiveTeamOrder).toEqual(['alpha', 'bravo']);
    });

    it('shows error toast when toggleBoardLock fails', async () => {
      mockUpdatePrimaryBoardSettings.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() =>
        useOnCallManager(defaultRows, dismissAlert, defaultBoardSettings),
      );

      await act(async () => {
        await result.current.toggleBoardLock();
      });

      expect(showToast).toHaveBeenCalledWith(
        expect.stringMatching(/^Couldn't (lock|unlock) team order\. Failed\. Team order is still/),
        'error',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Retry' }) }),
      );
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
