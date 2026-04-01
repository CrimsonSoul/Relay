import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { NoopToastProvider } from '../../components/Toast';
import type { OnCallRow } from '@shared/ipc';
import type { BoardSettingsState } from '../useAppData';

const mockDismissAlert = vi.fn().mockResolvedValue({ id: 'rec1' });
vi.mock('../../services/oncallDismissalService', () => ({
  dismissAlert: (...args: unknown[]) => mockDismissAlert(...args),
}));

// Mock useCollection to return dismissal records
const mockDismissalRecords: Array<{
  id: string;
  alertType: string;
  dateKey: string;
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
}> = [];
vi.mock('../useCollection', () => ({
  useCollection: (name: string) => {
    if (name === 'oncall_dismissals') {
      return { data: mockDismissalRecords, loading: false, error: null, refetch: vi.fn() };
    }
    return { data: [], loading: false, error: null, refetch: vi.fn() };
  },
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

import { usePersonnel } from '../usePersonnel';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

const makeRow = (team: string, role: string, name: string): OnCallRow => ({
  id: `${team}-${role}-${name}`,
  team,
  teamId: team.toLowerCase().replace(/\s+/g, '-'),
  role,
  name,
  contact: `${name.toLowerCase()}@test.com`,
  timeWindow: '',
});

const makeReadyBoardSettings = (
  teamOrder: string[],
  overrides: Partial<BoardSettingsState> = {},
): BoardSettingsState => ({
  record: null,
  recordId: 'settings-1',
  effectiveTeamOrder: teamOrder,
  effectiveLocked: false,
  status: 'ready',
  errors: [],
  ...overrides,
});

describe('usePersonnel', () => {
  const initialRows: OnCallRow[] = [
    makeRow('Network', 'Primary', 'Alice'),
    makeRow('Network', 'Backup', 'Bob'),
    makeRow('Database', 'Primary', 'Charlie'),
    makeRow('Database', 'Backup', 'Dave'),
  ];

  const defaultBoardSettings = makeReadyBoardSettings(['network', 'database']);

  beforeEach(() => {
    vi.clearAllMocks();
    mockDismissalRecords.length = 0;
  });

  it('initializes with provided on-call rows', () => {
    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    expect(result.current.localOnCall).toEqual(initialRows);
    // teams is now teamId-based
    expect(result.current.teams).toEqual(['network', 'database']);
  });

  it('syncs with external updates when no mutations pending', () => {
    const { result, rerender } = renderHook(({ rows, bs }) => usePersonnel(rows, bs), {
      wrapper,
      initialProps: { rows: initialRows, bs: defaultBoardSettings },
    });

    const updatedRows = [...initialRows, makeRow('Network', 'Tertiary', 'Eve')];
    rerender({ rows: updatedRows, bs: defaultBoardSettings });

    expect(result.current.localOnCall).toEqual(updatedRows);
  });

  it('handles updating team rows optimistically', async () => {
    mockReplaceTeamRecords.mockResolvedValue([]);

    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    const updatedNetworkRows = [
      makeRow('Network', 'Primary', 'Alice'),
      makeRow('Network', 'Backup', 'Eve'),
    ];

    await act(async () => {
      await result.current.handleUpdateRows('Network', updatedNetworkRows);
    });

    const networkRows = result.current.localOnCall.filter((r) => r.team === 'Network');
    expect(networkRows).toHaveLength(2);
    expect(networkRows[1]!.name).toBe('Eve');
  });

  it('preserves team order when updating rows', async () => {
    mockReplaceTeamRecords.mockResolvedValue([]);

    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    const updatedDatabaseRows = [makeRow('Database', 'Primary', 'Frank')];

    await act(async () => {
      await result.current.handleUpdateRows('Database', updatedDatabaseRows);
    });

    const teams = Array.from(new Set(result.current.localOnCall.map((r) => r.team)));
    expect(teams).toEqual(['Network', 'Database']);
  });

  it('handles removing a team', async () => {
    mockDeleteOnCallByTeam.mockResolvedValue(undefined);
    mockUpdatePrimaryBoardSettings.mockResolvedValue({});

    const { result, rerender } = renderHook(({ rows, bs }) => usePersonnel(rows, bs), {
      wrapper,
      initialProps: { rows: initialRows, bs: defaultBoardSettings },
    });

    await act(async () => {
      await result.current.handleRemoveTeam('Database');
    });

    // localOnCall is optimistically updated immediately
    expect(result.current.localOnCall.every((r) => r.team !== 'Database')).toBe(true);

    // Simulate PocketBase realtime propagation: parent re-renders with updated boardSettings
    const updatedBs = makeReadyBoardSettings(['network']);
    rerender({ rows: initialRows.filter((r) => r.team !== 'Database'), bs: updatedBs });

    expect(result.current.teams).toEqual(['network']);
  });

  it('shows error toast on remove team API failure', async () => {
    mockDeleteOnCallByTeam.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleRemoveTeam('Database');
    });

    // Team should still exist since API failed
    expect(result.current.teams).toEqual(['network', 'database']);
  });

  it('handles renaming a team', async () => {
    mockRenameTeam.mockResolvedValue(undefined);

    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleRenameTeam('Database', 'DB Team');
    });

    // teamId stays the same, display name changes
    expect(result.current.teamIdToName.get('database')).toBe('DB Team');
  });

  it('does not rename team on API failure', async () => {
    mockRenameTeam.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleRenameTeam('Database', 'DB Team');
    });

    // Name should be unchanged
    expect(result.current.teamIdToName.get('database')).toBe('Database');
  });

  it('handles adding a new team', async () => {
    mockReplaceTeamRecords.mockResolvedValue([]);
    mockUpdatePrimaryBoardSettings.mockResolvedValue({});

    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleAddTeam('Security');
    });

    expect(result.current.localOnCall.some((r) => r.team === 'Security')).toBe(true);
  });

  it('rolls back add team on API failure', async () => {
    mockReplaceTeamRecords.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleAddTeam('Security');
    });

    expect(result.current.localOnCall.some((r) => r.team === 'Security')).toBe(false);
  });

  it('handles reordering teams', async () => {
    mockUpdatePrimaryBoardSettings.mockResolvedValue({});

    const { result, rerender } = renderHook(({ rows, bs }) => usePersonnel(rows, bs), {
      wrapper,
      initialProps: { rows: initialRows, bs: defaultBoardSettings },
    });

    await act(async () => {
      await result.current.handleReorderTeams(0, 1);
    });

    // Simulate PocketBase realtime propagation: parent re-renders with reordered boardSettings
    const reorderedBs = makeReadyBoardSettings(['database', 'network']);
    rerender({ rows: initialRows, bs: reorderedBs });

    // teams is teamId-based, order should flip
    expect(result.current.teams).toEqual(['database', 'network']);
  });

  it('rolls back reorder on API failure', async () => {
    mockUpdatePrimaryBoardSettings.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleReorderTeams(0, 1);
    });

    // Should rollback to original order
    expect(result.current.localOnCall).toEqual(initialRows);
  });

  it('skips reorder when same index', async () => {
    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleReorderTeams(0, 0);
    });

    expect(mockUpdatePrimaryBoardSettings).not.toHaveBeenCalled();
  });

  it('provides a weekRange string with date range and year', () => {
    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });
    expect(result.current.weekRange).toMatch(/^[A-Za-z]+ \d{1,2} - [A-Za-z]+ \d{1,2}, \d{4}$/);
  });

  it('dismisses alerts optimistically and persists to PB', () => {
    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    act(() => {
      result.current.dismissAlert('general');
    });

    expect(result.current.dismissedAlerts.has('general')).toBe(true);
    expect(mockDismissAlert).toHaveBeenCalledWith(
      'general',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it('handleUpdateRows auto-dismisses general alert on Monday', async () => {
    vi.setSystemTime(new Date(2026, 1, 2, 10, 0, 0)); // Feb 2, 2026 is a Monday
    mockReplaceTeamRecords.mockResolvedValue([]);

    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    await act(async () => {
      await result.current.handleUpdateRows('Network', [makeRow('Network', 'Primary', 'Alice')]);
    });

    expect(result.current.dismissedAlerts.has('general')).toBe(true);
  });

  it('handleUpdateRows rolls back on API failure and toasts', async () => {
    mockReplaceTeamRecords.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    const updatedRows = [makeRow('Network', 'Primary', 'Zara')];

    await act(async () => {
      await result.current.handleUpdateRows('Network', updatedRows);
    });

    const networkRows = result.current.localOnCall.filter((r) => r.team === 'Network');
    expect(networkRows).toHaveLength(2);
    expect(networkRows[0]!.name).toBe('Alice');
    expect(networkRows[1]!.name).toBe('Bob');
  });

  it('dismissedAlerts reflects PB records for today', () => {
    const today = new Date().toISOString().slice(0, 10);
    mockDismissalRecords.push(
      {
        id: 'r1',
        alertType: 'oracle',
        dateKey: today,
        collectionId: '',
        collectionName: 'oncall_dismissals',
        created: '',
        updated: '',
      },
      {
        id: 'r2',
        alertType: 'sql',
        dateKey: '2020-01-01',
        collectionId: '',
        collectionName: 'oncall_dismissals',
        created: '',
        updated: '',
      },
    );

    const { result } = renderHook(() => usePersonnel(initialRows, defaultBoardSettings), {
      wrapper,
    });

    expect(result.current.dismissedAlerts.has('oracle')).toBe(true);
    expect(result.current.dismissedAlerts.has('sql')).toBe(false);
  });
});
