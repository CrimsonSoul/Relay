import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { NoopToastProvider } from '../../components/Toast';
import type { OnCallRow } from '@shared/ipc';

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
const mockReorderTeams = vi.fn();
vi.mock('../../services/oncallService', () => ({
  replaceTeamRecords: (...args: unknown[]) => mockReplaceTeamRecords(...args),
  deleteOnCallByTeam: (...args: unknown[]) => mockDeleteOnCallByTeam(...args),
  renameTeam: (...args: unknown[]) => mockRenameTeam(...args),
  reorderTeams: (...args: unknown[]) => mockReorderTeams(...args),
}));

import { usePersonnel } from '../usePersonnel';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

const makeRow = (team: string, role: string, name: string): OnCallRow => ({
  id: `${team}-${role}-${name}`,
  team,
  role,
  name,
  contact: `${name.toLowerCase()}@test.com`,
  timeWindow: '',
});

describe('usePersonnel', () => {
  const initialRows: OnCallRow[] = [
    makeRow('Network', 'Primary', 'Alice'),
    makeRow('Network', 'Backup', 'Bob'),
    makeRow('Database', 'Primary', 'Charlie'),
    makeRow('Database', 'Backup', 'Dave'),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockDismissalRecords.length = 0;
  });

  it('initializes with provided on-call rows', () => {
    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    expect(result.current.localOnCall).toEqual(initialRows);
    expect(result.current.teams).toEqual(['Network', 'Database']);
  });

  it('syncs with external updates when no mutations pending', () => {
    const { result, rerender } = renderHook(({ rows }) => usePersonnel(rows), {
      wrapper,
      initialProps: { rows: initialRows },
    });

    const updatedRows = [...initialRows, makeRow('Network', 'Tertiary', 'Eve')];
    rerender({ rows: updatedRows });

    expect(result.current.localOnCall).toEqual(updatedRows);
  });

  it('handles updating team rows optimistically', async () => {
    mockReplaceTeamRecords.mockResolvedValue([]);

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

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

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    const updatedDatabaseRows = [makeRow('Database', 'Primary', 'Frank')];

    await act(async () => {
      await result.current.handleUpdateRows('Database', updatedDatabaseRows);
    });

    const teams = Array.from(new Set(result.current.localOnCall.map((r) => r.team)));
    expect(teams).toEqual(['Network', 'Database']);
  });

  it('handles removing a team', async () => {
    mockDeleteOnCallByTeam.mockResolvedValue(undefined);

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleRemoveTeam('Database');
    });

    expect(result.current.teams).toEqual(['Network']);
    expect(result.current.localOnCall.every((r) => r.team !== 'Database')).toBe(true);
  });

  it('shows error toast on remove team API failure', async () => {
    mockDeleteOnCallByTeam.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleRemoveTeam('Database');
    });

    // Team should still exist since API failed
    expect(result.current.teams).toEqual(['Network', 'Database']);
  });

  it('handles renaming a team', async () => {
    mockRenameTeam.mockResolvedValue(undefined);

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleRenameTeam('Database', 'DB Team');
    });

    expect(result.current.teams).toContain('DB Team');
    expect(result.current.teams).not.toContain('Database');
  });

  it('does not rename team on API failure', async () => {
    mockRenameTeam.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleRenameTeam('Database', 'DB Team');
    });

    expect(result.current.teams).toContain('Database');
    expect(result.current.teams).not.toContain('DB Team');
  });

  it('handles adding a new team', async () => {
    mockReplaceTeamRecords.mockResolvedValue([]);
    mockReorderTeams.mockResolvedValue(undefined);

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleAddTeam('Security');
    });

    expect(result.current.teams).toContain('Security');
  });

  it('rolls back add team on API failure', async () => {
    mockReplaceTeamRecords.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleAddTeam('Security');
    });

    expect(result.current.teams).not.toContain('Security');
  });

  it('handles reordering teams', async () => {
    mockReorderTeams.mockResolvedValue(undefined);

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleReorderTeams(0, 1);
    });

    expect(result.current.teams).toEqual(['Database', 'Network']);
  });

  it('rolls back reorder on API failure', async () => {
    mockReorderTeams.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleReorderTeams(0, 1);
    });

    expect(result.current.teams).toEqual(['Network', 'Database']);
  });

  it('skips reorder when same index', async () => {
    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleReorderTeams(0, 0);
    });

    expect(mockReorderTeams).not.toHaveBeenCalled();
  });

  it('provides a weekRange string with date range and year', () => {
    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });
    expect(result.current.weekRange).toMatch(/^[A-Za-z]+ \d{1,2} - [A-Za-z]+ \d{1,2}, \d{4}$/);
  });

  it('dismisses alerts optimistically and persists to PB', () => {
    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

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

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleUpdateRows('Network', [makeRow('Network', 'Primary', 'Alice')]);
    });

    expect(result.current.dismissedAlerts.has('general')).toBe(true);
  });

  it('handleUpdateRows rolls back on API failure and toasts', async () => {
    mockReplaceTeamRecords.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

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

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    expect(result.current.dismissedAlerts.has('oracle')).toBe(true);
    expect(result.current.dismissedAlerts.has('sql')).toBe(false);
  });
});
