import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { NoopToastProvider } from '../../components/Toast';
import type { OnCallRow } from '@shared/ipc';

// Mock secureStorage with an in-memory store
const secureStore = new Map<string, unknown>();
vi.mock('../../utils/secureStorage', () => ({
  secureStorage: {
    getItemSync: vi.fn((key: string, defaultValue?: unknown) => {
      const val = secureStore.get(key);
      return val !== undefined ? val : defaultValue;
    }),
    setItemSync: vi.fn((key: string, value: unknown) => {
      secureStore.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      secureStore.delete(key);
    }),
    clear: vi.fn(() => {
      secureStore.clear();
    }),
    getItem: vi.fn(async (key: string, defaultValue?: unknown) => {
      const val = secureStore.get(key);
      return val !== undefined ? val : defaultValue;
    }),
    setItem: vi.fn(async (key: string, value: unknown) => {
      secureStore.set(key, value);
    }),
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
    secureStore.clear();
    localStorage.clear();
  });

  afterEach(() => {
    secureStore.clear();
    localStorage.clear();
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

  it('dismisses alerts and persists to secureStorage', () => {
    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    act(() => {
      result.current.dismissAlert('general');
    });

    const key = result.current.getAlertKey('general');
    expect(result.current.dismissedAlerts.has(key)).toBe(true);
    expect(secureStore.get(`dismissed-${key}`)).toBe('true');
  });

  it('handleUpdateRows auto-dismisses general alert on Monday', async () => {
    vi.setSystemTime(new Date(2026, 1, 2, 10, 0, 0)); // Feb 2, 2026 is a Monday
    mockReplaceTeamRecords.mockResolvedValue([]);

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleUpdateRows('Network', [makeRow('Network', 'Primary', 'Alice')]);
    });

    const key = result.current.getAlertKey('general');
    expect(result.current.dismissedAlerts.has(key)).toBe(true);
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

  it('getAlertKey generates date-based key', () => {
    vi.setSystemTime(new Date(2026, 1, 6, 12, 0, 0)); // Feb 6, 2026
    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    const key = result.current.getAlertKey('general');
    expect(key).toBe('2026-1-6-general');
  });
});
